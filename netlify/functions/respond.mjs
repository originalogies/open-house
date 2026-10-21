import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { dayMeta, FIRST_HOUR, LAST_HOUR } from "../lib/week.mjs";
import { getRequest, saveRequest, listRequests, overlaps, isTeam } from "../lib/requests.mjs";
import { sendConfirmed, sendDeclined } from "../lib/email.mjs";
import { fmtRange } from "../lib/time.mjs";
import { mode, desiredFor, logEvent, listEvents } from "../lib/mls.mjs";

// GET  /api/respond?id=...   -> request details for the team confirm page
// POST /api/respond          -> { id, action: approve|decline, mlsEntered }
// With MLS_BOOKING_MODE off the team enters the MLS by hand and must tick "entered on the MLS".
// In dry_run or live mode, approving hands the MLS entry to the bot (see mls-sync).
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!isTeam(user.email)) return json(403, { error: "team_only" });

  if (req.method === "GET") {
    const r = await getRequest(new URL(req.url).searchParams.get("id") || "");
    if (!r) return json(404, { error: "not_found" });
    const l = r.listing, d = dayMeta(r.iso), s = r.sync || null;
    return json(200, {
      id: r.id, status: r.status, address: `${l.addr}, ${l.city}, TX ${l.zip}`, mls: r.mls,
      when: `${d.label}, ${d.date}, ${fmtRange(r.from, r.to)}`, iso: r.iso, from: r.from, to: r.to, firstHour: FIRST_HOUR, lastHour: LAST_HOUR,
      agent: `${r.agent.name} (${r.agent.email})`, phone: r.phone, notes: r.notes, decidedBy: r.decidedByName || null,
      cancelledBy: r.cancelledByName || null, mode: mode(),
      sync: s && { state: s.state, message: s.message || "", current: s.current, job: s.job && { id: s.job.id, action: s.job.action, sentAt: s.job.sentAt, done: !!s.job.done, result: s.job.result || null, screenshot: !!s.job.screenshot } },
      events: (await listEvents(r.id).catch(() => [])).map((e) => ({ at: e.at, type: e.type, by: e.by, note: e.note || e.message || "" })),
    });
  }

  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const b = await req.json().catch(() => null);
  const r = b && (await getRequest(String(b.id || "")));
  if (!r || !["approve", "decline"].includes(b.action)) return json(400, { error: "invalid_request" });
  if (r.status !== "pending") return json(409, { error: "already_answered", status: r.status, by: r.decidedByName || null });

  const manual = mode() === "off";
  if (b.action === "approve") {
    if (manual && b.mlsEntered !== true) return json(400, { error: "mls_required", message: "Confirm the open house is entered on the MLS first." });
    const all = await listRequests();
    if (all.some((x) => x.id !== r.id && x.status === "approved" && overlaps(x, r))) {
      return json(409, { error: "taken", message: "Another request already holds those hours." });
    }
  }

  r.status = b.action === "approve" ? "approved" : "declined";
  r.decidedAt = Date.now(); r.decidedBy = user.email; r.decidedByName = user.name;
  if (r.status === "approved") {
    // Manual mode: the team already entered it, so the MLS matches. Otherwise the bot will add it.
    r.sync = manual ? { current: desiredFor(r), state: "manual" } : { current: null, state: "idle" };
  }
  await saveRequest(r); // single use: status is no longer pending
  await logEvent(r.id, r.status, { note: r.status === "approved" ? (manual ? "Entered on the MLS by hand" : "Queued for the MLS bot") : "" }, user.email);

  try { await (r.status === "approved" ? sendConfirmed(r) : sendDeclined(r)); }
  catch (e) { console.error("email failed", e.message); return json(502, { error: "email_failed", message: "Saved, but the email to the agent failed to send." }); }
  return json(200, { ok: true, status: r.status });
};
export const config = { path: "/api/respond" };
