import { listRequests, saveRequest } from "../lib/requests.mjs";
import { sendReminder } from "../lib/email.mjs";
import { chicagoNow, addDays } from "../lib/time.mjs";
import { getCutoff } from "../lib/settings.mjs";
import { cutoffInfo } from "../lib/week.mjs";

// Runs hourly. Sends reminders at 9 AM Central for open houses happening tomorrow, and
// expires requests nobody answered before the Friday cutoff.
export default async () => {
  const { date, hour } = chicagoNow();
  const all = await listRequests();

  // Pending requests expire once the (current) cutoff for their weekend has passed.
  const cutoff = await getCutoff();
  const satOf = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() === 0 ? addDays(iso, -1) : iso);
  for (const r of all.filter((x) => x.status === "pending" && Date.now() > cutoffInfo(satOf(x.iso), cutoff).ms)) { r.status = "expired"; await saveRequest(r); }
  if (hour !== 9) return;
  const tomorrow = addDays(date, 1);
  for (const r of all.filter((x) => x.status === "approved" && !x.reminderSent && x.iso === tomorrow)) {
    try { await sendReminder(r); r.reminderSent = true; await saveRequest(r); }
    catch (e) { console.error("reminder failed", r.id, e.message); }
  }
};
export const config = { schedule: "0 * * * *" };
