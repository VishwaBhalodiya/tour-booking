import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import bcrypt from "bcryptjs";
import {
  User,
  Settings,
  Destination,
  Package,
  Departure,
  Addon,
  Booking,
  Media,
} from "../src/models.js";
let repl, server, base, adminCookie, customerCookie, p, d, addon, booking;
const realFetch = globalThis.fetch;
const identities = new Map();
const sessions = new Map();
const authOrigin = "https://booking-auth.test";
const testPassword = "SecureTest123!";
let signupBody;
// Mock only the external Auth boundary; Express auth, cookies, role checks and
// MongoDB profile linking still run unchanged. Never contact a real provider.
async function mockFetch(input, options = {}) {
  const url = new URL(String(input));
  if (url.origin !== authOrigin) {
    if (base && url.origin === new URL(base).origin) return realFetch(input, options);
    throw new Error(`Unexpected outbound test request: ${url.origin}`);
  }
  assert.equal(new Headers(options.headers).get("apikey"), "test-publishable-key");
  const data = options.body ? JSON.parse(options.body) : {};
  const json = (body, status = 200) => Response.json(body, { status });
  if (url.pathname === "/auth/v1/signup") {
    signupBody = data;
    identities.set(data.email, { id: `test-${data.email}`, email: data.email,
      user_metadata: data.data });
    return json({ user: identities.get(data.email) });
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
    const identity = identities.get(data.email);
    if (!identity || data.password !== testPassword) return json({ message: "Invalid credentials" }, 400);
    if (!identity.email_confirmed_at) return json({ code: "email_not_confirmed" }, 400);
    const access = `mock-access-${identity.id}`;
    sessions.set(access, identity);
    return json({ access_token: access, refresh_token: `mock-refresh-${identity.id}`, expires_in: 3600 });
  }
  if (url.pathname === "/auth/v1/user") {
    const token = new Headers(options.headers).get("authorization")?.replace(/^Bearer /, "");
    const identity = sessions.get(token);
    return identity ? json(identity) : json({ message: "Invalid token" }, 401);
  }
  throw new Error(`Unexpected Supabase test endpoint: ${url.pathname}`);
}
async function request(url, method = "GET", body, cookie) {
  const r = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    body: await r.json(),
    // Keep the final value of each cookie: login first clears old cookies,
    // then sets the Supabase tokens and signed application session.
    cookie: [...new Map(r.headers.getSetCookie().map(value => {
      const pair = value.split(";")[0];
      return [pair.slice(0, pair.indexOf("=")), pair];
    })).values()].join("; "),
  };
}
before(
  async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET =
      "test-only-random-secret-which-is-over-32-characters";
    process.env.ADMIN_EMAIL = "admin@test.com";
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(testPassword, 4);
    process.env.SUPABASE_URL = authOrigin;
    process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
    process.env.CLIENT_URL = "http://localhost:5173";
    globalThis.fetch = mockFetch;
    identities.set("customer@test.com", { id: "test-customer", email: "customer@test.com",
      email_confirmed_at: new Date().toISOString(), user_metadata: { full_name: "Customer" } });
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(repl.getUri());
    const { app } = await import("../src/index.js");
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.on("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
    // An existing profile must link without changing its MongoDB identity.
    const customer = await User.create({ name: "Customer", email: "customer@test.com" });
    await User.init();
    await Settings.create({ key: "main", gst: 5 });
    const dest = await Destination.create({ name: "Goa" });
    p = await Package.create({
      title: "Goa Escape",
      destination: dest.id,
      duration: 5,
      active: true,
    });
    d = await Departure.create({
      package: p.id,
      date: new Date(Date.now() + 30 * 86400000),
      totalSeats: 3,
      adultRate: 1000,
      childRate: 500,
      singleCharge: 200,
      seasonMultiplier: 1.5,
      season: "peak",
    });
    addon = await Addon.create({ name: "Pickup", price: 100, active: true });
    const adminLogin = await request("/auth/admin/login", "POST", {
        email: "admin@test.com",
        password: testPassword,
      });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
    adminCookie = adminLogin.cookie;
    const customerLogin = await request("/auth/login", "POST", {
        email: "customer@test.com",
        password: testPassword,
      });
    assert.equal(customerLogin.status, 200, JSON.stringify(customerLogin.body));
    assert.equal(customerLogin.body.id, customer.id);
    customerCookie = customerLogin.cookie;
    assert.equal((await request("/auth/me", "GET", null, customerCookie)).body.role, "customer");
  },
  { timeout: 900000 },
);
after(async () => {
  globalThis.fetch = realFetch;
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
  if (repl) await repl.stop();
});
test("booking workflow, authorization, price tampering and inventory", async () => {
  assert.equal(
    (await request("/admin/settings", "GET", null, customerCookie)).status,
    403,
  );
  assert.equal((await request("/admin/settings")).status, 401);
  const selection = {
    departure: d.id,
    adults: 2,
    children: 1,
    sharing: "single",
    addons: [addon.id],
  };
  const quote = await request("/quote", "POST", selection);
  assert.equal(quote.body.total, 4672.5);
  const travellers = [
    { name: "Adult One", age: 30, idProof: "ID-ONE" },
    { name: "Adult Two", age: 28, idProof: "ID-TWO" },
    { name: "Child One", age: 8, idProof: "ID-THREE" },
  ];
  assert.equal(
    (
      await request(
        "/bookings",
        "POST",
        { ...selection, travellers, expectedTotal: 1 },
        customerCookie,
      )
    ).status,
    409,
  );
  assert.equal((await Departure.findById(d.id)).bookedSeats, 0);
  const response = await request(
    "/bookings",
    "POST",
    { ...selection, travellers, expectedTotal: quote.body.total },
    customerCookie,
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  booking = response.body;
  assert.equal((await Departure.findById(d.id)).bookedSeats, 3);
  assert.equal((await request("/quote", "POST", selection)).status, 409);
  const depBody = {
    package: p.id,
    date: new Date(d.date).toISOString(),
    totalSeats: 2,
    adultRate: 1000,
    childRate: 500,
    singleCharge: 200,
    tripleCharge: 0,
    season: "peak",
    seasonMultiplier: 1.5,
    closed: false,
  };
  assert.equal(
    (await request(`/admin/departures/${d.id}`, "PUT", depBody, adminCookie))
      .status,
    400,
  );
  assert.equal(
    (await request(`/admin/departures/${d.id}`, "DELETE", null, adminCookie))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        `/bookings/${booking._id}/cancel`,
        "POST",
        {},
        customerCookie,
      )
    ).status,
    200,
  );
  assert.equal((await Departure.findById(d.id)).bookedSeats, 0);
  await request(`/bookings/${booking._id}/cancel`, "POST", {}, customerCookie);
  assert.equal((await Departure.findById(d.id)).bookedSeats, 0);
  assert.equal(
    (
      await request(
        `/admin/bookings/${booking._id}`,
        "PUT",
        { status: "Confirmed" },
        adminCookie,
      )
    ).status,
    400,
  );
  const changed = await request(
    `/admin/departures/${d.id}`,
    "PUT",
    { ...depBody, totalSeats: 3, adultRate: 2000 },
    adminCookie,
  );
  assert.equal(changed.status, 200);
  assert.equal((await request("/quote", "POST", selection)).body.total, 7822.5);
  assert.equal((await Booking.findById(booking._id)).price.total, 4672.5);
  await request(
    `/admin/departures/${d.id}`,
    "PUT",
    { ...depBody, totalSeats: 3, closed: true },
    adminCookie,
  );
  assert.equal((await request("/quote", "POST", selection)).status, 400);
});
test("concurrent requests cannot oversell", async () => {
  await Departure.findByIdAndUpdate(d.id, {
    closed: false,
    totalSeats: 1,
    bookedSeats: 0,
    adultRate: 1000,
  });
  const data = {
    departure: d.id,
    adults: 1,
    children: 0,
    sharing: "twin",
    addons: [],
  };
  const q = (await request("/quote", "POST", data)).body;
  const body = {
    ...data,
    expectedTotal: q.total,
    travellers: [{ name: "One Traveller", age: 30, idProof: "ONE-ID" }],
  };
  const results = await Promise.all([
    request("/bookings", "POST", body, customerCookie),
    request("/bookings", "POST", body, customerCookie),
  ]);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal((await Departure.findById(d.id)).bookedSeats, 1);
});

test("invalid Supabase tokens and revoked MongoDB admin roles fail securely", async () => {
  const invalidCookie = customerCookie.split("; ")
    .filter(pair => !pair.startsWith("sb_refresh="))
    .map(pair => pair.startsWith("sb_access=") ? "sb_access=invalid-token" : pair)
    .join("; ");
  assert.equal((await request("/auth/me", "GET", null, invalidCookie)).status, 401);
  assert.equal((await request("/bookings", "GET", null, invalidCookie)).status, 401);
  await User.updateOne({ email: "admin@test.com" }, { $set: { role: "customer" } });
  try {
    assert.equal((await request("/admin/settings", "GET", null, adminCookie)).status, 403);
  } finally {
    await User.updateOne({ email: "admin@test.com" }, { $set: { role: "admin" } });
  }
});

test("admin catalogue edits reach public APIs and customers cannot escalate roles", async () => {
  const reg = await request("/auth/register", "POST", {
    name: "New User",
    email: "new@test.com",
    password: "SecureTest123!",
    role: "admin",
  });
  assert.equal(reg.status, 201);
  assert.equal(signupBody.role, undefined);
  assert.deepEqual(signupBody.data, { full_name: "New User" });
  assert.equal(await User.findOne({ email: "new@test.com" }), null);
  const credentials = { email: "new@test.com", password: testPassword };
  assert.equal((await request("/auth/login", "POST", credentials)).status, 403);
  identities.get(credentials.email).email_confirmed_at = new Date().toISOString();
  const login = await request("/auth/login", "POST", credentials);
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.role, "customer");
  assert.equal(
    (await request("/admin/packages", "POST", {}, login.cookie)).status,
    403,
  );
  // Catalogue images must be registered media, without live Cloudinary calls.
  const image = "https://res.cloudinary.com/test/image/upload/v1/tour-booking/fixture.webp";
  await Media.create({ url: image, publicId: "tour-booking/fixture", name: "Test image" });
  const dest = await request(
    "/admin/destinations",
    "POST",
    {
      name: "Test Valley",
      description: "From the admin panel",
      image,
      active: true,
    },
    adminCookie,
  );
  assert.equal(dest.status, 201, JSON.stringify(dest.body));
  const theme = await request(
    "/admin/themes",
    "POST",
    { name: "Discovery", active: true },
    adminCookie,
  );
  const body = {
    title: "A live admin journey",
    description: "Editable content",
    destination: dest.body._id,
    themes: [theme.body._id],
    duration: 4,
    images: [image],
    itinerary: [{ day: 1, title: "Arrival", description: "A warm welcome" }],
    inclusions: ["Breakfast"],
    exclusions: ["Flights"],
    hotelCategory: "Boutique",
    featured: true,
    active: true,
  };
  const created = await request("/admin/packages", "POST", body, adminCookie);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const publicDetail = await request(`/packages/${created.body._id}`);
  assert.equal(publicDetail.body.package.itinerary[0].title, "Arrival");
  const banner = await request(
    "/admin/banners",
    "POST",
    {
      title: "New banner",
      subtitle: "Changed live",
      image,
      buttonText: "Go",
      link: "/packages",
      active: true,
    },
    adminCookie,
  );
  assert.equal(banner.status, 201);
  const catalog = await request("/catalog");
  assert.ok(catalog.body.banners.some((b) => b.title === "New banner"));
  assert.ok(catalog.body.destinations.some((d) => d.name === "Test Valley"));
  const filtered = await request(
    `/packages?destination=${dest.body._id}&theme=${theme.body._id}&duration=1-4&search=live`,
  );
  assert.equal(filtered.body.total, 1);
  await request(
    `/admin/packages/${created.body._id}`,
    "PUT",
    { ...body, active: false },
    adminCookie,
  );
  assert.equal((await request(`/packages/${created.body._id}`)).status, 404);
  assert.equal(
    (
      await request(
        `/admin/packages/${created.body._id}`,
        "DELETE",
        null,
        adminCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/admin/destinations/${dest.body._id}`,
        "DELETE",
        null,
        adminCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/admin/settings",
        "PUT",
        {
          businessName: "Custom Agency",
          email: "agency@test.com",
          phone: "12345678",
          gst: 12,
          childAgeLimit: 10,
          cancellationCutoff: 5,
        },
        adminCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/catalog")).body.settings.businessName,
    "Custom Agency",
  );
});
