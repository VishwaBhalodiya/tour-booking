import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useApp, Loading } from "./main";
import { api } from "./api";

// Keep the confirmed identity separate from editable/shared UI state. A URL or
// client-side role change cannot authorize this boundary; /auth/me must confirm it.
export default function AdminRoute({ children }) {
  const { setUser } = useApp();
  const location = useLocation();
  const routeKey = `${location.key}:${location.pathname}:${location.search}`;
  const [confirmation, setConfirmation] = useState({ status: "checking" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let sequence = 0;
    let controller;
    let pending = false;

    async function confirm(block = false) {
      // Do not let periodic refreshes repeatedly abort a slow request and keep
      // an old authorization alive. Its timeout must be able to fail closed.
      if (pending && !block) return;
      const request = ++sequence;
      controller?.abort();
      controller = new AbortController();
      const currentController = controller;
      pending = true;
      const timeout = setTimeout(() => currentController.abort(), 15000);
      if (block) setConfirmation({ routeKey, status: "checking" });
      try {
        const currentUser = await api("/auth/me", {
          signal: currentController.signal,
          cache: "no-store",
        });
        if (!active || request !== sequence) return;
        if (!currentUser?.id || !["customer", "admin"].includes(currentUser.role)) {
          throw new Error("Unable to confirm account permissions.");
        }
        setUser(currentUser);
        setConfirmation({
          routeKey,
          status: currentUser.role === "admin" ? "allowed" : "forbidden",
        });
      } catch (error) {
        if (!active || request !== sequence) return;
        setUser(null);
        setConfirmation({
          routeKey,
          status: error.status === 401 ? "unauthenticated"
            : error.status === 403 ? "forbidden" : "unavailable",
        });
      } finally {
        clearTimeout(timeout);
        if (request === sequence) pending = false;
      }
    }

    // A new route never mounts admin children until its session is confirmed.
    confirm(true);
    const onFocus = () => confirm();
    const onVisible = () => {
      if (document.visibilityState === "visible") confirm();
    };
    const onDenied = () => confirm(true);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") confirm();
    }, 10000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("admin-auth-denied", onDenied);
    return () => {
      active = false;
      ++sequence;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("admin-auth-denied", onDenied);
    };
  }, [routeKey, retry, setUser]);

  if (confirmation.routeKey !== routeKey || confirmation.status === "checking") {
    return <Loading />;
  }
  if (confirmation.status === "unauthenticated") {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  if (confirmation.status === "forbidden") return <Navigate to="/" replace />;
  if (confirmation.status !== "allowed") {
    return (
      <div className="empty" role="alert">
        <h1>Unable to verify admin access.</h1>
        <p>Please reconnect and try again.</p>
        <button className="button" onClick={() => setRetry(value => value + 1)}>
          Retry verification
        </button>
      </div>
    );
  }
  return children;
}
