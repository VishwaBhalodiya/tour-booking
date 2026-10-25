# Roam — Tour Package Booking

A MERN travel booking application with an admin-controlled catalogue, MongoDB Atlas, Express, React and Node.js. The project lives directly at `C:\tour-booking`.

## Requirements

- Node.js 22 or later and npm
- MongoDB Atlas cluster (transactions require a replica set; Atlas supports this)
- Git for source control

## Setup — Windows PowerShell

1. Open the project:
   ```powershell
   cd C:\tour-booking
   npm.cmd install
   ```
2. If the local environment file has not already been created:
   ```powershell
   Copy-Item server/.env.example server/.env
   ```
3. Set up [MongoDB Atlas](https://www.mongodb.com/docs/atlas/driver-connection/):
   - Create a project and a cluster.
   - Create a database user. This is separate from your Atlas account.
   - Add your current IP under Network Access.
   - Select **Connect → Drivers → Node.js**, then copy the URI.
   - In `server/.env`, replace `MONGODB_URI` with that URI. Replace the password placeholder with the URL-encoded database-user password and use `tour_booking` as the database name before the `?`.
   - Set `JWT_SECRET` to a random secret of at least 32 characters. A locally generated secret is included if the environment file was prepared by the agent. Never commit this file.
4. Add sample content and test accounts:
   ```powershell
   npm.cmd run seed
   ```
   The seed preserves existing records and does not reset passwords. It creates Goa, Manali, Kerala and Rajasthan, themes, departure prices, itinerary days, add-ons, a banner and settings in MongoDB. Sample dates are generated relative to the day seeding runs.
5. Start both applications:
   ```powershell
   npm.cmd run dev
   ```
6. Open **http://localhost:5173**. API: **http://localhost:4000/api/health**. Admin: **http://localhost:5173/admin**.

## Test logins

These are seeded from `server/.env`; customize the variables before seeding if desired.

| Role | Email | Password |
|---|---|---|
| Admin | admin@roam.test | ChangeMe!Admin2026 |
| Customer | customer@roam.test | ChangeMe!Customer2026 |

Use these only for local evaluation. Public deployment should use new credentials. Registration always creates a customer; roles are never accepted from registration input.

## What the admin controls

- Packages: publish/unpublish, featured state, destination, themes, duration, image uploads or HTTPS image URLs, hotel category, day-wise itinerary, inclusions and exclusions.
- Departures: date, capacity, adult/child base rates, season and its explicit multiplier, single-room supplements, triple-sharing adjustment and closed state.
- Destinations, themes, add-ons and home banners: create, edit, deactivate and delete when not referenced.
- Bookings: traveller/ID details, stored price breakdown, status and cancellation.
- Settings: business name, contact details, GST, child age limit and cancellation cut-off.

Customer home content comes from the database. Admin mutations publish a server-sent event that refreshes open customer pages; polling is a fallback. Static layout text and design labels are presentation copy, while all tour content and business rules are database-driven. There is no mock-data fallback when Atlas is disconnected.

## Pricing and inventory rules

```text
adult total = adult base rate × departure season multiplier × adults
child total = child base rate × departure season multiplier × children
room charge = chosen sharing adjustment × all travellers
extras = sum(per-booking price OR per-traveller price × all travellers)
subtotal = adult total + child total + room charge + extras
GST = subtotal × configured GST percentage / 100
total = subtotal + GST
```

Twin adjustment is zero. Triple adjustment may be negative (a discount); single adjustment is a non-negative supplement. The multiplier is explicit for each departure, so an admin can define seasonal pricing without a fixed multiplier hidden in code. Listing prices show the lowest adult seasonal rate among future open departures with seats, before GST and extras.

Quotes and bookings are calculated on the server. Booking rejects a stale total and requires a fresh review. An existing booking retains its agreed price; changing a rate changes new quotes, not historical booking totals. Traveller ages must match the configured adult/child split. Every traveller reserves one seat, including children.

MongoDB transactions reserve seats and create a booking together. Concurrent reservations cannot exceed capacity. Pending, Confirmed and Completed bookings retain seats. Cancelling returns seats once; cancelled bookings cannot be reopened. Customers can cancel only before the configured cut-off. Admins may cancel regardless of cut-off. Completed bookings cannot be changed. Capacity cannot be reduced below already reserved seats. Referenced packages/departures cannot be deleted; hide or close them instead to preserve history.

Revenue on the dashboard means the value of Confirmed and Completed bookings; payments are Pay Later, so it is not cash collected. Upcoming departures and remaining seats are calculated for the current server calendar month.

## Verification

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit
```

Tests cover seasonal adult/child prices, sharing discounts, add-ons, GST, invalid inputs, API authorization, tampered totals, capacity constraints, cancellation idempotency, changed rates, closed departures and concurrent booking attempts. Integration tests start an isolated temporary MongoDB replica set through `mongodb-memory-server`; the first run downloads a MongoDB binary and needs network access. They never connect to or modify your Atlas data. Normal application commands require Atlas.

## Admin-control evaluation walkthrough

1. Sign in as admin; add or edit a destination, theme and package.
2. Add an itinerary day and upload an image. Feature the package and publish it.
3. Add a future departure with seats and different adult/child rates. Set peak season and multiplier `1.25`.
4. Open the customer site in another browser/session. Verify the package and banner content.
5. Select 2 adults, 1 child, single sharing and an add-on. Check the full price breakup.
6. Change the departure rate or GST as admin; verify the open quote updates.
7. Book using the customer login with correct traveller ages and Pay Later. Check the reservation under My bookings and admin Bookings.
8. Confirm then cancel the booking as admin; verify seats return. Repeat cancellation and verify no extra seats are returned.
9. Close a departure; verify the customer cannot select it or book it. Attempt admin access with the customer login; the server returns 403.

## Screenshots

Screenshots captured during verification will be placed in `docs/screenshots/` and linked here. Capture the database-backed home page, package price breakup and admin dashboard after the seed runs if screenshots are not yet present.

## GitHub — public repository

The `.gitignore` excludes environment secrets, dependencies, built files and uploaded images. `.env.example` is tracked. Local commits document implementation milestones.

If GitHub authentication is not available in the coding environment:

1. Sign in to GitHub and select **New repository**.
2. Name it `tour-booking`, choose **Public**, and leave README, license and gitignore unchecked.
3. Run these commands with your own GitHub username:
   ```powershell
   cd C:\tour-booking
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/tour-booking.git
   git push -u origin main
   ```
4. Complete the browser login if Git Credential Manager asks.

## Production / optional deployment

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Express serves the built React client and API from one origin. Set `NODE_ENV=production`, `MONGODB_URI`, a strong `JWT_SECRET`, `PORT` and `CLIENT_URL` (the exact HTTPS public origin) on your Node hosting provider. Add the hosting server's egress IP to Atlas Network Access. Use HTTPS; production auth cookies are secure. Uploaded images use `server/uploads`, so attach persistent storage at that path before deploying. An external image-storage provider is a future extension for hosts without persistent disks. Keep a single server instance for the current in-process SSE broadcast, or add a shared event broker when scaling.

The bonus coupon, payment gateway, advance-payment schedule and PDF voucher features are not included. This version implements the required Pay Later flow.

## Structure

```text
client/src/main.jsx       Customer pages, auth, booking and wishlist
client/src/Admin.jsx      Admin dashboard and editors
client/src/api.js         API client and live refresh
client/src/style.css      Responsive design
server/src/index.js       Express routes, access checks and transactions
server/src/models.js      Mongoose models
server/src/pricing.js     Shared server pricing calculation
server/src/seed.js        Idempotent sample content and test accounts
server/test/              Unit and MongoDB integration tests
```

Passwords use bcrypt; auth uses an HttpOnly JWT cookie with SameSite protection, origin checks and request limits. Uploaded files are limited to JPEG/PNG/WebP and 5 MB. For real customers' ID data, add encryption at rest appropriate to your business, retention controls and the relevant privacy policy before collecting production data.
