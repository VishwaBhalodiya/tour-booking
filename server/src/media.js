import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import multer from "multer";
import { Package, Destination, Banner, Section, Media } from "./models.js";

const models = [Package, Destination, Banner, Section];
const maxBytes = 5 * 1024 * 1024;
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const error = (message, status = 400) => Object.assign(new Error(message), { status });

function credentials() {
  const name = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name) || !key || !secret) {
    throw error("Configure Cloudinary credentials in server/.env, then restart the API.", 503);
  }
  return { name, authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` };
}

async function cloudRequest(action, form) {
  const { name, authorization } = credentials();
  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${name}/image/${action}`, {
      method: "POST", headers: { Authorization: authorization }, body: form,
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw error("Cloudinary could not be reached. Please retry.", 502);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw error("Cloudinary rejected the image request. Check credentials, image format and account limits.", 502);
  }
  return result;
}

function imageMime(bytes) {
  if (bytes.length > maxBytes || bytes.length < 12) throw error("Use a valid image no larger than 5 MB.");
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw error("Only JPEG, PNG and WebP images are supported.");
}

async function uploadImage(source) {
  const form = new FormData();
  if (Buffer.isBuffer(source)) form.append("file", new Blob([source], { type: imageMime(source) }), "image");
  else form.append("file", source);
  form.append("public_id", `tour-booking/${randomUUID()}`);
  form.append("overwrite", "false");
  form.append("format", "webp");
  form.append("transformation", "c_limit,w_2400,h_2400");
  const result = await cloudRequest("upload", form);
  const prefix = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/`;
  if (!result.secure_url?.startsWith(prefix) || !result.public_id?.startsWith("tour-booking/")) {
    throw error("Cloudinary returned an invalid image response.", 502);
  }
  return { url: result.secure_url, publicId: result.public_id };
}

async function destroy(publicId) {
  if (!publicId?.startsWith("tour-booking/")) throw error("Image is outside this application's media folder.");
  const form = new FormData();
  form.append("public_id", publicId);
  form.append("invalidate", "true");
  const result = await cloudRequest("destroy", form);
  if (!["ok", "not found"].includes(result.result)) throw error("Cloudinary deletion was not completed.", 502);
}

// Files are never removed until database references have been changed successfully.
// Failed CDN cleanup remains recorded for an explicit admin retry.
async function cleanup(media) {
  const completed = [];
  for (const id of [...new Set(media.cleanupIds || [])]) {
    try { await destroy(id); completed.push(id); } catch { /* Keep for retry. */ }
  }
  if (completed.length) await Media.updateOne({ _id: media._id }, { $pull: { cleanupIds: { $in: completed } } });
  return (await Media.findById(media._id).select("cleanupIds"))?.cleanupIds.length || 0;
}

async function replaceReferences(oldUrl, newUrl, session) {
  for (const Model of models) {
    if (Model === Package) {
      await Model.updateMany({ images: oldUrl }, newUrl
        ? { $set: { "images.$[image]": newUrl } }
        : { $pull: { images: oldUrl } }, {
          session, ...(newUrl ? { arrayFilters: [{ image: oldUrl }] } : {}),
        });
    } else {
      await Model.updateMany({ image: oldUrl }, { $set: { image: newUrl } }, { session });
    }
  }
}

export async function normalizeImageReferences(data, existing = {}) {
  const previous = new Set([existing.image, ...(existing.images || [])].filter(Boolean));
  async function canonical(url) {
    if (!url) return "";
    const media = await Media.findOne({ $or: [{ url }, { legacyUrls: url }] });
    if (media) {
      if (media.deleted) throw error("This image was deleted. Choose another image from the Media Library.");
      return media.url;
    }
    // Preserve unchanged legacy content until the administrator runs migration.
    if (previous.has(url)) return url;
    throw error("Upload or choose an image from the Cloudinary Media Library.");
  }
  if (Object.hasOwn(data, "image")) data.image = await canonical(data.image);
  if (Array.isArray(data.images)) data.images = [...new Set(await Promise.all(data.images.filter(Boolean).map(canonical)))];
  return data;
}

async function legacyReferences() {
  const urls = new Set();
  for (const Model of models) {
    for (const doc of await Model.find().select("image images").lean()) {
      for (const url of [doc.image, ...(doc.images || [])]) if (url) urls.add(url);
    }
  }
  return [...urls];
}

async function legacySource(url, uploads) {
  if (url.startsWith("/uploads/")) {
    const filename = url.slice("/uploads/".length);
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw error("Invalid legacy image filename.");
    const directory = await fs.realpath(uploads);
    const target = await fs.realpath(path.join(directory, filename));
    if (path.dirname(target) !== directory || (await fs.stat(target)).size > maxBytes) throw error("Invalid or oversized legacy image.");
    const bytes = await fs.readFile(target);
    imageMime(bytes);
    return bytes;
  }
  let parsed;
  try { parsed = new URL(url); } catch { throw error("Invalid legacy image URL."); }
  const hosts = new Set(["images.unsplash.com", "res.cloudinary.com", ...(process.env.CLOUDINARY_MIGRATION_HOSTS || "").split(",").map(v => v.trim()).filter(Boolean)]);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !hosts.has(parsed.hostname)) {
    throw error("Legacy host is not allowed. Upload the original file or allow its trusted hostname in CLOUDINARY_MIGRATION_HOSTS.");
  }
  return parsed.href;
}

export function registerMediaRoutes(app, uploads) {
  // The caller mounts these routes after the shared /api/admin role boundary.
  const receive = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) => cb(["image/jpeg", "image/png", "image/webp"].includes(file.mimetype) ? null : error("Use JPEG, PNG or WebP."), true),
  }).single("image");
  const requireFile = file => { if (!file) throw error("Choose an image to upload."); return file.buffer; };

  app.get("/api/admin/media", wrap(async (req, res) => {
    const items = await Media.find({ deleted: false }).sort("-createdAt").lean();
    const deleted = await Media.find({ deleted: true }).select("url legacyUrls").lean();
    const references = await legacyReferences();
    const known = new Set(items.map(m => m.url));
    const pendingCleanup = await Media.countDocuments({ "cleanupIds.0": { $exists: true } });
    res.json({ items, removedUrls: deleted.flatMap(item => [item.url, ...(item.legacyUrls || [])]), remainingLegacy: references.filter(url => !known.has(url)).length, pendingCleanup });
  }));

  app.post("/api/admin/upload", receive, wrap(async (req, res) => {
    const uploaded = await uploadImage(requireFile(req.file));
    let media;
    try { media = await Media.create({ ...uploaded, name: req.file.originalname.slice(0, 150) }); }
    catch (err) { await destroy(uploaded.publicId).catch(() => {}); throw err; }
    res.status(201).json(media);
  }));

  app.post("/api/admin/media/legacy-replace", receive, wrap(async (req, res) => {
    const source = req.body.source;
    if (typeof source !== "string" || source.length > 2048 || !(await legacyReferences()).includes(source)) {
      throw error("Legacy image is no longer referenced. Reload the editor.", 409);
    }
    if (await Media.exists({ $or: [{ url: source }, { legacyUrls: source }] })) {
      throw error("Image has already been migrated. Reload the editor and choose its Cloudinary version.", 409);
    }
    const uploaded = await uploadImage(requireFile(req.file));
    let result;
    try {
      await mongoose.connection.transaction(async session => {
        [result] = await Media.create([{ ...uploaded, name: req.file.originalname.slice(0, 150), legacyUrls: [source] }], { session });
        await replaceReferences(source, uploaded.url, session);
      });
    } catch (err) { await destroy(uploaded.publicId).catch(() => {}); throw err; }
    app.locals.publishContent?.();
    res.json(result);
  }));

  app.put("/api/admin/media/:id", receive, wrap(async (req, res) => {
    const current = await Media.findOne({ _id: req.params.id, deleted: false });
    if (!current) throw error("Image not found.", 404);
    const uploaded = await uploadImage(requireFile(req.file));
    let result;
    try {
      await mongoose.connection.transaction(async session => {
        const media = await Media.findOne({ _id: current.id, url: current.url, deleted: false }).session(session);
        if (!media) throw error("Image changed. Reload the Media Library and retry.", 409);
        await replaceReferences(media.url, uploaded.url, session);
        media.legacyUrls.addToSet(media.url);
        media.cleanupIds.addToSet(media.publicId);
        media.url = uploaded.url;
        media.publicId = uploaded.publicId;
        media.name = req.file.originalname.slice(0, 150);
        await media.save({ session }); result = media;
      });
    } catch (err) { await destroy(uploaded.publicId).catch(() => {}); throw err; }
    app.locals.publishContent?.();
    const pendingCleanup = await cleanup(result);
    res.json({ ...result.toObject(), pendingCleanup });
  }));

  app.delete("/api/admin/media/:id", wrap(async (req, res) => {
    credentials();
    let result;
    await mongoose.connection.transaction(async session => {
      const media = await Media.findById(req.params.id).session(session);
      if (!media) throw error("Image not found.", 404);
      if (!media.deleted) {
        for (const url of [media.url, ...media.legacyUrls]) await replaceReferences(url, "", session);
        media.deleted = true;
        media.cleanupIds.addToSet(media.publicId);
        await media.save({ session });
      }
      result = media;
    });
    app.locals.publishContent?.();
    res.json({ ok: true, pendingCleanup: await cleanup(result) });
  }));

  app.post("/api/admin/media/cleanup", wrap(async (req, res) => {
    credentials();
    for (const media of await Media.find({ "cleanupIds.0": { $exists: true } })) await cleanup(media);
    res.json({ pendingCleanup: await Media.countDocuments({ "cleanupIds.0": { $exists: true } }) });
  }));

  app.post("/api/admin/media/migrate", wrap(async (req, res) => {
    credentials();
    let migrated = 0;
    const failures = [];
    // Small, repeatable batches avoid long requests. Failed references are preserved.
    const urls = [];
    const skipped = new Set(Array.isArray(req.body?.skipSources) ? req.body.skipSources.filter(value => typeof value === "string").slice(0, 500) : []);
    for (const url of await legacyReferences()) {
      if (skipped.has(url.split("?")[0])) continue;
      if (!await Media.exists({ url, deleted: false })) urls.push(url);
      if (urls.length === 5) break;
    }
    for (const oldUrl of urls) {
      let uploaded;
      try {
        const known = await Media.findOne({ legacyUrls: oldUrl, deleted: false });
        uploaded = known || await uploadImage(await legacySource(oldUrl, uploads));
        await mongoose.connection.transaction(async session => {
          if (!known) await Media.create([{ ...uploaded, name: "Migrated image", legacyUrls: [oldUrl] }], { session });
          await replaceReferences(oldUrl, uploaded.url, session);
        });
        migrated++;
        app.locals.publishContent?.();
      } catch (err) {
        if (uploaded && !(uploaded instanceof mongoose.Document)) await destroy(uploaded.publicId).catch(() => {});
        // Do not expose signed URL query strings or upstream errors in responses.
        failures.push({ source: oldUrl.split("?")[0], message: err.status ? err.message : "Migration failed; original reference was kept." });
      }
    }
    res.json({ migrated, failures, batchSize: urls.length });
  }));
}
