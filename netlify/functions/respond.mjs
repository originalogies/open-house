import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { dayMeta, FIRST_HOUR, LAST_HOUR } from "../lib/week.mjs";
import { getRequest, saveRequest, isTeam } from "../lib/requests.mjs";
import { sendDeclined } from "../lib/email.mjs";
import { fmtRange } from "../lib/time.mjs";
import { mode, agentReady, byHand, logEvent, listEvents, getInflight } from "../lib/mls.mjs";
import { approveRequest } from "../lib/actions.mjs";
import { openCancelRequest } from "../lib/changes.mjs";
import { isMlsNumber } from "../lib/homes.mjs";
import { feedbackOpen, withPhotoUrls } from "../lib/feedback.mjs";

// GET  /api/respond?id=...   -> request details for the team confirm page
// POST /api/respond          -> { id, action: approve|decline, method: manual|agent, mlsEntered, reason }
// Approving is approveRequest (actions.mjs): a home on the MLS needs "manual" (entered by hand, mlsEntered) or
// "agent" (the AI agent enters it; needs MLS_BOOKING_MODE dry_run or live). With the AI agent the approve page
// then presses Start, which sends the job right away (POST /api/manage "start").
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
      cancelledBy: r.cancelledByName || null, addedBy: r.addedBy?.name || null, mode: mode(), onMls: isMlsNumber(r.mls),
      agentReady: agentReady(), method: r.mlsMethod || null, byHand: byHand(r),
      approving: r.approving ? { at: r.approving.at, byName: r.approving.byName } : null, emailFailed: !!r.confirmEmailFailed, noEmails: r.sendEmails === false,
      declineReason: r.declineReason || "",
      feedback: r.feedback ? withPhotoUrls(r) : null, feedbackDue: !r.feedback && feedbackOpen(r), // the agent's feedback after hosting
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
  // Being approved with the AI agent: the team can still enter it by hand or decline, but not while the
  // AI agent is in the middle of a job, and it isn't sent to the AI agent twice.
  if (r.approving && r.sync?.state === "booking") return json(409, { error: "agent_working", message: "The AI agent is working on this one. Wait for its result." });

  if (b.action === "approve") {
    const { status, body } = await approveRequest(r, user, { method: b.method, mlsEntered: b.mlsEntered });
    return json(status, body);
  }

  r.status = "declined";
  r.decidedAt = Date.now(); r.decidedBy = user.email; r.decidedByName = user.name;
  // The team's optional reason for declining goes to the agent in the decline email.
  const reason = String(b.reason || "").trim().slice(0, 500);
  if (reason) r.declineReason = reason;
  const wasApproving = !!r.approving; delete r.approving; // declined after trying the AI agent
  if (wasApproving) r.sync = { current: r.sync?.current || null, state: "idle" }; // the AI agent's failure no longer matters
  await saveRequest(r); // single use: status is no longer pending
  await logEvent(r.id, r.status, { note: [wasApproving && "Declined after trying the AI agent", reason && `Reason: ${reason}`].filter(Boolean).join(". ") }, user.email);

  try { await sendDeclined(r); }
  catch (e) { console.error("email failed", e.message); return json(502, { error: "email_failed", message: "Saved, but the email to the agent failed to send." }); }
  return json(200, { ok: true, status: r.status });
};
export const config = { path: "/api/respond" };
