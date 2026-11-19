// Listing limits: the highest list price each agent can book an open house for on the portal, set by admins on the
// Admin Console's Agents page. Homes priced at or under an agent's limit book as usual; homes over it still show on
// the portal, grayed out, and the request API turns them away. An agent with no limit can book every home.
// Stored as one blob, { "<email>": <dollars> }, beside the access list. The team can still add a request for an
// agent on any home (Requests > Add a request), which is how an agent gets access to one over their limit.

export const LIMIT_MESSAGE = "This home is above your listing limit. Reach out to a George & Noonan team member to request access.";

// A limit from the Agents page: whole dollars, with or without "$" and commas. Blank means no limit (null).
// Anything else that isn't a positive amount is undefined (invalid).
export function parseLimit(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Math.round(Number(s));
  return n > 0 && n <= 1e10 ? n : undefined;
}

// The agent's limit, or null when they have none.
export const limitFor = (limits, email) => {
  const n = limits?.[String(email || "").trim().toLowerCase()];
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Whether a home is over the limit. No limit, or a home with no price (a team-added home not priced yet), never is.
export const overLimit = (price, limit) => limit != null && Number(price) > 0 && Number(price) > limit;

const store = async () => {
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: "open-house", consistency: "strong" }); // a change applies on the agent's next click
};

export async function getLimits() {
  const v = await (await store()).get("limits", { type: "json" }).catch(() => null);
  return v && typeof v === "object" ? v : {};
}

// Sets (or, with null, clears) one agent's limit and returns every limit.
export async function setLimit(email, limit) {
  const s = await store();
  const all = { ...((await s.get("limits", { type: "json" }).catch(() => null)) || {}) };
  if (limit == null) delete all[email]; else all[email] = limit;
  await s.setJSON("limits", all);
  return all;
}
