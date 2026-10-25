import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Compass, ArrowUpRight } from "lucide-react";
import { useApp } from "./main";
import { api } from "./api";

const headings = {
  login: "Welcome back, traveller.", register: "A world of possibility.",
  admin: "Administrator sign in.", verify: "Check your inbox.",
  forgot: "Find your way back.", reset: "Choose a new password.", confirm: "Confirming your email.",
};
export default function AuthPage({ mode = "login" }) {
  const { setUser, catalog } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || "");
  const [message, setMessage] = useState(location.state?.message || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const section = catalog?.sections?.find(item => item.placement === "auth");
  const image = section ? section.image : catalog?.banners?.[0]?.image;

  useEffect(() => {
    setError(""); setMessage(location.state?.message || "");
    if (location.state?.email) setEmail(location.state.email);
    if (!["confirm", "reset"].includes(mode)) return;
    let active = true;
    const params = new URLSearchParams(location.search);
    const hash = params.get("token_hash");
    const type = params.get("type");
    setBusy(true); setRecoveryReady(false);
    async function confirm() {
      try {
        if (hash) {
          if (type !== (mode === "reset" ? "recovery" : "signup")) throw Error("This email link is invalid. Request a new one.");
          const user = await api("/auth/confirm", { method: "POST", body: { token_hash: hash, type } });
          if (!active) return;
          setUser(user);
          // Remove the one-time token from the visible address/history.
          window.history.replaceState(window.history.state, "", location.pathname);
          if (mode === "confirm") { navigate("/packages", { replace: true }); return; }
          setRecoveryReady(true);
        } else if (mode === "reset") {
          await api("/auth/recovery");
          if (active) setRecoveryReady(true);
        } else throw Error("Open the verification link from your email, or request another email.");
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) setBusy(false); }
    }
    confirm();
    return () => { active = false; };
  }, [mode, location.search, setUser, navigate]);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === "register") {
        const result = await api("/auth/register", { method: "POST", body: form });
        navigate("/verify-email", { state: { email: form.email, message: result.message } });
      } else if (mode === "login" || mode === "admin") {
        const user = await api(mode === "admin" ? "/auth/admin/login" : "/auth/login", { method: "POST", body: form });
        setUser(user); navigate(mode === "admin" ? "/admin" : "/packages", { replace: true });
      } else if (mode === "reset") {
        if (form.password !== form.confirmPassword) throw Error("Passwords do not match.");
        const result = await api("/auth/reset-password", { method: "POST", body: { password: form.password } });
        setUser(null); navigate("/login", { replace: true, state: { message: result.message } });
      } else {
        const result = await api(mode === "forgot" ? "/auth/forgot-password" : "/auth/resend-verification", { method: "POST", body: { email: form.email } });
        setMessage(result.message);
      }
    } catch (e) {
      if (e.code === "email_not_confirmed") navigate("/verify-email", { state: { email: form.email, message: e.message } });
      else setError(e.message);
    } finally { setBusy(false); }
  }

  const emailOnly = ["forgot", "verify"].includes(mode);
  const showForm = mode !== "confirm" && (mode !== "reset" || recoveryReady);
  return <div className="auth-layout">
    <div className="auth-art" style={{ backgroundImage: image ? `linear-gradient(#173e3266,#173e3288),url(${JSON.stringify(image)})` : undefined }}>
      <Compass size={42} /><h1>Good things<br />are out there.</h1><p>Let’s go find them.</p>
    </div>
    <div className="auth-form">
      <span className="eyebrow">{mode === "admin" ? "AGENCY WORKSPACE" : "YOUR NEXT CHAPTER"}</span>
      <h2>{headings[mode]}</h2>
      {mode === "verify" && <p>Verify your email to activate your customer account. You can resend the email below.</p>}
      {mode === "admin" && <p>Use the administrator credentials configured by your agency.</p>}
      {message && <p role="status" className="notice">{message}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {busy && !showForm && <p role="status">Checking your email link…</p>}
      {showForm && <form onSubmit={submit}>
        {mode === "register" && <label>Full name<input name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>}
        {mode !== "reset" && <label>Email address<input name="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label>}
        {!emailOnly && <label>{mode === "reset" ? "New password" : "Password"}<input name="password" type="password" required minLength={["register", "reset"].includes(mode) ? 8 : 1} maxLength={128} autoComplete={["register", "reset"].includes(mode) ? "new-password" : "current-password"} /></label>}
        {mode === "reset" && <label>Confirm password<input name="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>}
        <button className="button full" disabled={busy}>{busy ? "One moment…" : mode === "register" ? "Create account" : mode === "verify" ? "Resend verification email" : mode === "forgot" ? "Send reset email" : mode === "reset" ? "Update password" : "Sign in"}<ArrowUpRight size={18} /></button>
      </form>}
      {mode === "login" && <><p><Link to="/forgot-password">Forgot password?</Link> · <Link to="/verify-email">Resend verification</Link></p><p>New around here? <Link to="/register">Create an account</Link></p><p><Link to="/admin/login">Administrator sign in</Link></p></>}
      {mode !== "login" && mode !== "admin" && <p><Link to="/login">Back to customer sign in</Link></p>}
      {mode === "register" && <p>We’ll email you a verification link before you can sign in.</p>}
      {mode === "reset" && !recoveryReady && !busy && <p><Link to="/forgot-password">Request a new password-reset link</Link></p>}
      {mode === "admin" && <p><Link to="/login">Customer sign in</Link></p>}
    </div>
  </div>;
}
