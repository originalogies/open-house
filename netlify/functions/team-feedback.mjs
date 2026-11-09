import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { listRequests, getRequest, saveRequest } from "../lib/requests.mjs";
import { dayMeta } from "../lib/week.mjs";
import { fmtRange } from "../lib/time.mjs";
import { feedbackByHome, checkFeedbackReminder, markActive } from "../lib/feedback.mjs";
import { currentHomes } from "../lib/listings.mjs";
import { currentWeek } from "../lib/settings.mjs";
import { sendFeedbackAsk } from "../lib/email.mjs";
import { logEvent } from "../lib/mls.mjs";

// GET  /api/team/feedback -> every home that's hosted an open house, with each open house and the
// agent's feedback, for the Admin Console's Feedback tab. Team only. Access details are never included.
// ?active=1 also says which homes are on the market now (active: true) for the tab's Active / Past filter;
// statusKnown is false when Repliers can't be reached and that can't be told.
// POST /api/team/feedback { id, action: "remind" } -> emails the agent who hosted that open house a reminder
// to send feedback, with the link (the same email as the hourly job's reminder). It counts as the hourly job's
// ask and reminder, so the job doesn't email them again about it.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.team) return json(403, { error: "team_only" });

  if (req.method === "GET") {
    const withStatus = new URL(req.url).searchParams.get("active") === "1";
    const [all, current] = await Promise.all([listRequests(), withStatus ? currentWeek().then(currentHomes).catch(() => null) : null]);
    let homes = feedbackByHome(all).map((h) => ({
      ...h,
      openHouses: h.openHouses.map((o) => ({ ...o, day: dayMeta(o.iso).label, date: dayMeta(o.iso).date, time: fmtRange(o.from, o.to) })),
    }));
    if (!withStatus) return json(200, { homes });
    const statusKnown = !!current && !current.warning;
    if (statusKnown) homes = markActive(homes, current);
    return json(200, { homes, statusKnown });
  }

  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const b = await req.json().catch(() => null);
  if (b?.action !== "remind") return json(400, { error: "invalid_action" });
  const r = await getRequest(String(b.id || ""));
  if (!r) return json(404, { error: "not_found" });
  const err = checkFeedbackReminder(r);
  if (err) return json(409, { error: "cannot_remind", message: err });
  try { await sendFeedbackAsk(r, true); }
  catch (e) {
    console.error("feedback reminder failed", r.id, e.message);
    return json(502, { error: "email_failed", message: "The reminder didn't send. Try again." });
  }
  const at = Date.now();
  r.feedbackReminders = [...(r.feedbackReminders || []), { at, by: user.email, byName: user.name }];
  r.feedbackAskedAt ||= at; r.feedbackRemindedAt ||= at;
  await saveRequest(r);
  await logEvent(r.id, "feedback_reminder", { note: `Emailed ${r.agent.name} a reminder to send feedback` }, user.email);
  return json(200, { ok: true, reminded: { at, byName: user.name }, reminders: r.feedbackReminders.length });
};
export const config = { path: "/api/team/feedback" };
