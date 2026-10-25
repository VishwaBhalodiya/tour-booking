// Compare URL origins rather than raw environment strings (which may include
// whitespace, a trailing slash or an accidentally copied page path).
export function frontendOrigin() {
  const url = new URL((process.env.CLIENT_URL || "http://localhost:5173").trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("CLIENT_URL must be an HTTP(S) frontend URL without credentials.");
  return url.origin;
}
