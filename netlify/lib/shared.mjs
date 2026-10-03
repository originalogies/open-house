import crypto from "node:crypto";

const COOKIE = "oh_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export const parseList = (v) =>
  [...new Set(String(v || "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];

export const adminEmails = () => parseList(process.env.ADMIN_EMAILS);

// ---- access rules -------------------------------------------------------
// Admins (ADMIN_EMAILS) can always sign in. Everyone else must match an
// allowed email address or an allowed email domain. Nothing configured = nobody.
export function isAllowed(email, access) {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  if (adminEmails().includes(e)) return true;
  const domain = e.slice(at + 1);
  return access.emails.includes(e) || access.domains.includes(domain);
}

export const normalizeEmail = (s) => {
  const v = String(s || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
};
export const normalizeDomain = (s) => {
  const v = String(s || "").trim().toLowerCase().replace(/^@/, "");
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(v) ? v : null;
};

async function store() {
  const { getStore } = await import("@netlify/blobs");
  return getStore("open-house");
}

// Stored list (managed by admins in the portal) plus the optional env seed lists.
export async function getAccess() {
  const stored = (await (await store()).get("access", { type: "json" }).catch(() => null)) || {};
  const envEmails = parseList(process.env.ALLOWED_EMAILS);
  const envDomains = parseList(process.env.ALLOWED_DOMAINS);
  return {
    emails: [...new Set([...(stored.emails || []), ...envEmails])],
    domains: [...new Set([...(stored.domains || []), ...envDomains])],
    stored: { emails: stored.emails || [], domains: stored.domains || [] },
    env: { emails: envEmails, domains: envDomains },
  };
}

export async function saveAccess({ emails, domains }) {
  await (await store()).setJSON("access", { emails, domains });
}

// ---- signed session cookie ----------------------------------------------
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to a random string of 32+ characters");
  return s;
}
const mac = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

export function makeSession(user) {
  const body = Buffer.from(
    JSON.stringify({ email: user.email, name: user.name, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })
  ).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function readSession(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig) return null;
  const good = mac(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString());
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

export const sessionCookie = (value) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Current signed-in user, re-checked against the live allowlist on every call so
// removing someone takes effect immediately.
export async function currentUser(req) {
  const s = readSession(req);
  if (!s) return null;
  const access = await getAccess();
  if (!isAllowed(s.email, access)) return null;
  const admin = adminEmails().includes(s.email);
  return { email: s.email, name: s.name, admin, team: admin || parseList(process.env.TEAM_EMAILS).includes(s.email) };
}

// Reject cross-site writes.
export function sameOrigin(req) {
  const o = req.headers.get("origin");
  return !o || o === new URL(req.url).origin;
}
