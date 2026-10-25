import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  User,
  Package,
  Departure,
  Addon,
  Banner,
  Destination,
  Theme,
  Settings,
  Booking,
  entities,
} from "./models.js";
import { calculatePrice } from "./pricing.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
const allowedOrigins = [process.env.CLIENT_URL || "http://localhost:5173"];
if (process.env.NODE_ENV !== "production")
  allowedOrigins.push("http://127.0.0.1:5173", "http://localhost:5173");
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", rateLimit({ windowMs: 60000, limit: 300 }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("origin") &&
    !allowedOrigins.includes(req.get("origin"))
  )
    return res.status(403).json({ message: "Untrusted request origin." });
  next();
});
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const subscribers = new Set();
app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  });
  res.flushHeaders();
  res.write("data: connected\n\n");
  subscribers.add(res);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
  });
});
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    (req.path.startsWith("/admin/") || req.path.startsWith("/bookings"))
  )
    res.on("finish", () => {
      if (res.statusCode < 400)
        for (const subscriber of subscribers)
          subscriber.write("data: updated\n\n");
    });
  next();
});
const fail = (message, status = 400) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const auth = asyncRoute(async (req, res, next) => {
  try {
    const token = jwt.verify(req.cookies.session, process.env.JWT_SECRET);
    req.user = await User.findById(token.id);
    if (!req.user) throw Error();
    next();
  } catch {
    fail("Please sign in to continue.", 401);
  }
});
const admin = (req, res, next) =>
  req.user.role === "admin"
    ? next()
    : res.status(403).json({ message: "Admin access required." });
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  wishlist: u.wishlist,
});
const signIn = (res, u) => {
  res.cookie(
    "session",
    jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: "7d" }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 604800000,
    },
  );
  res.json(safeUser(u));
};
const loginLimit = rateLimit({ windowMs: 900000, limit: 30 });
app.get("/api/health", (req, res) =>
  res.json({
    status:
      mongoose.connection.readyState === 1 ? "ok" : "database-unavailable",
  }),
);
app.post(
  "/api/auth/register",
  loginLimit,
  asyncRoute(async (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z
          .string()
          .email()
          .transform((v) => v.toLowerCase()),
        password: z.string().min(8).max(100),
      })
      .parse(req.body);
    if (await User.exists({ email: data.email }))
      fail("Email already registered.");
    const u = await User.create({
      ...data,
      password: await bcrypt.hash(data.password, 12),
    });
    signIn(res, u);
  }),
);
app.post(
  "/api/auth/login",
  loginLimit,
  asyncRoute(async (req, res) => {
    const data = z
      .object({ email: z.string().email(), password: z.string().max(100) })
      .parse(req.body);
    const u = await User.findOne({ email: data.email.toLowerCase() }).select(
      "+password",
    );
    if (!u || !(await bcrypt.compare(data.password, u.password)))
      fail("Invalid email or password.", 401);
    signIn(res, u);
  }),
);
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});
app.get("/api/auth/me", auth, (req, res) => res.json(safeUser(req.user)));
app.put(
  "/api/auth/profile",
  auth,
  asyncRoute(async (req, res) => {
    req.user.name = z.string().trim().min(2).max(80).parse(req.body.name);
    await req.user.save();
    res.json(safeUser(req.user));
  }),
);
app.get(
  "/api/catalog",
  asyncRoute(async (req, res) => {
    const [destinations, themes, addons, banners, settings] = await Promise.all(
      [
        Destination.find({ active: true }),
        Theme.find({ active: true }),
        Addon.find({ active: true }),
        Banner.find({ active: true }),
        Settings.findOne({ key: "main" }),
      ],
    );
    res.json({ destinations, themes, addons, banners, settings });
  }),
);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
app.get(
  "/api/packages",
  asyncRoute(async (req, res) => {
    const { search, destination, theme, duration, featured } = req.query;
    const filter = { active: true };
    if (search)
      filter.$or = [
        {
          title: {
            $regex: escapeRegex(String(search).slice(0, 100)),
            $options: "i",
          },
        },
        {
          description: {
            $regex: escapeRegex(String(search).slice(0, 100)),
            $options: "i",
          },
        },
      ];
    if (destination && mongoose.isValidObjectId(destination))
      filter.destination = destination;
    if (theme && mongoose.isValidObjectId(theme)) filter.themes = theme;
    if (duration) {
      const [min, max] = String(duration).split("-").map(Number);
      filter.duration = { $gte: min || 1, $lte: max || 99 };
    }
    if (featured === "true") filter.featured = true;
    let items = await Package.find(filter)
      .populate("destination themes")
      .lean();
    const deps = await Departure.find({
      closed: false,
      date: { $gt: new Date() },
      $expr: { $gt: ["$totalSeats", "$bookedSeats"] },
    }).lean();
    items = items.map((p) => {
      const rates = deps
        .filter((d) => String(d.package) === String(p._id))
        .map((d) => d.adultRate * d.seasonMultiplier);
      return { ...p, fromPrice: rates.length ? Math.min(...rates) : null };
    });
    if (req.query.minPrice)
      items = items.filter(
        (p) =>
          p.fromPrice !== null && p.fromPrice >= Number(req.query.minPrice),
      );
    if (req.query.maxPrice)
      items = items.filter(
        (p) =>
          p.fromPrice !== null && p.fromPrice <= Number(req.query.maxPrice),
      );
    const sort = req.query.sort;
    if (sort === "price-asc")
      items.sort(
        (a, b) => (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity),
      );
    else if (sort === "price-desc")
      items.sort((a, b) => (b.fromPrice ?? -1) - (a.fromPrice ?? -1));
    else if (sort === "duration") items.sort((a, b) => a.duration - b.duration);
    else
      items.sort(
        (a, b) =>
          Number(b.featured) - Number(a.featured) ||
          new Date(b.createdAt) - new Date(a.createdAt),
      );
    const total = items.length;
    const page = Math.max(1, Number(req.query.page) || 1),
      limit = 9;
    res.json({
      items: items.slice((page - 1) * limit, page * limit),
      total,
      pages: Math.ceil(total / limit),
      page,
    });
  }),
);
app.get(
  "/api/packages/:id",
  asyncRoute(async (req, res) => {
    const p = await Package.findOne({
      _id: req.params.id,
      active: true,
    }).populate("destination themes");
    if (!p) fail("Package not found.", 404);
    const departures = await Departure.find({ package: p.id }).sort("date");
    res.json({ package: p, departures });
  }),
);
const selection = z.object({
  departure: z.string(),
  adults: z.number().int().min(1).max(30),
  children: z.number().int().min(0).max(29),
  sharing: z.enum(["twin", "triple", "single"]),
  addons: z.array(z.string()).max(30).default([]),
});
async function quote(body, session) {
  const data = selection.parse(body);
  let d = await Departure.findById(data.departure).session(session || null);
  if (!d) fail("Departure not found.", 404);
  const p = await Package.findOne({ _id: d.package, active: true }).session(
    session || null,
  );
  if (!p) fail("Package is unavailable.");
  if (d.closed || d.date <= new Date()) fail("Departure is closed.");
  if (d.totalSeats - d.bookedSeats < data.adults + data.children)
    fail("Not enough seats left.", 409);
  const ids = [...new Set(data.addons)];
  const addons = await Addon.find({ _id: { $in: ids }, active: true }).session(
    session || null,
  );
  if (addons.length !== ids.length) fail("An add-on is no longer available.");
  const settings = await Settings.findOne({ key: "main" }).session(
    session || null,
  );
  if (!settings) fail("Business settings are missing.", 503);
  return {
    data,
    d,
    p,
    settings,
    price: calculatePrice(d, data, addons, settings.gst),
  };
}
app.post(
  "/api/quote",
  asyncRoute(async (req, res) => res.json((await quote(req.body)).price)),
);
app.get(
  "/api/wishlist",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await Package.find({
        _id: { $in: req.user.wishlist },
        active: true,
      }).populate("destination"),
    ),
  ),
);
app.post(
  "/api/wishlist/:id",
  auth,
  asyncRoute(async (req, res) => {
    if (!(await Package.exists({ _id: req.params.id, active: true })))
      fail("Package not found.", 404);
    const has = req.user.wishlist.some((id) => String(id) === req.params.id);
    await User.updateOne(
      { _id: req.user.id },
      has
        ? { $pull: { wishlist: req.params.id } }
        : { $addToSet: { wishlist: req.params.id } },
    );
    res.json({ saved: !has });
  }),
);
app.post(
  "/api/bookings",
  auth,
  asyncRoute(async (req, res) => {
    let result;
    await mongoose.connection.transaction(async (session) => {
      const { data, d, p, settings, price } = await quote(req.body, session);
      const travellers = z
        .array(
          z.object({
            name: z.string().trim().min(2).max(100),
            age: z.number().int().min(0).max(120),
            idProof: z.string().trim().min(3).max(100),
          }),
        )
        .parse(req.body.travellers);
      if (travellers.length !== data.adults + data.children)
        fail("Enter every traveller’s details.");
      if (
        travellers.filter((t) => t.age <= settings.childAgeLimit).length !==
        data.children
      )
        fail(
          `Children must be aged ${settings.childAgeLimit} or below. Check traveller ages.`,
        );
      if (
        typeof req.body.expectedTotal !== "number" ||
        Math.abs(req.body.expectedTotal - price.total) > 0.01
      )
        fail(
          "Price has changed. Review the updated total and book again.",
          409,
        );
      const reserved = await Departure.updateOne(
        {
          _id: d.id,
          closed: false,
          date: { $gt: new Date() },
          $expr: {
            $gte: [
              { $subtract: ["$totalSeats", "$bookedSeats"] },
              travellers.length,
            ],
          },
        },
        { $inc: { bookedSeats: travellers.length } },
        { session },
      );
      if (!reserved.modifiedCount)
        fail("Seats changed. Please choose another departure.", 409);
      [result] = await Booking.create(
        [{ ...data, user: req.user.id, package: p.id, travellers, price }],
        { session },
      );
    });
    res.status(201).json(result);
  }),
);
app.get(
  "/api/bookings",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await Booking.find({ user: req.user.id })
        .populate("package departure")
        .sort("-createdAt"),
    ),
  ),
);
async function changeStatus(id, status, user) {
  if (!["Pending", "Confirmed", "Completed", "Cancelled"].includes(status))
    fail("Invalid booking status.");
  let result;
  await mongoose.connection.transaction(async (session) => {
    const b = await Booking.findById(id).session(session);
    if (!b) fail("Booking not found.", 404);
    if (user.role !== "admin" && String(b.user) !== user.id)
      fail("Access denied.", 403);
    if (user.role !== "admin" && status !== "Cancelled")
      fail("Access denied.", 403);
    if (b.status === status) {
      result = b;
      return;
    }
    if (b.status === "Cancelled")
      fail("Cancelled bookings cannot be reopened.");
    if (b.status === "Completed") fail("Completed bookings cannot be changed.");
    if (user.role !== "admin") {
      const d = await Departure.findById(b.departure).session(session);
      const settings = await Settings.findOne({ key: "main" }).session(session);
      if (
        new Date(d.date) - Date.now() <
        settings.cancellationCutoff * 86400000
      )
        fail("The cancellation cut-off has passed. Contact the agency.");
    }
    if (status === "Cancelled")
      await Departure.updateOne(
        { _id: b.departure },
        { $inc: { bookedSeats: -(b.adults + b.children) } },
        { session },
      );
    b.status = status;
    await b.save({ session });
    result = b;
  });
  return result;
}
app.post(
  "/api/bookings/:id/cancel",
  auth,
  asyncRoute(async (req, res) =>
    res.json(await changeStatus(req.params.id, "Cancelled", req.user)),
  ),
);
app.use("/api/admin", auth, admin);
app.get(
  "/api/admin/dashboard",
  asyncRoute(async (req, res) => {
    const now = new Date(),
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [users, bookings, monthlyDepartures, revenue, departures] =
      await Promise.all([
        User.countDocuments({ role: "customer" }),
        Booking.countDocuments(),
        Departure.find({ date: { $gte: now, $lt: end }, closed: false }),
        Booking.aggregate([
          { $match: { status: { $in: ["Confirmed", "Completed"] } } },
          { $group: { _id: null, total: { $sum: "$price.total" } } },
        ]),
        Departure.find({ date: { $gte: now } })
          .populate("package")
          .sort("date")
          .limit(12),
      ]);
    res.json({
      users,
      bookings,
      revenue: revenue[0]?.total || 0,
      seatsLeft: monthlyDepartures.reduce(
        (s, d) => s + d.totalSeats - d.bookedSeats,
        0,
      ),
      departures,
    });
  }),
);
app.get(
  "/api/admin/settings",
  asyncRoute(async (req, res) =>
    res.json(await Settings.findOne({ key: "main" })),
  ),
);
const settingsSchema = z.object({
  businessName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().max(50),
  gst: z.number().min(0).max(100),
  childAgeLimit: z.number().int().min(1).max(17),
  cancellationCutoff: z.number().int().min(0).max(365),
});
app.put(
  "/api/admin/settings",
  asyncRoute(async (req, res) =>
    res.json(
      await Settings.findOneAndUpdate(
        { key: "main" },
        settingsSchema.parse(req.body),
        { new: true, upsert: true, runValidators: true },
      ),
    ),
  ),
);
app.get(
  "/api/admin/bookings",
  asyncRoute(async (req, res) =>
    res.json(
      await Booking.find()
        .populate("user", "name email")
        .populate("package departure")
        .sort("-createdAt"),
    ),
  ),
);
app.put(
  "/api/admin/bookings/:id",
  asyncRoute(async (req, res) =>
    res.json(await changeStatus(req.params.id, req.body.status, req.user)),
  ),
);
fs.mkdirSync(path.join(root, "uploads"), { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(root, "uploads"),
    filename: (req, file, cb) =>
      cb(
        null,
        `${Date.now()}-${crypto.randomUUID()}.${file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : "jpg"}`,
      ),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
app.post("/api/admin/upload", upload.single("image"), (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ message: "Upload a JPG, PNG or WebP image (max 5 MB)." });
  res.json({ url: `/uploads/${req.file.filename}` });
});
app.use(
  "/uploads",
  express.static(path.join(root, "uploads"), {
    setHeaders: (res) =>
      res.set("Content-Security-Policy", "default-src 'none'"),
  }),
);
const str = z.string().trim().max(10000),
  id = z
    .string()
    .refine((v) => mongoose.isValidObjectId(v), "Invalid reference"),
  image = z
    .string()
    .refine(
      (v) => !v || v.startsWith("/uploads/") || /^https:\/\//.test(v),
      "Use an HTTPS image URL or upload an image",
    );
const schemas = {
  destinations: z.object({
    name: str.min(1),
    description: str,
    image,
    active: z.boolean(),
  }),
  themes: z.object({ name: str.min(1), active: z.boolean() }),
  addons: z.object({
    name: str.min(1),
    price: z.number().min(0),
    perPerson: z.boolean(),
    active: z.boolean(),
  }),
  banners: z.object({
    title: str.min(1),
    subtitle: str,
    image,
    buttonText: str,
    link: z
      .string()
      .regex(/^\/(?!\/)/, "Use an internal path such as /packages"),
    active: z.boolean(),
  }),
  packages: z.object({
    title: str.min(1),
    description: str,
    destination: id,
    themes: z.array(id),
    duration: z.number().int().min(1).max(365),
    images: z.array(image),
    itinerary: z.array(
      z.object({ day: z.number().int().min(1), title: str, description: str }),
    ),
    inclusions: z.array(str),
    exclusions: z.array(str),
    hotelCategory: str,
    featured: z.boolean(),
    active: z.boolean(),
  }),
  departures: z.object({
    package: id,
    date: z.string().datetime(),
    totalSeats: z.number().int().min(0),
    adultRate: z.number().min(0),
    childRate: z.number().min(0),
    singleCharge: z.number().min(0),
    tripleCharge: z.number(),
    season: z.enum(["off-season", "normal", "peak"]),
    seasonMultiplier: z.number().min(0.1).max(10),
    closed: z.boolean(),
  }),
};
const entity = (req) => {
  const M = entities[req.params.entity];
  if (!M) fail("Unknown resource.", 404);
  return M;
};
app.get(
  "/api/admin/:entity",
  asyncRoute(async (req, res) => {
    const M = entity(req);
    let q = M.find().sort("-createdAt");
    if (req.params.entity === "packages") q = q.populate("destination themes");
    if (req.params.entity === "departures") q = q.populate("package");
    res.json(await q);
  }),
);
async function validateEntity(type, body) {
  const data = schemas[type].parse(body);
  if (type === "packages") {
    if (!(await Destination.exists({ _id: data.destination })))
      fail("Choose an existing destination.");
    if (
      (await Theme.countDocuments({ _id: { $in: data.themes } })) !==
      new Set(data.themes).size
    )
      fail("Choose existing themes.");
  }
  if (type === "departures" && !(await Package.exists({ _id: data.package })))
    fail("Choose an existing package.");
  return data;
}
app.post(
  "/api/admin/:entity",
  asyncRoute(async (req, res) => {
    const M = entity(req);
    res
      .status(201)
      .json(await M.create(await validateEntity(req.params.entity, req.body)));
  }),
);
app.put(
  "/api/admin/:entity/:id",
  asyncRoute(async (req, res) => {
    const M = entity(req),
      data = await validateEntity(req.params.entity, req.body);
    let result;
    await mongoose.connection.transaction(async (session) => {
      const current = await M.findById(req.params.id).session(session);
      if (!current) fail("Record not found.", 404);
      if (req.params.entity === "departures") {
        if (data.totalSeats < current.bookedSeats)
          fail(
            `Cannot reduce capacity below ${current.bookedSeats} reserved seats.`,
          );
        if (String(current.package) !== data.package && current.bookedSeats)
          fail("Cannot move a departure with bookings.");
      }
      Object.assign(current, data);
      await current.save({ session });
      result = current;
    });
    res.json(result);
  }),
);
app.delete(
  "/api/admin/:entity/:id",
  asyncRoute(async (req, res) => {
    const M = entity(req),
      type = req.params.entity,
      id = req.params.id;
    await mongoose.connection.transaction(async (session) => {
      const exists = await M.findById(id).session(session);
      if (!exists) fail("Record not found.", 404);
      if (
        type === "departures" &&
        (await Booking.exists({ departure: id }).session(session))
      )
        fail("Departure has booking history. Close it instead.");
      if (
        type === "packages" &&
        ((await Booking.exists({ package: id }).session(session)) ||
          (await Departure.exists({ package: id }).session(session)))
      )
        fail("Package has departures or bookings. Unpublish it instead.");
      if (
        type === "destinations" &&
        (await Package.exists({ destination: id }).session(session))
      )
        fail("Destination is used by a package. Deactivate it instead.");
      if (
        type === "themes" &&
        (await Package.exists({ themes: id }).session(session))
      )
        fail("Theme is used by a package. Deactivate it instead.");
      await M.deleteOne({ _id: id }, { session });
    });
    res.json({ ok: true });
  }),
);
const dist = path.resolve(root, "../client/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
}
app.use((err, req, res, next) => {
  if (err instanceof z.ZodError)
    return res.status(400).json({
      message: err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  if (err.code === 11000)
    return res.status(409).json({ message: "This record already exists." });
  const status =
    err.status ||
    (["ValidationError", "CastError"].includes(err.name) ? 400 : 500);
  if (status === 500) console.error(err.message);
  res.status(status).json({
    message:
      status === 500
        ? "The server could not complete this request. Please try again."
        : err.message,
  });
});
export { app };
if (process.env.NODE_ENV !== "test") {
  if (
    !process.env.MONGODB_URI ||
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32
  ) {
    console.error(
      "Configure server/.env with MONGODB_URI and a JWT_SECRET of at least 32 characters. See README.md.",
    );
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  app.listen(process.env.PORT || 4000, () =>
    console.log(
      `Roam API running at http://localhost:${process.env.PORT || 4000}`,
    ),
  );
}
