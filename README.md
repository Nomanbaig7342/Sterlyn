# Sterlyn — Interior Design Studio Website

A complete, deployable website for an interior design studio: a designed frontend
(hero, services, process, portfolio, testimonials, about, contact) backed by a
real REST API that stores contact-form leads and newsletter sign-ups.

```
sterlyn/
├── server.js              # Backend: static file server + REST API (pure Node.js)
├── package.json
├── .env.example            # Copy to .env and edit
├── data/
│   ├── portfolio.json      # Project data served by GET /api/portfolio
│   ├── testimonials.json   # Served by GET /api/testimonials
│   ├── leads.json          # Contact form submissions land here
│   └── subscribers.json    # Newsletter sign-ups land here
└── public/                 # Frontend (served as static files)
    ├── index.html
    ├── admin.html           # Password-protected dashboard for leads/subscribers
    ├── 404.html
    ├── css/style.css
    └── js/main.js
```

## 1. How it works

**Frontend** — a single-page site (`public/index.html`) styled with a custom
design system (`public/css/style.css`) and no build step: it's plain HTML/CSS/JS,
so there's nothing to compile and nothing to break between environments.

**Backend** — `server.js` is a REST API written with **zero required npm
dependencies** (only Node's built-in `http`, `fs`, `crypto` modules). That means:

- You can run it immediately with `node server.js` — no `npm install` needed.
- Leads and newsletter emails are stored in JSON files under `data/` (a real
  database is a drop-in upgrade — see "Swapping in a database" below).
- It serves the frontend *and* the API from the same process, so there's
  only one thing to deploy.

### API endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/portfolio` | Returns the project list shown in the Portfolio section |
| `GET`  | `/api/testimonials` | Returns the client quotes shown in the testimonial carousel |
| `POST` | `/api/contact` | Saves a contact-form inquiry (validated server-side) |
| `POST` | `/api/newsletter` | Saves a newsletter email (de-duplicated) |
| `GET`  | `/api/admin/leads` | Returns all inquiries. Requires `X-Admin-Key` header or `?key=` query param |
| `GET`  | `/api/admin/subscribers` | Returns all newsletter emails. Same auth as above |

All endpoints return JSON in the shape `{ ok: boolean, data?, error?, message? }`.

The contact form is also **rate-limited** (8 submissions per 10 minutes per IP)
to cut down on spam, and every submission is validated on the server, not just
in the browser — so the API is safe to call directly.

## 2. Running it locally

```bash
cd sterlyn
cp .env.example .env      # then open .env and set your own ADMIN_KEY
node server.js
```

Visit:
- **Site:** http://localhost:3000
- **Admin dashboard:** http://localhost:3000/admin.html (enter the `ADMIN_KEY` from your `.env`)

That's it — no build step, no database to install first.

## 3. Editing the content

- **Portfolio projects** — edit `data/portfolio.json`. Each entry needs
  `title`, `category` (must match one of the filter buttons: Residential,
  Commercial, Hospitality, Retail), `location`, `year`, `blurb`, and `image`
  (a URL). Restart the server after editing.
- **Testimonials** — edit `data/testimonials.json` the same way.
- **Copy, contact details, pricing bands** — edit directly in `public/index.html`.
- **Colors / fonts** — all design tokens are CSS variables at the top of
  `public/css/style.css` under `:root`.

## 4. Deploying

Because the backend has no native dependencies, it deploys cleanly almost
anywhere that runs Node 18+:

**Render / Railway / Fly.io / a VPS**
1. Push this folder to a Git repo.
2. Set the start command to `node server.js` (or `npm start`).
3. Set environment variables `ADMIN_KEY` (required) and `PORT` (most platforms
   set this for you automatically).
4. Deploy. The same process serves both the site and the API, so there's
   nothing else to configure.

**A plain VPS (e.g. Ubuntu)**
```bash
git clone <your-repo> && cd sterlyn
cp .env.example .env   # set ADMIN_KEY
npm install --omit=optional     # optional — only needed if you want email notifications
node server.js
# In production, run it under a process manager, e.g.:
npx pm2 start server.js --name sterlyn
```
Put Nginx or Caddy in front for HTTPS, or use your platform's built-in TLS.

**Important before going live:** change `ADMIN_KEY` in `.env` to a long,
random value — the default in `.env.example` is not secret.

## 5. Optional: email notifications on new inquiries

By default, new leads are only saved to `data/leads.json` and visible in the
admin dashboard. To also get an email when someone submits the contact form:

```bash
npm install nodemailer
```
Then in `.env`, set:
```
EMAIL_ENABLED=true
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=studio@sterlyn.com
NOTIFY_TO=studio@sterlyn.com
```
If `EMAIL_ENABLED` is left `false` (the default), the server runs exactly as
before with no extra dependency required.

## 6. Swapping in a real database

The JSON-file storage in `data/` is fine for a studio getting started, but it's
not built for concurrent writes at scale. To move to Postgres, MySQL, or
MongoDB later, the only file to change is `server.js`: swap the
`readJSONFile` / `appendJSONFile` helper functions for equivalent database
calls — the route handlers and the frontend don't need to change at all,
since they only care about the JSON shape `{ ok, data }`.

## 7. Design notes

- **Palette:** ink (`#1C1B19`), bone (`#EDE8DF`), sage (`#6B7660`), sienna
  (`#A6572E`), brass (`#B08D57`) — a warm, material-led palette rather than a
  generic cream-and-terracotta template.
- **Type:** Fraunces (display/headlines), Inter (body), Archivo (labels/eyebrows).
- **Signature element:** the interactive swatch strip in the hero, echoing a
  designer's physical material board.
- Fully responsive down to mobile, with visible keyboard focus states and
  `prefers-reduced-motion` respected throughout.

## 8. Security notes for production

- Change `ADMIN_KEY` before deploying.
- The API sets permissive CORS (`Access-Control-Allow-Origin: *`) so the
  frontend can be split onto a different domain/CDN if you want. Narrow this
  in `server.js` (`send()` helper) once you know your production domain.
- All user input is sanitized and length-limited server-side before being
  written to disk.
- Consider adding HTTPS (via your host or a reverse proxy) — plain HTTP should
  only be used for local development.
