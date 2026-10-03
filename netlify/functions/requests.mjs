import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { WEEK, findListing } from "../lib/listings.mjs";
import { listRequests, saveRequest, newId, overlaps, closed } from "../lib/requests.mjs";
import { sendRequestReceived, sendRequestSent } from "../lib/email.mjs";
import { fmtRange } from "../lib/time.mjs";

export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (closed()) return json(409, { error: "closed", message: `Requests closed ${WEEK.closesLabel}.` });

  const b = await req.json().catch(() => null);
  const listing = b && findListing(String(b.mls));
  const from = Number(b?.from), to = Number(b?.to);
  if (!listing || !listing.days.includes(b.day) || !Number.isInteger(from) || !Number.isInteger(to)
      || from < WEEK.firstHour || to > WEEK.lastHour || from >= to) {
    return json(400, { error: "invalid_request" });
  }
  const notes = String(b.notes || "").slice(0, 1000).trim();
  const phone = String(b.phone || "").slice(0, 30).trim();

  const all = await listRequests();
  const mineLive = all.filter((r) => r.agent.email === user.email && (r.status === "pending" || r.status === "approved"));
  const candidate = { mls: listing.mls, day: b.day, from, to };
  if (mineLive.length >= 12) return json(429, { error: "too_many", message: "Too many open requests. Wait for some to be answered." });
  if (mineLive.some((r) => overlaps(r, candidate))) return json(409, { error: "overlap", message: "You already have a request that overlaps those hours." });
  if (all.some((r) => r.status === "approved" && overlaps(r, candidate))) return json(409, { error: "taken", message: "Those hours were just taken. Pick another time." });

  const record = { id: newId(), ...candidate, notes, phone, agent: { email: user.email, name: user.name }, status: "pending", createdAt: Date.now(), reminderSent: false };
  await saveRequest(record);

  const others = all
    .filter((r) => r.mls === listing.mls && r.status === "pending" && r.day === b.day)
    .map((r) => `${r.agent.name}, ${fmtRange(r.from, r.to)}`).join("; ");
  try {
    await Promise.all([sendRequestReceived(record, others), sendRequestSent(record)]);
  } catch (e) {
    console.error("email failed", e.message);
    return json(502, { error: "email_failed", id: record.id, message: "Your request was saved but the notification emails failed. Let the team know." });
  }
  return json(200, { ok: true, id: record.id });
};
export const config = { path: "/api/requests" };
