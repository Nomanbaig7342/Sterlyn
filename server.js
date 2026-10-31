/**
 * Sterlyn Interior Design — backend server
 * -----------------------------------------
 * Pure Node.js (no npm dependencies required to run).
 * Serves the static frontend from /public and a small JSON REST API.
 *
 * Run:   node server.js
 * Env:   PORT=3000  ADMIN_KEY=change-me   (see .env.example)
 */

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

// ---------- config ----------
loadDotEnv();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "sterlyn-admin";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const SUBSCRIBERS_FILE = path.join(DATA_DIR, "subscribers.json");
const PORTFOLIO_FILE = path.join(DATA_DIR, "portfolio.json");
const TESTIMONIALS_FILE = path.join(DATA_DIR, "testimonials.json");

// naive in-memory rate limiter: max 8 submissions / 10 minutes / IP
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 8;
const rateLimitLog = new Map();

// ---------- tiny .env loader (avoids a dotenv dependency) ----------
function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    val = val.replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ---------- helpers ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
    ...headers,
  });
  res.end(body);
}

function sendJSON(res, status, data) {
  send(res, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function readBody(req, limitBytes = 1e6) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readJSONFile(file) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    return [];
  }
}

async function appendJSONFile(file, record) {
  const list = await readJSONFile(file);
  list.push(record);
  await fsp.writeFile(file, JSON.stringify(list, null, 2), "utf8");
  return list;
}

function isRateLimited(ip) {
  const now = Date.now();
  const hits = (rateLimitLog.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  hits.push(now);
  rateLimitLog.set(ip, hits);
  return hits.length > RATE_LIMIT_MAX;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function sanitize(str, max = 2000) {
  return String(str || "")
    .trim()
    .slice(0, max);
}

// ---------- API handlers ----------
async function handleContact(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return sendJSON(res, 429, {
      ok: false,
      error: "Too many submissions. Please try again later.",
    });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: "Invalid request body." });
  }

  const name = sanitize(payload.name, 120);
  const email = sanitize(payload.email, 200);
  const phone = sanitize(payload.phone, 40);
  const projectType = sanitize(payload.projectType, 60);
  const budget = sanitize(payload.budget, 60);
  const message = sanitize(payload.message, 3000);

  const errors = {};
  if (!name) errors.name = "Name is required.";
  if (!isValidEmail(email)) errors.email = "A valid email is required.";
  if (!message || message.length < 10)
    errors.message = "Tell us a little more about the project (10+ characters).";

  if (Object.keys(errors).length) {
    return sendJSON(res, 422, { ok: false, error: "Validation failed.", fields: errors });
  }

  const record = {
    id: crypto.randomUUID(),
    name,
    email,
    phone,
    projectType,
    budget,
    message,
    createdAt: new Date().toISOString(),
    ip,
  };

  await appendJSONFile(LEADS_FILE, record);

  // Optional email notification — only runs if EMAIL_ENABLED=true and
  // nodemailer is installed. Silently skipped otherwise so the server
  // works out of the box with zero npm installs.
  notifyByEmail(record).catch(() => {});

  sendJSON(res, 201, {
    ok: true,
    message: "Thanks — we usually reply within one business day.",
  });
}

async function handleNewsletter(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return sendJSON(res, 429, { ok: false, error: "Too many requests. Try again later." });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: "Invalid request body." });
  }

  const email = sanitize(payload.email, 200);
  if (!isValidEmail(email)) {
    return sendJSON(res, 422, { ok: false, error: "A valid email is required." });
  }

  const list = await readJSONFile(SUBSCRIBERS_FILE);
  if (list.some((s) => s.email.toLowerCase() === email.toLowerCase())) {
    return sendJSON(res, 200, { ok: true, message: "You're already subscribed." });
  }

  await appendJSONFile(SUBSCRIBERS_FILE, {
    id: crypto.randomUUID(),
    email,
    createdAt: new Date().toISOString(),
  });

  sendJSON(res, 201, { ok: true, message: "Subscribed. Welcome to the studio notes." });
}

async function handlePortfolio(req, res) {
  const list = await readJSONFile(PORTFOLIO_FILE);
  sendJSON(res, 200, { ok: true, data: list });
}

async function handleTestimonials(req, res) {
  const list = await readJSONFile(TESTIMONIALS_FILE);
  sendJSON(res, 200, { ok: true, data: list });
}

function checkAdmin(req) {
  const headerKey = req.headers["x-admin-key"];
  const url = new URL(req.url, "http://localhost");
  const queryKey = url.searchParams.get("key");
  return (headerKey || queryKey) === ADMIN_KEY;
}

async function handleAdminLeads(req, res) {
  if (!checkAdmin(req)) return sendJSON(res, 401, { ok: false, error: "Unauthorized." });
  const leads = await readJSONFile(LEADS_FILE);
  sendJSON(res, 200, { ok: true, data: leads.slice().reverse() });
}

async function handleDeleteAdminLeads(req, res) {
  if (!checkAdmin(req)) return sendJSON(res, 401, { ok: false, error: "Unauthorized." });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: "Invalid request body." });
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray(payload.ids) ||
    payload.ids.length === 0 ||
    payload.ids.length > 500 ||
    payload.ids.some((id) => typeof id !== "string" || !uuidPattern.test(id))
  ) {
    return sendJSON(res, 400, { ok: false, error: "Select between 1 and 500 valid inquiries." });
  }

  const leads = JSON.parse(await fsp.readFile(LEADS_FILE, "utf8"));
  if (!Array.isArray(leads)) {
    throw new Error("Inquiry data must be a JSON array.");
  }
  const idsToDelete = new Set(payload.ids);
  const remaining = leads.filter((lead) => !idsToDelete.has(lead.id));
  const deleted = leads.length - remaining.length;
  await fsp.writeFile(LEADS_FILE, JSON.stringify(remaining, null, 2), "utf8");

  sendJSON(res, 200, { ok: true, deleted });
}

async function handleAdminSubscribers(req, res) {
  if (!checkAdmin(req)) return sendJSON(res, 401, { ok: false, error: "Unauthorized." });
  const subs = await readJSONFile(SUBSCRIBERS_FILE);
  sendJSON(res, 200, { ok: true, data: subs.slice().reverse() });
}

// Optional — only fires if you `npm install nodemailer` and set EMAIL_ENABLED=true
async function notifyByEmail(record) {
  if (process.env.EMAIL_ENABLED !== "true") return;
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (e) {
    console.warn("EMAIL_ENABLED is true but nodemailer is not installed. Run: npm install nodemailer");
    return;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFY_TO || process.env.SMTP_USER,
    subject: `New Sterlyn inquiry — ${record.name}`,
    text: `Name: ${record.name}\nEmail: ${record.email}\nPhone: ${record.phone}\nProject: ${record.projectType}\nBudget: ${record.budget}\n\n${record.message}`,
  });
}

// ---------- static file serving ----------
async function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(pathname));

  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, "Forbidden");
  }

  if (pathname === "/") filePath = path.join(PUBLIC_DIR, "index.html");

  try {
    let stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stat = await fsp.stat(filePath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const content = await fsp.readFile(filePath);
    send(res, 200, content, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
  } catch (e) {
    try {
      const fallback = await fsp.readFile(path.join(PUBLIC_DIR, "404.html"));
      send(res, 404, fallback, { "Content-Type": "text/html; charset=utf-8" });
    } catch (e2) {
      send(res, 404, "Not found");
    }
  }
}

// ---------- router ----------
const routes = {
  "POST /api/contact": handleContact,
  "POST /api/newsletter": handleNewsletter,
  "GET /api/portfolio": handlePortfolio,
  "GET /api/testimonials": handleTestimonials,
  "GET /api/admin/leads": handleAdminLeads,
  "DELETE /api/admin/leads": handleDeleteAdminLeads,
  "GET /api/admin/subscribers": handleAdminSubscribers,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  const routeKey = `${req.method} ${pathname}`;
  if (routes[routeKey]) {
    try {
      await routes[routeKey](req, res);
    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { ok: false, error: "Something went wrong on our end." });
    }
    return;
  }

  if (pathname.startsWith("/api/")) {
    return sendJSON(res, 404, { ok: false, error: "Unknown endpoint." });
  }

  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Sterlyn running at http://localhost:${PORT}`);
  console.log(`Admin dashboard:  http://localhost:${PORT}/admin.html`);
});
