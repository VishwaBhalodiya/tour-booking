export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
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
  if (!res.ok) throw Error(data.message || "Request failed");
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
events.onmessage = (e) => {
  if (e.data === "updated") window.dispatchEvent(new Event("catalog-update"));
};
