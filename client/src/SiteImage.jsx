import React, { useState } from "react";

// No external fallback URLs: missing/failed media has a neutral layout placeholder.
export default function SiteImage({ src, alt = "", ...props }) {
  const [failed, setFailed] = useState(null);
  if (!src || failed === src) {
    return <span className={`image-placeholder ${props.className || ""}`} role="img" aria-label={alt || "No image available"}>Image unavailable</span>;
  }
  return <img {...props} src={src} alt={alt} onError={() => setFailed(src)} />;
}
