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
```



