import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { adminEmails, parseList } from "./shared.mjs";
import { WEEK } from "./listings.mjs";

const store = () => getStore("open-house-requests");

export const newId = () => crypto.randomBytes(16).toString("hex");
export const overlaps = (a, b) => a.mls === b.mls && a.day === b.day && a.from < b.to && b.from < a.to;
export const closed = (now = Date.now()) => now > new Date(WEEK.closes).getTime();

// Team members who may approve: admins plus optional TEAM_EMAILS.
export const isTeam = (email) => [...adminEmails(), ...parseList(process.env.TEAM_EMAILS)].includes(String(email).toLowerCase());

export async function listRequests() {
  const s = store();
  const { blobs } = await s.list({ prefix: "req/" });
  const all = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return all.filter(Boolean);
}
export const getRequest = (id) => (/^[a-f0-9]{32}$/.test(id) ? store().get(`req/${id}`, { type: "json" }) : null);
export const saveRequest = (r) => store().setJSON(`req/${r.id}`, r);
