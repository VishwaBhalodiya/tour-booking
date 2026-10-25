import React, { useEffect, useRef, useState } from "react";
import { api, liveInterval, clearLiveInterval } from "./api";
import SiteImage from "./SiteImage";

export function ImageField({ label, value, multiple = false, onChange, onBusy }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const values = (multiple ? value || [] : [value]).filter(Boolean);
  const selection = useRef();
  selection.current = { values, onChange };
  useEffect(() => {
    let active = true;
    const load = () => api("/admin/media").then(data => {
      if (!active) return;
      setItems(data.items);
      const current = selection.current;
      const updated = current.values.filter(url => !data.removedUrls.includes(url)).map(url => data.items.find(item => item.url === url || item.legacyUrls?.includes(url))?.url || url);
      if (JSON.stringify(updated) !== JSON.stringify(current.values)) current.onChange(multiple ? updated : updated[0] || "");
    }).catch(e => active && setError(e.message));
    load(); const interval = liveInterval(load, 10000);
    return () => { active = false; clearLiveInterval(interval); };
  }, []);
  const choose = url => onChange(multiple ? [...new Set([...values, url])] : url);
  async function upload(file, replaceUrl = "") {
    if (!file) return;
    if (replaceUrl && !confirm("Replace this image everywhere it is used? This change is applied immediately.")) return;
    setBusy(true); onBusy?.(true); setError("");
    try {
      const body = new FormData(); body.append("image", file);
      const current = items.find(item => item.url === replaceUrl);
      if (replaceUrl && !current) body.append("source", replaceUrl);
      const media = await api(replaceUrl ? current ? `/admin/media/${current._id}` : "/admin/media/legacy-replace" : "/admin/upload", {
        method: current ? "PUT" : "POST", body,
      });
      setItems(list => [media, ...list.filter(item => item._id !== media._id)]);
      if (replaceUrl) onChange(multiple ? values.map(url => url === replaceUrl ? media.url : url) : media.url);
      else choose(media.url);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); onBusy?.(false); }
  }
  return <fieldset className="media-field">
    <legend>{label}</legend>
    <div className="media-previews">{values.map((url, index) => <div key={`${url}-${index}`}>
      <SiteImage src={url} alt={`Selected image ${index + 1}`} />
      <label className="upload-button">Replace everywhere<input hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { upload(e.target.files[0], url); e.target.value = ""; }} /></label>
      <button type="button" disabled={busy} className="text-link danger" onClick={() => onChange(multiple ? values.filter((_, i) => i !== index) : "")}>Remove</button>
      {multiple && index > 0 && <button type="button" className="text-link" disabled={busy} onClick={() => onChange([url, ...values.filter((_, i) => i !== index)])}>Make cover</button>}
    </div>)}</div>
    <div className="upload-row"><label className="upload-button">{busy ? "Uploading…" : multiple ? "Add Cloudinary image" : values.length ? "Upload replacement" : "Upload image"}
      <input hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { upload(e.target.files[0], !multiple ? values[0] : ""); e.target.value = ""; }} />
    </label><small>JPEG, PNG or WebP · maximum 5 MB</small></div>
    <select aria-label={`${label}: choose from Media Library`} disabled={busy} value="" onChange={e => e.target.value && choose(e.target.value)}><option value="">Or choose an existing Cloudinary image…</option>{items.map(item => <option key={item._id} value={item.url}>{item.name || item.publicId}</option>)}</select>
    <small>Save the record to apply these selections. To replace or delete a shared image everywhere, use Media Library.</small>
    {error && <p className="error" role="alert">{error}</p>}
  </fieldset>;
}

export default function MediaLibrary() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [skipSources, setSkipSources] = useState([]);
  useEffect(() => {
    let active = true;
    const load = () => api("/admin/media").then(result => active && setData(result)).catch(e => active && setError(e.message));
    load(); const interval = liveInterval(load, 10000);
    return () => { active = false; clearLiveInterval(interval); };
  }, []);
  async function perform(action) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); setData(await api("/admin/media")); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function send(file, item) {
    if (!file) return;
    if (item && !confirm("Replace this image everywhere it is used, including other packages and banners?")) return;
    await perform(async () => {
      const body = new FormData(); body.append("image", file);
      const result = await api(item ? `/admin/media/${item._id}` : "/admin/upload", { method: item ? "PUT" : "POST", body });
      setMessage(result.pendingCleanup ? "References updated. Old Cloudinary files need cleanup; use Retry cleanup." : item ? "Image replaced everywhere." : "Uploaded. Choose this image in a content editor.");
    });
  }
  return <>
    <span className="eyebrow">SHARED WEBSITE IMAGES</span><h1>Cloudinary Media Library</h1>
    <p className="muted">Manage every banner, destination, package, section and login image. Shared replacements update all database references.</p>
    <div className="admin-box media-toolbar"><label className="upload-button">Upload new image<input hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { send(e.target.files[0]); e.target.value = ""; }} /></label>
      <button className="button outline" disabled={busy} onClick={() => perform(async () => {
        const result = await api("/admin/media/migrate", { method: "POST", body: { skipSources } });
        setMessage(`Migrated ${result.migrated} images. Repeat for the next batch. Failed sources are skipped until you retry them.`);
        if (result.failures.length) {
          setSkipSources(values => [...new Set([...values, ...result.failures.map(f => f.source)])]);
          setError(result.failures.map(f => `${f.source}: ${f.message}`).join("\n"));
        }
      })}>{busy ? "Working…" : `Migrate existing images (${data?.remainingLegacy ?? "…"} remaining)`}</button>
      {!!skipSources.length && <button className="text-link" disabled={busy} onClick={() => { setSkipSources([]); setMessage("Failed sources will be retried in the next migration batch."); }}>Retry failed migration sources</button>}
      {!!data?.pendingCleanup && <button className="text-link" disabled={busy} onClick={() => perform(async () => {
        const result = await api("/admin/media/cleanup", { method: "POST", body: {} }); setMessage(`${result.pendingCleanup} assets still need cleanup.`);
      })}>Retry Cloudinary cleanup</button>}
    </div>
    {message && <p role="status" className="notice">{message}</p>}{error && <p className="error" role="alert" style={{ whiteSpace: "pre-line" }}>{error}</p>}
    <div className="media-grid">{data?.items.map(item => <article className="admin-box" key={item._id}>
      <SiteImage src={item.url} alt={item.name || "Website image"} /><p>{item.name || item.publicId}</p>
      <label className="upload-button">Replace everywhere<input hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { send(e.target.files[0], item); e.target.value = ""; }} /></label>
      <button className="text-link danger" disabled={busy} onClick={() => {
        if (!confirm("Delete this image from ALL website records and Cloudinary? Booking records will remain intact.")) return;
        perform(async () => {
          const result = await api(`/admin/media/${item._id}`, { method: "DELETE" });
          setMessage(result.pendingCleanup ? "Removed from the website. Cloudinary deletion needs retry." : "Image deleted everywhere.");
        });
      }}>Delete everywhere</button>
    </article>)}</div>
    {data && !data.items.length && <p className="empty-inline">Upload an image or migrate your existing images to get started.</p>}
  </>;
}
