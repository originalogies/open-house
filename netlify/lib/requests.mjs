import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { adminEmails, parseList } from "./shared.mjs";
import { dayMeta } from "./week.mjs";
import { fmtRange } from "./time.mjs";

const store = () => getStore("open-house-requests");

export const newId = () => crypto.randomBytes(16).toString("hex");
export const overlaps = (a, b) => a.mls === b.mls && a.iso === b.iso && a.from < b.to && b.from < a.to;

// Team members who may approve: admins plus optional TEAM_EMAILS.
export const isTeam = (email) => [...adminEmails(), ...parseList(process.env.TEAM_EMAILS)].includes(String(email).toLowerCase());

export async function listRequests() {
  const s = store();
  const { blobs } = await s.list({ prefix: "req/" });
  const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return all.filter(Boolean);
}
// One agent's own requests, every weekend and status, newest open house first.
// Built field by field so nothing private (access details, other agents) can slip through.
export const historyFor = (all, email) => {
  const me = String(email || "").toLowerCase();
  return all.filter((r) => String(r.agent?.email || "").toLowerCase() === me)
    .sort((a, b) => b.iso.localeCompare(a.iso) || b.from - a.from)
    .map((r) => {
      const d = dayMeta(r.iso), l = r.listing || {};
      return { id: r.id, status: r.status, mls: r.mls, iso: r.iso, from: r.from, to: r.to,
        addr: l.addr, city: l.city, zip: l.zip, img: l.img || null, day: d.label, date: d.date, time: fmtRange(r.from, r.to),
        notes: r.notes || "", createdAt: r.createdAt, decidedAt: r.decidedAt || null, decidedBy: r.decidedByName || null };
    });
};

export const getRequest =(id) => (/^[a-f0-9]{32}$/.test(id) ? store().get(`req/${id}`, { type: "json" }) : null);
export const saveRequest = (r) => store().setJSON(`req/${r.id}`, r);
