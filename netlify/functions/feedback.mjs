import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { getRequest, saveRequest } from "../lib/requests.mjs";
import { sendFeedbackToTeam } from "../lib/email.mjs";
import { feedbackOpen, cleanFeedback, endMs } from "../lib/feedback.mjs";
import { dayMeta } from "../lib/week.mjs";
import { fmtRange } from "../lib/time.mjs";
import { openCancelRequest } from "../lib/changes.mjs";

// GET  /api/feedback?id=...                     the open house (status, who approved it, the agent's request notes) and any feedback already sent
// POST /api/feedback { id, visitors, interest, happened, teamNotes, brokerFlag }
// Only the agent who hosted can see or send it, once, after the open house ends. The team is emailed.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  const isPost = req.method === "POST";
  if (isPost && !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  if (!isPost && req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const b = isPost ? await req.json().catch(() => null) : { id: new URL(req.url).searchParams.get("id") };
  const r = b && (await getRequest(String(b.id || "")));
  // Agents only see their own open houses; anyone else's id looks like it doesn't exist.
  if (!r || r.agent.email !== user.email) return json(404, { error: "not_found" });

  if (!isPost) {
    const d = dayMeta(r.iso), l = r.listing || {};
    return json(200, {
      id: r.id, addr: l.addr, city: l.city, img: l.img || null, day: d.label, date: d.date, time: fmtRange(r.from, r.to),
      open: feedbackOpen(r), status: r.status, endsAt: endMs(r), feedback: r.feedback || null,
      iso: r.iso, decidedBy: r.decidedByName || null, notes: r.notes || "", cancelRequested: openCancelRequest(r),
    });
  }
  if (r.feedback) return json(409, { error: "already_sent", message: "You already sent feedback for this open house." });
  if (!feedbackOpen(r)) return json(409, { error: "not_open", message: r.status === "approved" ? "You can leave feedback once the open house ends." : "This open house didn't take place." });
  const { error, feedback } = cleanFeedback(b);
  if (error) return json(400, { error: "invalid", message: error });
  r.feedback = feedback;
  await saveRequest(r);
  try { await sendFeedbackToTeam(r); }
  catch (e) {
    console.error("feedback email failed", r.id, e.message);
    return json(502, { error: "email_failed", message: "Your feedback was saved, but the email to the team didn't send. They'll still see it in the Admin Console." });
  }
  return json(200, { ok: true });
};
export const config = { path: "/api/feedback" };
