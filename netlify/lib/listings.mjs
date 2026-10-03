import { getStore } from "@netlify/blobs";
import { getWeek } from "./week.mjs";

// ---- Repliers (read-only) -----------------------------------------------
const BASE = "https://api.repliers.io";
// MLS board agent IDs (NTREIS) and a name to search by. Repliers filters listings by its own
// internal agentId, so we look that up from /members using the board ID.
export const AGENTS = [
  { boardAgentId: "492946", name: "Troy George", last: "George" },
  { boardAgentId: "560617", name: "Lucy Noonan", last: "Noonan" },
];
let resolved = null;

async function repliersGet(path, params) {
  const key = process.env.REPLIERS_API_KEY;
  if (!key) throw new Error("REPLIERS_API_KEY is not set");
  const res = await fetch(`${BASE}${path}?${params}`, { headers: { "REPLIERS-API-KEY": key, accept: "application/json" } });
  if (!res.ok) throw new Error(`Repliers ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
const membersOf = (d) => d.members || d.agents || d.results || [];

async function resolveAgentIds() {
  if (resolved) return resolved;
  const ids = [];
  for (const a of AGENTS) {
    const tries = [{ agentName: a.name }, { keywords: a.name }, { keywords: a.last }];
    let hit = null;
    for (const t of tries) {
      const d = await repliersGet("/members", new URLSearchParams({ ...t, resultsPerPage: "200" })).catch(() => ({}));
      hit = membersOf(d).find((m) => String(m.boardAgentId) === a.boardAgentId);
      if (hit) break;
    }
    if (!hit) throw new Error(`Could not find ${a.name} (board agent ${a.boardAgentId}) in Repliers members`);
    ids.push(String(hit.agentId));
  }
  return (resolved = ids);
}
const LAND = /land|lot|farm|ranch|acre/i;

let cache = { at: 0, data: null };

async function repliers(params) {
  const key = process.env.REPLIERS_API_KEY;
  if (!key) throw new Error("REPLIERS_API_KEY is not set");
  const res = await fetch(`${BASE}/listings?${params}`, { headers: { "REPLIERS-API-KEY": key, accept: "application/json" } });
  if (!res.ok) throw new Error(`Repliers ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Active residential sale listings for the two agents. One request per agent, merged by MLS#.
async function fetchRaw() {
  if (cache.data && Date.now() - cache.at < 5 * 60 * 1000) return cache.data;
  const agentIds = await resolveAgentIds();
  const pages = await Promise.all(agentIds.map((id) =>
    repliers(new URLSearchParams({ agent: id, status: "A", type: "sale", class: "residential", resultsPerPage: "100" }))));
  const byMls = new Map();
  for (const p of pages) for (const l of p.listings || []) byMls.set(String(l.mlsNumber), l);
  const data = [...byMls.values()].filter((l) => !LAND.test(String(l.details?.propertyType || "")));
  cache = { at: Date.now(), data };
  return data;
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

// Open houses already on the MLS, mapped to whole-hour blocks. Repliers is read-only for us.
// Entries look like { startTime: "2026-10-10 10:00:00", endTime: "2026-10-10 12:00:00" }.
export function openHouseBlocks(raw, week) {
  const out = [];
  for (const o of Array.isArray(raw.openHouse) ? raw.openHouse : []) {
    const s = String(o.startTime || o.start || ""), e = String(o.endTime || o.end || "");
    const iso = s.slice(0, 10);
    const day = Object.keys(week.days).find((k) => week.days[k].iso === iso);
    if (!day) continue;
    const from = parseInt(s.slice(11, 13), 10);
    const to = parseInt(e.slice(11, 13), 10) + (parseInt(e.slice(14, 16), 10) > 0 ? 1 : 0);
    if (Number.isInteger(from) && Number.isInteger(to) && to > from) out.push({ day, from, to });
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
export async function offeredListings(week = getWeek()) {
  const { list } = await catalog(week);
  const info = await allInfo(list.map((x) => x.n.mls));
  return list.filter((x) => info[x.n.mls].offeredWeek === week.satIso)
    .map((x) => ({ ...x.n, priority: info[x.n.mls].priorityWeek === week.satIso, days: info[x.n.mls].days, instr: info[x.n.mls].instr, external: x.openHouses }))
    .sort((a, b) => Number(b.priority) - Number(a.priority)); // priority first, otherwise keep order
}

export async function teamListings(week = getWeek()) {
  const { list, warning } = await catalog(week);
  const info = await allInfo(list.map((x) => x.n.mls));
  return {
    warning,
    listings: list.map((x) => { const i = info[x.n.mls]; return { ...x.n, offered: i.offeredWeek === week.satIso, priority: i.priorityWeek === week.satIso, days: i.days, instr: i.instr, access: i.access, openHouses: x.openHouses }; })
      .sort((a, b) => Number(b.priority) - Number(a.priority)),
  };
}

// Diagnostic: shows what /members returns and which agent ids were resolved.
export async function probe() {
  const out = {};
  for (const [label, q] of Object.entries({ byName: { agentName: "Troy George" }, byKeywordGeorge: { keywords: "George" }, byKeywordNoonan: { keywords: "Noonan" } })) {
    try {
      const d = await repliersGet("/members", new URLSearchParams({ ...q, resultsPerPage: "5" }));
      out[label] = { topLevelKeys: Object.keys(d), count: d.count, members: membersOf(d).slice(0, 5).map((m) => ({ agentId: m.agentId, boardAgentId: m.boardAgentId, name: m.name, status: m.status, officeId: m.officeId })) };
    } catch (e) { out[label] = { error: e.message }; }
  }
  try { out.resolvedAgentIds = await resolveAgentIds(); } catch (e) { out.resolveError = e.message; }
  return out;
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
