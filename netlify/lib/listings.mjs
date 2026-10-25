import { getStore } from "@netlify/blobs";
import { chicagoNow } from "./time.mjs";
import { listHomes, asListing, linkSuggestions, photoUrl } from "./homes.mjs";
import { readAll } from "./readall.mjs";

// ---- Repliers (read-only) -----------------------------------------------
const BASE = "https://api.repliers.io";
// MLS board agent IDs (NTREIS): Troy George 492946, Lucy Noonan 560617. Repliers stores them zero-padded
// to 7 digits ("0492946") and its `agent` filter accepts that form.
export const BOARD_AGENT_IDS = ["492946", "560617"].map((id) => id.padStart(7, "0"));

async function repliers(params) {
  const key = process.env.REPLIERS_API_KEY;
  if (!key) throw new Error("REPLIERS_API_KEY is not set");
  const res = await fetch(`${BASE}/listings?${params}`, { headers: { "REPLIERS-API-KEY": key, accept: "application/json" } });
  if (!res.ok) throw new Error(`Repliers ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Repliers' `class` is unreliable (single-family homes appear under CondoProperty), so filter on propertyType instead.
const NOT_RESIDENTIAL = /land|lot|farm|ranch|acre|commercial/i;
let cache = { at: 0, data: null };
let freshness = { at: 0, stamp: null };

// Active residential sale listings for the two agents (land and commercial excluded).
async function fetchRaw() {
  if (cache.data && Date.now() - cache.at < 5 * 60 * 1000) return cache.data;
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({ status: "A", type: "sale", resultsPerPage: "100", pageNum: String(page) });
    for (const id of BOARD_AGENT_IDS) q.append("agent", id);
    const d = await repliers(q);
    all.push(...(d.listings || []));
    if (page >= (d.numPages || 1)) break;
  }
  const byMls = new Map(all.map((l) => [String(l.mlsNumber), l]));
  const data = [...byMls.values()].filter((l) => !NOT_RESIDENTIAL.test(String(l.details?.propertyType || "")));
  cache = { at: Date.now(), data };
  return data;
}

// When the Repliers data was last updated, so a stale feed is obvious: an ISO time ("2026-10-23T22:22:52.000Z"),
// or just the date if Repliers sends no time.
export async function feedUpdatedAt() {
  if (freshness.stamp && Date.now() - freshness.at < 5 * 60 * 1000) return freshness.stamp;
  const d = await repliers(new URLSearchParams({ status: "A", resultsPerPage: "1", sortBy: "updatedOnDesc" }));
  const raw = String(d.listings?.[0]?.updatedOn || ""), t = new Date(raw);
  freshness = { at: Date.now(), stamp: raw.length > 10 && !Number.isNaN(+t) ? t.toISOString() : raw.slice(0, 10) || null };
  return freshness.stamp;
}

// Amounts like "$1,295,000" or "6,331": digits only. Never use it for coordinates; it drops the minus sign.
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };
// Map coordinates keep their sign: Texas longitudes are negative (-97.18), and without the minus a
// home lands in western China.
const coord = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
// Bathrooms as the MLS writes them, full.half. Repliers sends the total and how many of those are half
// baths: 9 with 3 half is 6 full and 3 half, so 6.3. Without a usable half count, the total stands.
const baths = (d = {}) => {
  const total = num(d.numBathrooms), half = num(d.numBathroomsHalf);
  return half > 0 && half < 10 && half <= total ? ((total - half) * 10 + half) / 10 : total;
};

export function normalize(l) {
  const a = l.address || {};
  const street = [a.streetNumber, a.streetDirectionPrefix, a.streetName, a.streetSuffix, a.streetDirection].filter(Boolean).join(" ");
  return {
    mls: String(l.mlsNumber),
    addr: [street, a.unitNumber && `#${a.unitNumber}`].filter(Boolean).join(" "),
    city: a.city || "", zip: String(a.zip || "").slice(0, 5),
    lat: coord(l.map?.latitude), lng: coord(l.map?.longitude),
    price: num(l.listPrice), dom: Math.round(num(l.daysOnMarket ?? l.simpleDaysOnMarket)),
    bd: num(l.details?.numBedrooms), ba: baths(l.details), sf: Math.round(num(l.details?.sqft)),
    img: (l.images && l.images[0]) || "",
    gallery: (l.images || []).slice(0, GALLERY),
  };
}

// Photos agents can click through on a home's details: the cover and the next four.
export const GALLERY = 5;

// Open houses already on the MLS for one listing, as whole-hour blocks in Central time: [{ iso, from, to }].
// Entries look like { date, startTime: "2026-05-23T18:00:00.000-00:00" (UTC), endTime, type, status }.
// Deleted and cancelled entries are ignored.
export function openHouseEntries(raw) {
  const out = [];
  for (const o of Array.isArray(raw.openHouse) ? raw.openHouse : []) {
    if (/deleted|cancel/i.test(String(o.status || ""))) continue;
    const start = new Date(o.startTime), end = new Date(o.endTime);
    if (Number.isNaN(+start) || Number.isNaN(+end) || end <= start) continue;
    const { date, hour } = chicagoNow(start);
    out.push({ iso: date, from: hour, to: hour + Math.ceil((end - start) / 3600000) });
  }
  return out;
}

// The same, limited to the weekend being offered and keyed by day ("sat"/"sun"). Repliers is read-only for us.
export function openHouseBlocks(raw, week) {
  return openHouseEntries(raw).flatMap(({ iso, from, to }) => {
    const day = Object.keys(week.days).find((k) => week.days[k].iso === iso);
    return day ? [{ day, from, to }] : [];
  });
}

// Open houses on the MLS for one listing, any date. Throws if Repliers can't be reached.
export async function mlsOpenHouses(mls) {
  const raw = (await fetchRaw()).find((l) => String(l.mlsNumber) === String(mls));
  return raw ? openHouseEntries(raw) : [];
}

// ---- Team-managed details (not in MLS data) ------------------------------
const infoStore = () => getStore({ name: "open-house-listing-info", consistency: "strong" }); // publishing shows on the portal at once
// vacant: no one lives in the home (no occupants). Shown to agents as a "Vacant" tag.
const blank = { offeredWeek: null, priorityWeek: null, days: ["sat", "sun"], instr: [], access: "", vacant: false };

export const getInfo = async (mls) => ({ ...blank, ...((await infoStore().get(`mls/${mls}`, { type: "json" }).catch(() => null)) || {}) });
export const saveInfo = (mls, info) => infoStore().setJSON(`mls/${mls}`, info);

// Every listing's stored team settings ("mls/<MLS# or home id>"), read in one go so it can run alongside the catalog.
const storedInfo = async () => new Map((await readAll(infoStore(), "open-house-listing-info", "mls/")).map(([k, v]) => [k.slice(4), v]));
const infoFor = (mlsList, stored) => Object.fromEntries(mlsList.map((m) => [m, { ...blank, ...(stored.get(m) || {}) }]));

// Homes that always appear, even if Repliers doesn't return them. Live Repliers data wins when present.
const MANUAL = [
  { mls: "21297798", addr: "2006 Nighthawk Court", city: "Westlake", zip: "76262", lat: 32.978088, lng: -97.18720096, price: 5950000, dom: 50, bd: 4, ba: 4.2, sf: 6331, img: "ntreismls/IMG-21297798_0.jpg" },
  { mls: "21372196", addr: "6900 Rockingham Court", city: "Colleyville", zip: "76034", lat: 32.908375, lng: -97.157547, price: 4350000, dom: 13, bd: 6, ba: 6.3, sf: 10026, img: "ntreismls/IMG-21372196_4446441738281566696.jpg" },
  { mls: "21332907", addr: "69 Cortes Drive", city: "Westlake", zip: "76262", lat: 32.983337, lng: -97.18004802, price: 1297000, dom: 32, bd: 3, ba: 3.1, sf: 2038, img: "ntreismls/IMG-21332907_4446676996495488826.jpg" },
  { mls: "21346883", addr: "441 Watermere Drive", city: "Southlake", zip: "76092", lat: 32.929991, lng: -97.193693, price: 629000, dom: 28, bd: 2, ba: 2.1, sf: 2109, img: "ntreismls/IMG-21346883_4444455829925220134.jpg" },
];

async function catalog(week) {
  let warning = null;
  // Repliers and the team-added homes (those not linked to an MLS listing yet; see homes.mjs) load together.
  const [raw, homes] = await Promise.all([
    fetchRaw().catch((e) => { console.error(e.message); warning = e.message.slice(0, 300); return []; }),
    listHomes().then((all) => all.filter((h) => !h.linkedMls)).catch((e) => { console.error("team-added homes unavailable", e.message); return []; }),
  ]);
  const list = raw.map((l) => ({ n: normalize(l), openHouses: openHouseBlocks(l, week) }));
  for (const m of MANUAL) if (!list.some((x) => x.n.mls === m.mls)) list.push({ n: m, openHouses: [] });
  for (const h of homes) list.push({ n: asListing(h), openHouses: [], home: h });
  return { list, warning };
}

// MLS listings only (Repliers plus the built-in ones), for linking a team-added home.
export const mlsListings = async (week) => (await catalog(week)).list.filter((x) => !x.n.teamAdded).map((x) => x.n);

// How a listing's stored team settings read for a given weekend. Publishing and Priority are per
// weekend; days, instructions, access details and Vacant stay with the home from week to week.
export const teamView = (i, week) => ({ offered: i.offeredWeek === week.satIso, priority: i.priorityWeek === week.satIso, days: i.days, instr: i.instr, access: i.access, vacant: !!i.vacant });

// Listings the team has offered for the current weekend. Never includes access details.
export async function offeredListings(week) {
  const [{ list }, stored] = await Promise.all([catalog(week), storedInfo()]);
  const info = infoFor(list.map((x) => x.n.mls), stored);
  return list.filter((x) => info[x.n.mls].offeredWeek === week.satIso)
    .map((x) => ({ ...x.n, priority: info[x.n.mls].priorityWeek === week.satIso, days: info[x.n.mls].days, instr: info[x.n.mls].instr, vacant: !!info[x.n.mls].vacant, external: x.openHouses }))
    .sort((a, b) => Number(b.priority) - Number(a.priority) || b.price - a.price); // Priority first, then highest price first
}

export async function teamListings(week) {
  const [{ list, warning }, stored, updatedAt] = await Promise.all([catalog(week), storedInfo(), feedUpdatedAt().catch(() => null)]);
  const info = infoFor(list.map((x) => x.n.mls), stored);
  const mls = list.filter((x) => !x.n.teamAdded).map((x) => x.n);
  return {
    warning,
    // The date (Central) for the out-of-date warning, and the time for "Repliers data updated ...".
    feedUpdatedOn: updatedAt ? (updatedAt.length > 10 ? chicagoNow(new Date(updatedAt)).date : updatedAt) : null,
    feedUpdatedAt: updatedAt,
    listings: list.map((x) => ({
      ...x.n, ...teamView(info[x.n.mls], week), openHouses: x.openHouses,
      // Team-added homes: their photos, and MLS listings at the same address to link to.
      ...(x.home && { photos: x.home.photos.map((p) => ({ id: p, url: photoUrl(x.home.id, p) })), suggestions: linkSuggestions(x.home, mls).map((l) => l.mls) }),
    })).sort((a, b) => Number(b.priority) - Number(a.priority)),
    mlsChoices: mls.map((l) => ({ mls: l.mls, addr: l.addr, city: l.city })),
  };
}

// Diagnostic for the inventory page: what Repliers returns for the two agents and how fresh the data is.
export async function probe() {
  const out = { agentIds: BOARD_AGENT_IDS };
  const q = (extra) => { const p = new URLSearchParams({ resultsPerPage: "1", ...extra }); for (const id of BOARD_AGENT_IDS) p.append("agent", id); return p; };
  try {
    out.activeResidentialSale = (await fetchRaw()).length; // same filter the site uses
    out.activeAnyClass = (await repliers(q({ status: "A" }))).count;
    const inactive = await repliers((() => { const p = q({}); p.append("status", "A"); p.append("status", "U"); return p; })());
    out.activeAndInactive = inactive.count;
    out.feedUpdatedAt = await feedUpdatedAt();
  } catch (e) { out.error = e.message; }
  return out;
}

// Admin /listings test page: up to 10 active Southlake homes for sale from Repliers, no agent filter, plus single-listing detail.
// Repliers' `class` is unreliable (single-family homes appear under CondoProperty), so homes are picked by property type and style instead.
export const TEST_CITY = "Southlake";
const NOT_A_HOME = /land|lot|farm|ranch|acre|condo|town ?(home|house)|duplex|multi|commercial|lease/i;

export async function testListings() {
  const homes = [];
  for (let page = 1; page <= 5 && homes.length < 10; page++) {
    const d = await repliers(new URLSearchParams({ status: "A", type: "sale", city: TEST_CITY, resultsPerPage: "100", pageNum: String(page) }));
    for (const l of d.listings || []) {
      if (/^residential$/i.test(l.details?.propertyType || "") && !NOT_A_HOME.test(l.details?.style || "")) homes.push(l);
    }
    if (page >= (d.numPages || 1)) break;
  }
  return homes.slice(0, 10).map((l) => ({ ...normalize(l), type: l.details?.style || "", class: l.class || "" }));
}

export async function listingDetail(mls) {
  const key = process.env.REPLIERS_API_KEY;
  if (!key) throw new Error("REPLIERS_API_KEY is not set");
  const res = await fetch(`${BASE}/listings/${encodeURIComponent(mls)}`, { headers: { "REPLIERS-API-KEY": key, accept: "application/json" } });
  if (!res.ok) throw new Error(`Repliers ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export const rawSample = async () => {
  const [first] = await fetchRaw();
  if (!first) return null;
  const { details, ...rest } = first;
  const { description, ...d } = details || {};
  return { ...rest, details: d };
};

// Instructions every home gets after its own (on the agent portal and in the Confirmed and Reminder emails).
export const STANDARD_INSTR = ["Please text the George & Noonan Team once you enter the home and when you leave."];
export const agentInstructions = (instr = []) => [...instr, ...STANDARD_INSTR];

// gallery: up to GALLERY photos, the cover first (built-in listings have only their cover).
export const publicListing = (l) => ({ mls: l.mls, addr: l.addr, city: l.city, zip: l.zip, lat: l.lat, lng: l.lng, price: l.price, dom: l.dom, bd: l.bd, ba: l.ba, sf: l.sf, img: l.img,
  gallery: (l.gallery?.length ? l.gallery : [l.img]).filter(Boolean).slice(0, GALLERY), days: l.days, instr: agentInstructions(l.instr), priority: !!l.priority, vacant: !!l.vacant, teamAdded: !!l.teamAdded });

// Snapshot stored on each request so emails and reminders keep working if the listing changes.
export const snapshot = (l) => ({ mls: l.mls, addr: l.addr, city: l.city, zip: l.zip, lat: l.lat, lng: l.lng, price: l.price, img: l.img, ...(l.teamAdded && { teamAdded: true }) });
