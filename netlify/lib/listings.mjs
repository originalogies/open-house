import { getStore } from "@netlify/blobs";
import { chicagoNow } from "./time.mjs";

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

const LAND = /land|lot|farm|ranch|acre/i;
let cache = { at: 0, data: null };
let freshness = { at: 0, date: null };

// Active residential sale listings for the two agents (land excluded).
async function fetchRaw() {
  if (cache.data && Date.now() - cache.at < 5 * 60 * 1000) return cache.data;
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({ status: "A", type: "sale", class: "residential", resultsPerPage: "100", pageNum: String(page) });
    for (const id of BOARD_AGENT_IDS) q.append("agent", id);
    const d = await repliers(q);
    all.push(...(d.listings || []));
    if (page >= (d.numPages || 1)) break;
  }
  const byMls = new Map(all.map((l) => [String(l.mlsNumber), l]));
  const data = [...byMls.values()].filter((l) => !LAND.test(String(l.details?.propertyType || "")));
  cache = { at: Date.now(), data };
  return data;
}

// Date (YYYY-MM-DD) the Repliers data was last updated, so a stale feed is obvious.
export async function feedUpdatedOn() {
  if (freshness.date && Date.now() - freshness.at < 5 * 60 * 1000) return freshness.date;
  const d = await repliers(new URLSearchParams({ status: "A", resultsPerPage: "1", sortBy: "updatedOnDesc" }));
  freshness = { at: Date.now(), date: String(d.listings?.[0]?.updatedOn || "").slice(0, 10) || null };
  return freshness.date;
}

const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };

export function normalize(l) {
  const a = l.address || {};
  const street = [a.streetNumber, a.streetDirectionPrefix, a.streetName, a.streetSuffix, a.streetDirection].filter(Boolean).join(" ");
  return {
    mls: String(l.mlsNumber),
    addr: [street, a.unitNumber && `#${a.unitNumber}`].filter(Boolean).join(" "),
    city: a.city || "", zip: String(a.zip || "").slice(0, 5),
    lat: num(l.map?.latitude), lng: num(l.map?.longitude),
    price: num(l.listPrice), dom: Math.round(num(l.daysOnMarket ?? l.simpleDaysOnMarket)),
    bd: num(l.details?.numBedrooms), ba: num(l.details?.numBathrooms), sf: Math.round(num(l.details?.sqft)),
    img: (l.images && l.images[0]) || "",
  };
}

// Open houses already on the MLS, mapped to whole-hour blocks (Central time). Repliers is read-only for us.
// Entries look like { date, startTime: "2026-05-23T18:00:00.000-00:00" (UTC), endTime, type, status }.
export function openHouseBlocks(raw, week) {
  const out = [];
  for (const o of Array.isArray(raw.openHouse) ? raw.openHouse : []) {
    if (/deleted|cancel/i.test(String(o.status || ""))) continue;
    const start = new Date(o.startTime), end = new Date(o.endTime);
    if (Number.isNaN(+start) || Number.isNaN(+end) || end <= start) continue;
    const { date, hour } = chicagoNow(start);
    const day = Object.keys(week.days).find((k) => week.days[k].iso === date);
    if (!day) continue;
    out.push({ day, from: hour, to: hour + Math.ceil((end - start) / 3600000) });
  }
  return out;
}

// ---- Team-managed details (not in MLS data) ------------------------------
const infoStore = () => getStore("open-house-listing-info");
const blank = { offeredWeek: null, priorityWeek: null, days: ["sat", "sun"], instr: [], access: "" };

export const getInfo = async (mls) => ({ ...blank, ...((await infoStore().get(`mls/${mls}`, { type: "json" }).catch(() => null)) || {}) });
export const saveInfo = (mls, info) => infoStore().setJSON(`mls/${mls}`, info);

export async function allInfo(mlsList) {
  const entries = await Promise.all(mlsList.map(async (m) => [m, await getInfo(m)]));
  return Object.fromEntries(entries);
}

// Homes that always appear, even if Repliers doesn't return them. Live Repliers data wins when present.
const MANUAL = [
  { mls: "21297798", addr: "2006 Nighthawk Court", city: "Westlake", zip: "76262", lat: 32.978088, lng: -97.18720096, price: 5950000, dom: 50, bd: 4, ba: 6, sf: 6331, img: "ntreismls/IMG-21297798_0.jpg" },
  { mls: "21372196", addr: "6900 Rockingham Court", city: "Colleyville", zip: "76034", lat: 32.908375, lng: -97.157547, price: 4350000, dom: 13, bd: 6, ba: 9, sf: 10026, img: "ntreismls/IMG-21372196_4446441738281566696.jpg" },
  { mls: "21332907", addr: "69 Cortes Drive", city: "Westlake", zip: "76262", lat: 32.983337, lng: -97.18004802, price: 1297000, dom: 32, bd: 3, ba: 4, sf: 2038, img: "ntreismls/IMG-21332907_4446676996495488826.jpg" },
  { mls: "21346883", addr: "441 Watermere Drive", city: "Southlake", zip: "76092", lat: 32.929991, lng: -97.193693, price: 629000, dom: 28, bd: 2, ba: 3, sf: 2109, img: "ntreismls/IMG-21346883_4444455829925220134.jpg" },
];

async function catalog(week) {
  let raw = [], warning = null;
  try { raw = await fetchRaw(); } catch (e) { console.error(e.message); warning = e.message.slice(0, 300); }
  const list = raw.map((l) => ({ n: normalize(l), openHouses: openHouseBlocks(l, week) }));
  for (const m of MANUAL) if (!list.some((x) => x.n.mls === m.mls)) list.push({ n: m, openHouses: [] });
  return { list, warning };
}

// Listings the team has offered for the current weekend. Never includes access details.
export async function offeredListings(week) {
  const { list } = await catalog(week);
  const info = await allInfo(list.map((x) => x.n.mls));
  return list.filter((x) => info[x.n.mls].offeredWeek === week.satIso)
    .map((x) => ({ ...x.n, priority: info[x.n.mls].priorityWeek === week.satIso, days: info[x.n.mls].days, instr: info[x.n.mls].instr, external: x.openHouses }))
    .sort((a, b) => Number(b.priority) - Number(a.priority)); // priority first, otherwise keep order
}

export async function teamListings(week) {
  const { list, warning } = await catalog(week);
  const info = await allInfo(list.map((x) => x.n.mls));
  return {
    warning,
    feedUpdatedOn: await feedUpdatedOn().catch(() => null),
    listings: list.map((x) => { const i = info[x.n.mls]; return { ...x.n, offered: i.offeredWeek === week.satIso, priority: i.priorityWeek === week.satIso, days: i.days, instr: i.instr, access: i.access, openHouses: x.openHouses }; })
      .sort((a, b) => Number(b.priority) - Number(a.priority)),
  };
}

// Diagnostic for the inventory page: what Repliers returns for the two agents and how fresh the data is.
export async function probe() {
  const out = { agentIds: BOARD_AGENT_IDS };
  const q = (extra) => { const p = new URLSearchParams({ resultsPerPage: "1", ...extra }); for (const id of BOARD_AGENT_IDS) p.append("agent", id); return p; };
  try {
    out.activeResidentialSale = (await repliers(q({ status: "A", type: "sale", class: "residential" }))).count;
    out.activeAnyClass = (await repliers(q({ status: "A" }))).count;
    const inactive = await repliers((() => { const p = q({}); p.append("status", "A"); p.append("status", "U"); return p; })());
    out.activeAndInactive = inactive.count;
    out.feedUpdatedOn = await feedUpdatedOn();
  } catch (e) { out.error = e.message; }
  return out;
}

// Admin /listings test page: every active or inactive listing for Troy George (any class, land included), plus single-listing detail.
export const TROY_AGENT_ID = BOARD_AGENT_IDS[0];

export async function troyListings() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({ agent: TROY_AGENT_ID, resultsPerPage: "100", pageNum: String(page) });
    q.append("status", "A"); q.append("status", "U");
    const d = await repliers(q);
    all.push(...(d.listings || []));
    if (page >= (d.numPages || 1)) break;
  }
  return all.map((l) => ({ ...normalize(l), type: l.details?.propertyType || "", class: l.class || "", status: l.status || "", lastStatus: l.lastStatus || "" }));
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

export const publicListing = (l) => ({ mls: l.mls, addr: l.addr, city: l.city, zip: l.zip, lat: l.lat, lng: l.lng, price: l.price, dom: l.dom, bd: l.bd, ba: l.ba, sf: l.sf, img: l.img, days: l.days, instr: l.instr, priority: !!l.priority });

// Snapshot stored on each request so emails and reminders keep working if the listing changes.
export const snapshot = (l) => ({ mls: l.mls, addr: l.addr, city: l.city, zip: l.zip, lat: l.lat, lng: l.lng, price: l.price, img: l.img });
