import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { User } from "./models.js";
import { frontendOrigin } from "./origins.js";

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (message, status = 400, code) => { throw Object.assign(new Error(message), { status, code }); };
const emailSchema = z.string().trim().email().transform(value => value.toLowerCase());
const passwordSchema = z.string().min(8).max(128);
const safeUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, wishlist: user.wishlist });
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
const clearSession = res => {
  for (const name of ["session", "sb_access", "sb_refresh"]) res.clearCookie(name, cookieOptions());
};
const adminEmail = () => (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
function adminConfiguration() {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!adminEmail() || !hash || !/^\$2[aby]\$\d{2}\$/.test(hash)) fail("Configure ADMIN_EMAIL and ADMIN_PASSWORD_HASH on the server.", 503);
  return createHmac("sha256", process.env.JWT_SECRET).update(`${adminEmail()}:${hash}`).digest("hex");
}

// Server-only Supabase Auth REST client. No service-role key or frontend SDK is needed.
async function supabase(endpoint, { method = "GET", body, accessToken } = {}) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!base || !/^https:\/\/[^/?#@]+$/.test(base) || !key) fail("Configure Supabase Auth on the server.", 503);
  let response;
  try {
    response = await fetch(`${base}/auth/v1${endpoint}`, {
      method, headers: { apikey: key, "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
  } catch { fail("Authentication service is unavailable. Please try again.", 503); }
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data.code || data.error_code;
    if (code === "email_not_confirmed") fail("Verify your email before signing in.", 403, code);
    if (endpoint === "/user" && method === "GET" && [400, 401, 403, 404].includes(response.status)) fail("Session expired. Please sign in again.", 401);
    if (response.status === 429) fail("Too many attempts. Please wait before trying again.", 429);
    if (response.status >= 500) fail("Supabase could not complete this request. Check its email/SMTP configuration.", 503);
    fail(data.msg || data.error_description || data.message || "Invalid or expired authentication link/session.", response.status === 401 ? 401 : 400, code);
  }
  return data;
}

function storeTokens(res, tokens) {
  if (!tokens.access_token || !tokens.refresh_token) fail("Authentication session was not returned.", 401);
  res.cookie("sb_access", tokens.access_token, { ...cookieOptions(), maxAge: Math.max(60, Number(tokens.expires_in) || 3600) * 1000 });
  res.cookie("sb_refresh", tokens.refresh_token, { ...cookieOptions(), maxAge: 7 * 86400000 });
}
function issueSession(res, user, provider, recovery = false) {
  const claims = { id: user.id, provider, sessionVersion: user.sessionVersion ?? 0 };
  if (provider === "admin") claims.configuration = adminConfiguration();
  else { claims.supabaseId = user.supabaseId; claims.recovery = recovery; }
  res.cookie("session", jwt.sign(claims, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "7d" }), {
    ...cookieOptions(), maxAge: 7 * 86400000,
  });
}

async function verifiedUser(accessToken) {
  if (!accessToken) fail("Please sign in to continue.", 401);
  const user = await supabase("/user", { accessToken });
  if (!user.id || !user.email || !user.email_confirmed_at) fail("Verify your email before signing in.", 403, "email_not_confirmed");
  return user;
}

async function customerProfile(identity) {
  const email = emailSchema.parse(identity.email);
  if (email === adminEmail()) fail("Use the separate administrator sign-in.", 403);
  let user = await User.findOne({ supabaseId: identity.id }).select("+sessionVersion");
  if (!user) user = await User.findOne({ email }).collation({ locale: "en", strength: 2 }).select("+sessionVersion");
  if (user) {
    if (user.role !== "customer" || (user.supabaseId && user.supabaseId !== identity.id)) fail("This email belongs to a different account. Contact the agency.", 403);
    // Only a Supabase-verified email can link an existing legacy customer profile.
    // Keep the MongoDB _id, wishlist and booking references unchanged.
    if (!user.supabaseId) {
      user = await User.findOneAndUpdate({ _id: user.id, role: "customer", $or: [{ supabaseId: { $exists: false } }, { supabaseId: null }] },
        { $set: { supabaseId: identity.id, authProvider: "supabase" } }, { new: true }).select("+sessionVersion");
      if (!user) fail("Account linking changed. Please sign in again.", 409);
    }
    return user;
  }
  try {
    return await User.create({ email, supabaseId: identity.id, authProvider: "supabase", role: "customer",
      name: String(identity.user_metadata?.full_name || email.split("@")[0]).trim().slice(0, 80),
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    user = await User.findOne({ supabaseId: identity.id, role: "customer" }).select("+sessionVersion");
    if (!user) fail("Account already exists. Please sign in again.", 409);
    return user;
  }
}

// Share refresh results briefly so concurrent API calls do not rotate the same
// refresh token independently. Tokens remain only in cookies/transient memory.
const refreshes = new Map();
async function customerIdentity(req, res) {
  let accessToken = req.cookies.sb_access;
  try { return { identity: await verifiedUser(accessToken), accessToken }; }
  catch (error) { if (error.status !== 401 || !req.cookies.sb_refresh) throw error; }
  const key = createHash("sha256").update(req.cookies.sb_refresh).digest("hex");
  let refresh = refreshes.get(key);
  if (!refresh || refresh.expires < Date.now()) {
    if (refreshes.size > 500) refreshes.delete(refreshes.keys().next().value);
    refresh = { expires: Date.now() + 10000, promise: supabase("/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: req.cookies.sb_refresh } }) };
    refreshes.set(key, refresh);
  }
  let tokens;
  try { tokens = await refresh.promise; }
  catch (error) { refreshes.delete(key); if (error.status < 500) fail("Session expired. Please sign in again.", 401); throw error; }
  storeTokens(res, tokens); accessToken = tokens.access_token;
  return { identity: await verifiedUser(accessToken), accessToken };
}

export const auth = wrap(async (req, res, next) => {
  let claims;
  try {
    claims = jwt.verify(req.cookies?.session, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    if (!claims || typeof claims !== "object" || typeof claims.id !== "string" || !/^[a-f\d]{24}$/i.test(claims.id) || !claims.exp || !["admin", "supabase"].includes(claims.provider)) throw new Error();
  } catch { fail("Please sign in to continue.", 401); }
  if (mongoose.connection.readyState !== 1) fail("Unable to verify your account. Please try again.", 503);
  const user = await User.findById(claims.id).select("+sessionVersion");
  if (!user || (claims.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) fail("Session expired. Please sign in again.", 401);
  if (claims.provider === "admin") {
    if (claims.configuration !== adminConfiguration() || user.role !== "admin" || user.email.toLowerCase() !== adminEmail()) {
      fail("Administrator access was revoked.", 403);
    }
  } else {
    let identity, accessToken;
    ({ identity, accessToken } = await customerIdentity(req, res));
    if (user.role !== "customer" || user.supabaseId !== identity.id || claims.supabaseId !== identity.id || identity.email.toLowerCase() !== user.email.toLowerCase()) {
      fail("Account verification failed. Please sign in again.", 403);
    }
    req.supabaseAccessToken = accessToken;
  }
  req.user = user; req.authClaims = claims;
  next();
});

export function admin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Please sign in to continue." });
  if (req.authClaims?.provider !== "admin" || req.user.role !== "admin" || req.user.email.toLowerCase() !== adminEmail()) {
    return res.status(403).json({ message: "Admin access required." });
  }
  next();
}

export function registerAuthRoutes(app) {
  const limit = rateLimit({ windowMs: 15 * 60000, limit: 30 });
  app.use("/api/auth", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const redirect = (req, route) => {
    const configured = frontendOrigin();
    const origin = process.env.NODE_ENV !== "production" && ["http://localhost:5173", "http://127.0.0.1:5173"].includes(req.get("origin")) ? req.get("origin") : configured;
    return encodeURIComponent(`${origin.replace(/\/$/, "")}${route}`);
  };
  const establishCustomer = async (res, tokens, recovery = false) => {
    const identity = await verifiedUser(tokens.access_token);
    const user = await customerProfile(identity);
    clearSession(res); storeTokens(res, tokens); issueSession(res, user, "supabase", recovery);
    return safeUser(user);
  };

  app.post("/api/auth/register", limit, wrap(async (req, res) => {
    const data = z.object({ name: z.string().trim().min(2).max(80), email: emailSchema, password: passwordSchema }).parse(req.body);
    if (data.email === adminEmail()) fail("Use the separate administrator sign-in.", 403);
    await supabase(`/signup?redirect_to=${redirect(req, "/auth/confirm")}`, { method: "POST", body: { email: data.email, password: data.password, data: { full_name: data.name } } });
    res.status(201).json({ message: "Check your email and verify your account before signing in." });
  }));
  app.post("/api/auth/login", limit, wrap(async (req, res) => {
    const data = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).parse(req.body);
    if (data.email === adminEmail()) fail("Use the separate administrator sign-in.", 403);
    const tokens = await supabase("/token?grant_type=password", { method: "POST", body: data });
    res.json(await establishCustomer(res, tokens));
  }));
  app.post("/api/auth/admin/login", limit, wrap(async (req, res) => {
    adminConfiguration();
    const data = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).parse(req.body);
    const expected = Buffer.from(adminEmail()); const actual = Buffer.from(data.email);
    if (Buffer.byteLength(data.password) > 72) fail("Invalid administrator credentials.", 401);
    const validEmail = expected.length === actual.length && timingSafeEqual(expected, actual);
    const validPassword = await bcrypt.compare(data.password, process.env.ADMIN_PASSWORD_HASH);
    if (!validEmail || !validPassword) fail("Invalid administrator credentials.", 401);
    let user = await User.findOne({ email: adminEmail() }).collation({ locale: "en", strength: 2 }).select("+sessionVersion");
    if (user && user.role !== "admin") fail("Configured admin email belongs to a customer. Configure a separate admin email.", 409);
    if (!user) user = await User.create({ email: adminEmail(), name: "Agency Admin", role: "admin", authProvider: "admin" });
    clearSession(res); issueSession(res, user, "admin"); res.json(safeUser(user));
  }));
  app.post("/api/auth/resend-verification", limit, wrap(async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    await supabase(`/resend?redirect_to=${redirect(req, "/auth/confirm")}`, { method: "POST", body: { type: "signup", email } });
    res.json({ message: "If verification is pending, a new email has been sent." });
  }));
  app.post("/api/auth/forgot-password", limit, wrap(async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    if (email !== adminEmail()) {
      try { await supabase(`/recover?redirect_to=${redirect(req, "/reset-password")}`, { method: "POST", body: { email } }); }
      catch (error) { if (error.status >= 500 || error.status === 429) throw error; }
    }
    res.json({ message: "If an account exists, a password-reset email has been sent." });
  }));
  app.post("/api/auth/confirm", limit, wrap(async (req, res) => {
    const data = z.object({ token_hash: z.string().min(10).max(2048), type: z.enum(["signup", "recovery"]) }).parse(req.body);
    const tokens = await supabase("/verify", { method: "POST", body: data });
    res.json(await establishCustomer(res, tokens, data.type === "recovery"));
  }));
  app.get("/api/auth/recovery", auth, (req, res) => {
    if (req.authClaims.provider !== "supabase" || !req.authClaims.recovery) return res.status(403).json({ message: "Open the password-reset link from your email." });
    res.json({ allowed: true });
  });
  app.post("/api/auth/reset-password", limit, auth, wrap(async (req, res) => {
    if (req.authClaims.provider !== "supabase" || !req.authClaims.recovery) fail("Open the password-reset link from your email.", 403);
    const password = passwordSchema.parse(req.body.password);
    await supabase("/user", { method: "PUT", accessToken: req.supabaseAccessToken, body: { password } });
    await User.updateOne({ _id: req.user.id }, { $inc: { sessionVersion: 1 } });
    await supabase("/logout?scope=global", { method: "POST", accessToken: req.supabaseAccessToken }).catch(() => {});
    clearSession(res); res.json({ message: "Password updated. Sign in with your new password." });
  }));
  app.post("/api/auth/logout", wrap(async (req, res) => {
    let claims;
    try { claims = jwt.verify(req.cookies?.session, process.env.JWT_SECRET, { algorithms: ["HS256"] }); } catch { /* Already signed out. */ }
    if (claims && /^[a-f\d]{24}$/i.test(claims.id || "") && ["admin", "supabase"].includes(claims.provider)) {
      const revoked = await User.updateOne({ _id: claims.id, $expr: { $eq: [{ $ifNull: ["$sessionVersion", 0] }, claims.sessionVersion ?? 0] } }, { $inc: { sessionVersion: 1 } });
      if (revoked.modifiedCount && claims.provider === "supabase" && req.cookies.sb_access) await supabase("/logout?scope=global", { method: "POST", accessToken: req.cookies.sb_access }).catch(() => {});
    }
    clearSession(res); res.json({ ok: true });
  }));
  app.get("/api/auth/me", auth, (req, res) => res.json(safeUser(req.user)));
  app.put("/api/auth/profile", auth, wrap(async (req, res) => {
    req.user.name = z.string().trim().min(2).max(80).parse(req.body.name);
    await req.user.save(); res.json(safeUser(req.user));
  }));
}
