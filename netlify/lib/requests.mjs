import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { adminEmails, parseList } from "./shared.mjs";
import { dayMeta } from "./week.mjs";
import { fmtRange } from "./time.mjs";
import { feedbackOpen } from "./feedback.mjs";
import { readAll } from "./readall.mjs";

// Strong reads: a decision or a new request shows everywhere at once (the default can serve a copy up to a minute old).
const store = () => getStore({ name: "open-house-requests", consistency: "strong" });

export const newId = () => crypto.randomBytes(16).toString("hex");
export const overlaps = (a, b) => a.mls === b.mls && a.iso === b.iso && a.from < b.to && b.from < a.to;

// The time is spoken for: approved, being approved with the AI agent (still waiting until the AI agent
// reports it's on the MLS; see respond.mjs), or added by the team for an agent and still waiting for a
// decision (r.addedBy; team-new-request.mjs). Nobody else can request or be approved for those hours.
export const holdsSlot = (r) => r.status === "approved" || (r.status === "pending" && (!!r.approving || !!r.addedBy));

// An agent's open requests: waiting or approved, for open houses that haven't happened yet (today counts).
// Past open houses, including the history imported from the G&N calendar, don't count toward the limit.
export const openRequestsOf = (all, email, today) =>
  all.filter((r) => r.agent?.email === email && (r.status === "pending" || r.status === "approved") && r.iso >= today);

// Team members who may approve: admins plus optional TEAM_EMAILS.
export const isTeam = (email) => [...adminEmails(), ...parseList(process.env.TEAM_EMAILS)].includes(String(email).toLowerCase());

export const listRequests = async () => (await readAll(store(), "open-house-requests", "req/")).map(([, r]) => r);
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
        notes: r.notes || "", createdAt: r.createdAt, decidedAt: r.decidedAt || null, decidedBy: r.decidedByName || null,
        cancelRequested: !!r.cancelRequest && !r.cancelRequest.outcome, // same rule as openCancelRequest in changes.mjs
        feedback: r.feedback ? "sent" : feedbackOpen(r) ? "due" : null, visitors: r.feedback ? r.feedback.visitors : null };
    });
};

// Everyone the team can add a request for, by name: agents who have asked for or hosted an open house, and
// agents who signed the Support and Referral Agreement. The newest name and phone on their requests win.
export function knownAgents(all, agreements = []) {
  const by = new Map();
  for (const r of [...all].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    const email = String(r.agent?.email || "").toLowerCase();
    if (!email) continue;
    const p = by.get(email) || { email, name: "", phone: "" };
    if (r.agent.name) p.name = r.agent.name;
    if (r.phone) p.phone = r.phone;
    by.set(email, p);
  }
  for (const a of agreements) {
    const email = String(a.email || "").toLowerCase(), p = by.get(email);
    if (email && a.signedName && !p?.name) by.set(email, { phone: "", ...p, email, name: a.signedName });
  }
  return [...by.values()].filter((p) => p.name).sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

export const getRequest =(id) => (/^[a-f0-9]{32}$/.test(id) ? store().get(`req/${id}`, { type: "json" }) : null);
export const saveRequest = (r) => store().setJSON(`req/${r.id}`, r);
