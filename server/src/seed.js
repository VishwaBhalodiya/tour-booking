import "dotenv/config";
import mongoose from "mongoose";
import {
  Destination,
  Theme,
  Package,
  Departure,
  Addon,
  Banner,
  Settings,
} from "./models.js";
if (!process.env.MONGODB_URI)
  throw Error("Set MONGODB_URI in server/.env first.");
await mongoose.connect(process.env.MONGODB_URI);
try {
  // Authentication accounts are created only by verified sign-in flows.
  await Settings.findOneAndUpdate(
    { key: "main" },
    {
      $setOnInsert: {
        businessName: "Roam",
        gst: 5,
        childAgeLimit: 11,
        cancellationCutoff: 7,
        email: "hello@roam.test",
        phone: "+91 98765 43210",
      },
    },
    { upsert: true },
  );
  const themes = await Promise.all(
    ["Family", "Honeymoon", "Adventure"].map((name) =>
      Theme.findOneAndUpdate(
        { name },
        { $setOnInsert: { name, active: true } },
        { upsert: true, new: true },
      ),
    ),
  );
  const places = [
    [
      "Goa",
      "Salt in the air. Time on your side.",
      "The slow life, Goa",
      5,
      14900,
      "Beach walks, Portuguese lanes and sunsets you’ll want to stay for.",
    ],
    [
      "Manali",
      "Find your kind of mountain high.",
      "Into the Himalayas",
      6,
      18900,
      "Pine-scented trails, snow-capped peaks and a little mountain magic.",
    ],
    [
      "Kerala",
      "Let the backwaters set the pace.",
      "A greener kind of getaway",
      7,
      24900,
      "Houseboats, tea gardens and the extraordinary beauty of slowing down.",
    ],
    [
      "Rajasthan",
      "Every fort has a story. Find yours.",
      "Royal roads of Rajasthan",
      6,
      21900,
      "Pink cities, golden dunes and warm welcomes on a journey through history.",
    ],
  ];
  for (const [name, description, title, duration, rate, copy] of places) {
    const destination = await Destination.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, description, image: "", active: true } },
      { new: true, upsert: true },
    );
    if (await Package.exists({ title })) continue;
    const p = await Package.create({
      title,
      description: copy,
      destination: destination.id,
      themes: [themes[name === "Manali" ? 2 : name === "Kerala" ? 1 : 0].id],
      duration,
      images: [],
      hotelCategory: "4-star boutique stays",
      featured: true,
      active: true,
      inclusions: [
        "Handpicked hotels with daily breakfast",
        "Comfortable AC group transfers",
        "Local guide and curated experiences",
        "All applicable hotel taxes",
      ],
      exclusions: [
        "Flights or train tickets",
        "Lunch, dinner and personal expenses",
        "Activities not mentioned in itinerary",
      ],
      itinerary: Array.from({ length: duration }, (_, i) => ({
        day: i + 1,
        title:
          i === 0
            ? "Arrive & settle into holiday mode"
            : i === duration - 1
              ? "One last breakfast, then home"
              : `Discover ${name} — day ${i + 1}`,
        description:
          i === 0
            ? "Meet your tour host, check into your hotel and enjoy an easy evening exploring the neighbourhood."
            : i === duration - 1
              ? "Enjoy breakfast before your included departure transfer. Carry the memories home."
              : "After breakfast, explore local landmarks with your guide. Enjoy time for photographs, local flavours and discoveries at your own pace.",
      })),
    });
    for (let i = 0; i < 4; i++) {
      const date = new Date();
      date.setDate(date.getDate() + 15 + i * 16);
      date.setHours(10, 0, 0, 0);
      await Departure.create({
        package: p.id,
        date,
        totalSeats: 24,
        adultRate: rate,
        childRate: Math.round(rate * 0.65),
        singleCharge: 3000,
        tripleCharge: -700,
        season: i === 2 ? "peak" : i === 0 ? "off-season" : "normal",
        seasonMultiplier: i === 2 ? 1.25 : i === 0 ? 0.9 : 1,
        closed: false,
      });
    }
  }
  for (const a of [
    { name: "Airport pickup", price: 1500, perPerson: false },
    { name: "Sightseeing tickets", price: 850, perPerson: true },
    { name: "Travel insurance", price: 399, perPerson: true },
  ])
    await Addon.findOneAndUpdate(
      { name: a.name },
      { $setOnInsert: { ...a, active: true } },
      { upsert: true },
    );
  if (!(await Banner.exists({})))
    await Banner.create({
      title: "Somewhere new.\nSomething you.",
      subtitle:
        "Thoughtfully planned group journeys. Extraordinary places. Just the right company.",
      image: "",
      buttonText: "Find your next escape",
      link: "/packages",
      active: true,
    });
  console.log(
    "Catalogue seed complete. Existing records were preserved. Authentication uses Supabase customers and the configured backend administrator.",
  );
} finally {
  await mongoose.disconnect();
}

