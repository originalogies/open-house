import { listRequests, saveRequest } from "../lib/requests.mjs";
import { sendReminder, sendFeedbackAsk } from "../lib/email.mjs";
import { feedbackStep } from "../lib/feedback.mjs";
import { chicagoNow, addDays } from "../lib/time.mjs";
import { getCutoff } from "../lib/settings.mjs";
import { cutoffInfo, weekSatOf } from "../lib/week.mjs";

// Runs hourly. Sends reminders at 9 AM Central for open houses happening tomorrow, expires
// requests nobody answered before the Friday cutoff, and asks agents for feedback after they host.
export default async () => {
  const { date, hour } = chicagoNow();
  const all = await listRequests();

  // Pending requests expire once the (current) cutoff for their week (Monday to Sunday) has passed. One the team is approving with
  // the AI agent, or one the team added for an agent (its hours held), isn't bound by the cutoff: it waits until its
  // day has passed.
  const cutoff = await getCutoff();
  const stale = (x) => x.status === "pending" && (x.approving || x.addedBy ? x.iso < date : Date.now() > cutoffInfo(weekSatOf(x.iso), cutoff).ms);
  for (const r of all.filter(stale)) { r.status = "expired"; await saveRequest(r); }
  // Feedback: asked about an hour after the open house ends, reminded once a day later.
  for (const r of all) {
    const step = feedbackStep(r);
    if (!step) continue;
    try {
      await sendFeedbackAsk(r, step === "remind");
      r[step === "ask" ? "feedbackAskedAt" : "feedbackRemindedAt"] = Date.now();
      await saveRequest(r);
    } catch (e) { console.error("feedback email failed", r.id, e.message); }
  }

  if (hour !== 9) return;
  const tomorrow = addDays(date, 1);
  for (const r of all.filter((x) => x.status === "approved" && !x.reminderSent && x.iso === tomorrow)) {
    try { await sendReminder(r); r.reminderSent = true; await saveRequest(r); }
    catch (e) { console.error("reminder failed", r.id, e.message); }
  }
};
export const config = { schedule: "0 * * * *" };
