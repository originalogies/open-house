import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

// ---- Team-added homes -------------------------------------------------------
// Homes the George & Noonan team adds before they're on the MLS. Each one is used everywhere a
// listing is (inventory, agent portal, requests, emails), keyed by its id ("H" + 10 hex) in place
// of an MLS number. Once the home is linked to its MLS listing, the MLS listing takes its place:
// team settings and requests move over, and the home is kept only as a record.
const homeStore = () => getStore({ name: "open-house-homes", consistency: "strong" });
const photoStore = () => getStore("open-house-home-photos");

export const isHomeId = (id) => /^H[a-f0-9]{10}$/.test(String(id || ""));
export const isMlsNumber = (mls) => /^\d+$/.test(String(mls || ""));
export const newHomeId = () => "H" + crypto.randomBytes(5).toString("hex");
export const MAX_PHOTOS = 20;
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024; // the console shrinks photos to about 1600px before upload

// Admin input -> the fields we show. Returns { fields } or { error }. `partial` allows updating some fields.
export function cleanHome(b, { partial = false } = {}) {
  const out = {};
  const text = (k, max, label) => {
    if (b[k] === undefined && partial) return null;
    const v = String(b[k] ?? "").trim().replace(/\s+/g, " ");
    if (!v) return `${label} is required.`;
    if (v.length > max) return `${label} is too long.`;
    out[k] = v; return null;
  };
  const num = (k, max, label, step) => {
    if (b[k] === undefined && partial) return null;
    const n = Number(b[k]);
    if (b[k] === "" || b[k] === null || !Number.isFinite(n) || n < 0 || n > max || Math.round(n / step) * step !== n) return `Enter a valid ${label}.`;
    out[k] = n; return null;
  };
  const err = text("addr", 120, "Street address") || text("city", 60, "City")
    || (b.zip === undefined && partial ? null : (/^\d{5}$/.test(String(b.zip ?? "").trim()) ? ((out.zip = String(b.zip).trim()), null) : "Enter a 5-digit ZIP code."))
    || num("price", 1e9, "price", 1) || num("bd", 50, "bedroom count", 1) || num("ba", 50, "bathroom count", 0.5) || num("sf", 100000, "square footage", 1);
  return err ? { error: err } : { fields: out };
}

export const photoUrl = (id, p) => `/api/home-photo?id=${id}&p=${p}`;

// A team-added home in the same shape as a normalized MLS listing (see normalize() in listings.mjs).
export const asListing = (h) => ({
  mls: h.id, addr: h.addr, city: h.city, zip: h.zip, lat: 0, lng: 0,
  price: h.price, dom: 0, bd: h.bd, ba: h.ba, sf: h.sf,
  img: h.photos?.length ? photoUrl(h.id, h.photos[0]) : "", teamAdded: true,
});

export async function listHomes() {
  const s = homeStore();
  const { blobs } = await s.list({ prefix: "home/" });
  const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return all.filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
}
export const getHome = async (id) => (isHomeId(id) ? homeStore().get(`home/${id}`, { type: "json" }) : null);
export const saveHome = (h) => homeStore().setJSON(`home/${h.id}`, h);
export const removeHome = (id) => homeStore().delete(`home/${id}`);

// Photos: JPEG or PNG, stored per home under a random id, served publicly by /api/home-photo
// (emails and the agent portal both show them).
export function photoType(buf) {
  if (buf.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (buf.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  return null;
}
export async function savePhoto(id, buf, type) {
  const p = crypto.randomBytes(6).toString("hex");
  await photoStore().set(`photo/${id}/${p}`, buf, { metadata: { type } });
  return p;
}
export const getPhoto = (id, p) => (isHomeId(id) && /^[a-f0-9]{12}$/.test(String(p || "")) ? photoStore().getWithMetadata(`photo/${id}/${p}`, { type: "arrayBuffer" }) : null);
export const deletePhoto = (id, p) => photoStore().delete(`photo/${id}/${p}`);

// ---- linking to the MLS listing -----------------------------------------------
const SUFFIX = { drive: "dr", court: "ct", street: "st", avenue: "ave", lane: "ln", road: "rd", boulevard: "blvd", circle: "cir",
  place: "pl", trail: "trl", parkway: "pkwy", terrace: "ter", highway: "hwy", cove: "cv", point: "pt", square: "sq",
  north: "n", south: "s", east: "e", west: "w" };
// Same street address, ignoring case, punctuation and spellings like "Drive" vs "Dr". ZIP must match too.
export const addressKey = (addr, zip) => `${String(addr || "").toLowerCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean)
  .map((w) => SUFFIX[w] || w).join(" ")}|${String(zip || "").slice(0, 5)}`;
// MLS listings that look like this home, for the one-click link in the console.
export const linkSuggestions = (home, mlsListings) => mlsListings.filter((l) => addressKey(l.addr, l.zip) === addressKey(home.addr, home.zip));

// Team settings for the MLS listing after linking: the home's own, falling back to what the MLS
// listing already had. Instructions, access details and Vacant carry over with the home.
export function mergeInfo(homeInfo, mlsInfo) {
  return {
    offeredWeek: homeInfo.offeredWeek || mlsInfo.offeredWeek || null,
    priorityWeek: homeInfo.priorityWeek || mlsInfo.priorityWeek || null,
    days: homeInfo.offeredWeek ? homeInfo.days : mlsInfo.days,
    instr: homeInfo.instr?.length ? homeInfo.instr : mlsInfo.instr || [],
    access: homeInfo.access || mlsInfo.access || "",
    vacant: !!(homeInfo.vacant || mlsInfo.vacant),
  };
}
