let contentRevision = 0;
let authRevision = 0;
export async function api(path, options = {}) {
  const revision = contentRevision;
  const sessionRevision = authRevision;
  const res = await fetch(`/api${path}`, {
    cache: "no-store",
    credentials: "include",
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
    body:
      options.body instanceof FormData
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined,
  });
  const data = await res
    .json()
    .catch(() => ({
      message: "Server unavailable. Check that the API is running.",
    }));
  if (path === "/auth/me" && sessionRevision !== authRevision) return api(path, options);
  // Do not let an older in-flight GET overwrite content fetched after an edit.
  if ((!options.method || options.method === "GET" || path === "/quote") && !path.startsWith("/auth/") && revision !== contentRevision) {
    return api(path, options);
  }
  if (!res.ok) {
    const error = new Error(data.message || "Request failed");
    error.status = res.status;
    error.code = data.code;
    if (res.status === 401 && sessionRevision === authRevision && !["/auth/me", "/auth/login", "/auth/admin/login", "/auth/register", "/auth/confirm"].includes(path)) {
      window.dispatchEvent(new Event("session-expired"));
    }
    if (/^\/admin(?:\/|$)/.test(path) && [401, 403].includes(res.status)) {
      window.dispatchEvent(new CustomEvent("admin-auth-denied", {
        detail: { status: res.status },
      }));
    }
    throw error;
  }
  if (["/auth/login", "/auth/admin/login", "/auth/logout", "/auth/confirm", "/auth/reset-password"].includes(path) && options.method === "POST") authRevision++;
  return data;
}
export const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n || 0);
export const date = (d) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export function liveInterval(fn, ms) {
  const timer = setInterval(fn, ms);
  window.addEventListener("catalog-update", fn);
  return { timer, fn };
}
export function clearLiveInterval(handle) {
  clearInterval(handle.timer);
  window.removeEventListener("catalog-update", handle.fn);
}
const events = new EventSource("/api/events");
const invalidate = () => {
  contentRevision++;
  window.dispatchEvent(new Event("catalog-update"));
};
events.onopen = invalidate;
events.onmessage = (e) => {
  if (e.data === "updated") invalidate();
};
