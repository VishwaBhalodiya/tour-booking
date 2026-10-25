# Roam — Tour Package Booking

A MERN travel booking application with a customer website and an admin panel sharing MongoDB Atlas. Administrators manage tour content, departure availability, pricing and website images.

## Features

### Customer website

- Browse and search packages with destination, duration, theme and price filters, sorting and pagination.
- View galleries, day-wise itineraries, hotel categories, inclusions, exclusions and departure availability.
- Get live price breakdowns for adults, children, seasonal rates, room sharing, add-ons and GST.
- Register and sign in through Supabase Auth with email verification, resend verification and password recovery.
- Manage a profile, wishlist, traveller details and Pay Later bookings.
- View booking status and cancel eligible bookings.

### Admin panel

- Separate administrator login with backend-enforced authorization.
- Dashboard showing booking revenue, users, upcoming departures and seat availability.
- Manage packages, destinations, themes, departures, seasonal rates and add-ons.
- Publish, unpublish and feature packages; manage banners and website sections.
- Upload, replace and delete shared Cloudinary images through the Media Library.
- Process bookings and configure GST, child age limits, cancellation cut-offs and business details.

Catalogue updates notify open customer pages through server-sent events, with polling and reconnect refreshes.

## Tech stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, React Router 7, Vite 6, Lucide icons, CSS |
| Backend | Node.js 22, Express 4 |
| Database | MongoDB Atlas, Mongoose |
| Customer authentication | Supabase Auth, server-managed HttpOnly cookies |
| Admin authentication | Backend environment credentials, bcrypt password hash, signed JWT session |
| Validation and security | Zod, Helmet, CORS, express-rate-limit |
| Images | Cloudinary, Multer; server-side REST integration |
| Testing and CI | Node.js test runner, mongodb-memory-server, GitHub Actions |

## Local setup

Requires Node.js 22, npm and configured MongoDB Atlas, Supabase and Cloudinary accounts.

```powershell
cd C:\tour-booking
npm ci
Copy-Item server/.env.example server/.env
```

Copy the environment example only for a fresh installation. Keep an existing environment file intact.

Fill in the values described in [server/.env.example](server/.env.example):

- MongoDB connection string and a random JWT secret of at least 32 characters.
- Supabase project URL and publishable key.
- Admin email and bcrypt password hash.
- Cloudinary cloud name, API key and API secret.
- `CLIENT_URL=http://127.0.0.1:5173` for local development.

Generate an admin password hash with the interactive helper:

```powershell
cd server
node hash-admin-password.js
cd ..
```

Store the resulting hash as `ADMIN_PASSWORD_HASH`. Never commit environment files or put backend secrets in frontend code.

Start frontend and backend together:

```powershell
npm run dev
```

Or run these in separate terminals from the project root:

```powershell
npm run dev --workspace=server
```

```powershell
npm run dev --workspace=client
```

| Application | Local address |
| --- | --- |
| Customer website | http://127.0.0.1:5173 |
| Admin login | http://127.0.0.1:5173/admin/login |
| API health | http://127.0.0.1:4000/api/health |

For a fresh database, `npm run seed` adds sample catalogue content. It does not create authentication accounts. Existing installations do not need to seed again.

## Authentication configuration

Customers register with their own email and verify it before login. There are no shared customer test credentials. Administrators use the configured email and the password corresponding to the backend hash.

In Supabase, enable email/password authentication and email confirmation. Set the site URL to the frontend origin and allow its `/auth/confirm` and `/reset-password` URLs.

Use these links in the respective Supabase email templates:

**Confirm signup**

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=signup">Verify email</a>
```

**Reset password**

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a>
```

Configure custom SMTP for customer email delivery. Verified existing customer emails link to their MongoDB profiles, preserving booking and wishlist references. Legacy MongoDB passwords no longer authenticate customers.

## Pricing and data

The server calculates seasonal adult/child rates, sharing adjustments and add-ons, then applies the configured GST. Room sharing adjustments apply per traveller; add-ons can apply per booking or traveller.

Bookings store the agreed price breakdown. Later rate changes affect new quotes, while existing booking totals stay unchanged. MongoDB transactions reserve seats and create bookings together; cancellation returns seats once. Packages with booking history are archived rather than removing historical data.

Image files live in Cloudinary; MongoDB stores delivery URLs and asset references. Shared replacements update database references across the website. Manage images through the admin panel so those references remain consistent.

## Project structure

```text
client/                 React customer website and admin panel
server/src/             Express API, authentication, models and pricing
server/test/            API and pricing tests
server/.env.example     Backend configuration template
.github/workflows/      Continuous integration
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend and API locally |
| `npm run build` | Build the React frontend |
| `npm start` | Start the Express server |
| `npm test` | Run backend tests |
| `npm run seed` | Add sample catalogue records |

Booking integration tests use an isolated temporary MongoDB replica set and mocked Supabase responses, with no production credentials. The first run downloads a MongoDB binary. The recent test updates have not yet been executed; historical browser QA scripts still need authentication updates.

## Deployment

The intended split deployment is Vercel for the React frontend and Render for the Express API. Keep MongoDB Atlas, Supabase Auth and Cloudinary as external services.

Production requires HTTPS, `NODE_ENV=production`, an exact frontend `CLIENT_URL`, backend secrets configured on Render, Atlas network access and matching Supabase redirect URLs. The frontend must forward `/api` requests to Render through Vercel rewrites, with an SPA fallback for page refreshes.

Deployment preparation is not complete: Vercel rewrite configuration and backend proxy-trust configuration still need to be added. A production build and manual authentication, booking and image checks remain necessary.

Payments currently use Pay Later. Online payment processing, coupons and PDF vouchers are not included.
