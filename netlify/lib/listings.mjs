import { getStore } from "@netlify/blobs";
import { getWeek } from "./week.mjs";

// ---- Repliers (read-only) -----------------------------------------------
const BASE = "https://api.repliers.io";
export const AGENT_IDS = ["492946", "560617"]; // Troy George, Lucy Noonan
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
  const pages = await Promise.all(AGENT_IDS.map((id) =>
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
const blank = { offeredWeek: null, days: ["sat", "sun"], instr: [], access: "" };

export const getInfo = async (mls) => ({ ...blank, ...((await infoStore().get(`mls/${mls}`, { type: "json" }).catch(() => null)) || {}) });
export const saveInfo = (mls, info) => infoStore().setJSON(`mls/${mls}`, info);

export async function allInfo(mlsList) {
  const entries = await Promise.all(mlsList.map(async (m) => [m, await getInfo(m)]));
  return Object.fromEntries(entries);
}

// Listings the team has offered for the current weekend. Never includes access details.
export async function offeredListings(week = getWeek()) {
  const raw = await fetchRaw();
  const info = await allInfo(raw.map((l) => String(l.mlsNumber)));
  return raw
    .filter((l) => info[String(l.mlsNumber)].offeredWeek === week.satIso)
    .map((l) => {
      const n = normalize(l), i = info[n.mls];
      return { ...n, days: i.days, instr: i.instr, external: openHouseBlocks(l, week) };
    });
}

export async function teamListings(week = getWeek()) {
  const raw = await fetchRaw();
  const info = await allInfo(raw.map((l) => String(l.mlsNumber)));
  return raw.map((l) => {
    const n = normalize(l), i = info[n.mls];
    return { ...n, offered: i.offeredWeek === week.satIso, days: i.days, instr: i.instr, access: i.access, openHouses: openHouseBlocks(l, week) };
  });
}

// Diagnostic: looks up known MLS numbers (any status) to reveal how Repliers identifies their agents.
export async function probe() {
  const mls = ["21297798", "21372196", "21332907", "21346883"];
  return Promise.all(mls.map(async (m) => {
    try {
      const d = await repliers(new URLSearchParams({ mlsNumber: m }));
      const l = (d.listings || [])[0];
      return { mls: m, count: d.count, found: !!l, status: l?.status, lastStatus: l?.lastStatus, class: l?.class, board: l?.boardId, agents: l?.agents, office: l?.office, openHouse: l?.openHouse };
    } catch (e) { return { mls: m, error: e.message }; }
  }));
}

export const rawSample = async () => {
  const [first] = await fetchRaw();
  if (!first) return null;
  const { details, ...rest } = first;
  const { description, ...d } = details || {};
  return { ...rest, details: d };
};

export const publicListing = (l) => ({ mls: l.mls, addr: l.addr, city: l.city, zip: l.zip, lat: l.lat, lng: l.lng, price: l.price, dom: l.dom, bd: l.bd, ba: l.ba, sf: l.sf, img: l.img, days: l.days, instr: l.instr });

// Snapshot stored on each request so emails and reminders keep working if the listing changes.
export const snapshot = (l) => ({ mls: l.mls, addr: l.addr, city: l.city, zip: l.zip, lat: l.lat, lng: l.lng, price: l.price, img: l.img });
