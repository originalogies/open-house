import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { dayMeta, FIRST_HOUR, LAST_HOUR } from "../lib/week.mjs";
import { getRequest, saveRequest, listRequests, overlaps, isTeam } from "../lib/requests.mjs";
import { sendConfirmed, sendDeclined } from "../lib/email.mjs";
import { fmtRange } from "../lib/time.mjs";
import { mode, agentReady, byHand, desiredFor, logEvent, listEvents, getInflight } from "../lib/mls.mjs";
import { openCancelRequest } from "../lib/changes.mjs";
import { isMlsNumber } from "../lib/homes.mjs";

// GET  /api/respond?id=...   -> request details for the team confirm page
// POST /api/respond          -> { id, action: approve|decline, method: manual|agent, mlsEntered }
// To approve a home that's on the MLS the team picks how it goes on the MLS: "manual" (they entered it
// by hand and tick mlsEntered) or "agent" (the AI agent enters it; needs MLS_BOOKING_MODE dry_run or
// live). The approve page then presses Start, which sends the job right away (POST /api/manage "start").
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!isTeam(user.email)) return json(403, { error: "team_only" });

  if (req.method === "GET") {
    const r = await getRequest(new URL(req.url).searchParams.get("id") || "");
    if (!r) return json(404, { error: "not_found" });
    const l = r.listing, d = dayMeta(r.iso), s = r.sync || null, inflight = await getInflight();
    return json(200, {
      id: r.id, status: r.status, address: `${l.addr}, ${l.city}, TX ${l.zip}`, mls: r.mls,
      when: `${d.label}, ${d.date}, ${fmtRange(r.from, r.to)}`, iso: r.iso, from: r.from, to: r.to, firstHour: FIRST_HOUR, lastHour: LAST_HOUR,
      agent: `${r.agent.name} (${r.agent.email})`, agentName: r.agent.name, phone: r.phone, notes: r.notes, decidedBy: r.decidedByName || null,
      cancelledBy: r.cancelledByName || null, mode: mode(), onMls: isMlsNumber(r.mls),
      agentReady: agentReady(), method: r.mlsMethod || null, byHand: byHand(r),
      cancelRequest: openCancelRequest(r) ? { at: r.cancelRequest.at, byName: r.cancelRequest.byName, reason: r.cancelRequest.reason || "" } : null,
      sync: s && { state: s.state, message: s.message || "", current: s.current, job: s.job && { id: s.job.id, action: s.job.action, sentAt: s.job.sentAt, done: !!s.job.done, result: s.job.result || null, screenshot: !!s.job.screenshot },
        delivery: s.delivery ? { attempts: s.delivery.attempts, nextTryAt: s.delivery.nextTryAt } : null,
        busy: !!inflight && inflight.requestId !== r.id }, // the bot is working on another request's job first
      events: (await listEvents(r.id).catch(() => [])).map((e) => ({ at: e.at, type: e.type, by: e.by, note: e.note || e.message || "" })),
    });
  }

  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const b = await req.json().catch(() => null);
  const r = b && (await getRequest(String(b.id || "")));
  if (!r || !["approve", "decline"].includes(b.action)) return json(400, { error: "invalid_request" });
  if (r.status !== "pending") return json(409, { error: "already_answered", status: r.status, by: r.decidedByName || null });
  if (b.action === "approve" && openCancelRequest(r)) return json(409, { error: "cancel_requested", message: "The agent asked to cancel this request. Approve the cancellation or keep it first." });

  // A team-added home isn't on the MLS yet: nothing to enter until it's linked to its MLS listing.
  const onMls = isMlsNumber(r.mls);
  const method = b.method === "agent" ? "agent" : b.method === "manual" || b.mlsEntered === true ? "manual" : null;
  if (b.action === "approve") {
    if (onMls && !method) return json(400, { error: "method_required", message: "Choose how this open house goes on the MLS first." });
    if (onMls && method === "manual" && b.mlsEntered !== true) return json(400, { error: "mls_required", message: "Confirm the open house is entered on the MLS first." });
    if (onMls && method === "agent" && !agentReady()) return json(409, { error: "agent_unavailable", message: "The AI agent isn't connected yet. Enter this open house on the MLS by hand." });
    const all = await listRequests();
    if (all.some((x) => x.id !== r.id && x.status === "approved" && overlaps(x, r))) {
      return json(409, { error: "taken", message: "Another request already holds those hours." });
    }
  }

  r.status = b.action === "approve" ? "approved" : "declined";
  r.decidedAt = Date.now(); r.decidedBy = user.email; r.decidedByName = user.name;
  if (r.status === "approved") {
    // By hand: the team already entered it, so the MLS matches. AI agent: the sync job adds it.
    if (onMls) r.mlsMethod = method;
    r.sync = !onMls ? { current: null, state: "not_on_mls" } : method === "manual" ? { current: desiredFor(r), state: "manual" } : { current: null, state: "idle" };
  }
  await saveRequest(r); // single use: status is no longer pending
  const note = r.status !== "approved" ? "" : !onMls ? "Home isn't on the MLS yet" : method === "manual" ? "Entered on the MLS by hand" : "Scheduled with the AI agent";
  await logEvent(r.id, r.status, { note }, user.email);

  try { await (r.status === "approved" ? sendConfirmed(r) : sendDeclined(r)); }
  catch (e) { console.error("email failed", e.message); return json(502, { error: "email_failed", message: "Saved, but the email to the agent failed to send." }); }
  return json(200, { ok: true, status: r.status });
};
export const config = { path: "/api/respond" };
