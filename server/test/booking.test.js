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
} from "../src/models.js";
let repl, server, base, adminCookie, customerCookie, p, d, addon, booking;
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
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
before(
  async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET =
      "test-only-random-secret-which-is-over-32-characters";
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(repl.getUri());
    const { app } = await import("../src/index.js");
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.on("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
    const hash = await bcrypt.hash("TestPass!123", 4);
    await User.create([
      { name: "Admin", email: "admin@test.com", password: hash, role: "admin" },
      { name: "Customer", email: "customer@test.com", password: hash },
    ]);
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
    adminCookie = (
      await request("/auth/login", "POST", {
        email: "admin@test.com",
        password: "TestPass!123",
      })
    ).cookie;
    customerCookie = (
      await request("/auth/login", "POST", {
        email: "customer@test.com",
        password: "TestPass!123",
      })
    ).cookie;
  },
  { timeout: 900000 },
);
after(async () => {
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

test("admin catalogue edits reach public APIs and customers cannot escalate roles", async () => {
  const reg = await request("/auth/register", "POST", {
    name: "New User",
    email: "new@test.com",
    password: "SecureTest123!",
    role: "admin",
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.role, "customer");
  assert.equal(
    (await request("/admin/packages", "POST", {}, reg.cookie)).status,
    403,
  );
  const dest = await request(
    "/admin/destinations",
    "POST",
    {
      name: "Test Valley",
      description: "From the admin panel",
      image: "https://example.com/valley.jpg",
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
    images: ["https://example.com/tour.jpg"],
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
      image: "https://example.com/banner.jpg",
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
