import { listRequests, saveRequest } from "../lib/requests.mjs";
import { sendReminder } from "../lib/email.mjs";
import { chicagoNow, addDays } from "../lib/time.mjs";

// Runs hourly. Sends reminders at 9 AM Central for open houses happening tomorrow, and
// expires requests nobody answered before the Friday cutoff.
export default async () => {
  const { date, hour } = chicagoNow();
  const all = await listRequests();

  for (const r of all.filter((x) => x.status === "pending" && Date.now() > x.closesAt)) { r.status = "expired"; await saveRequest(r); }
  if (hour !== 9) return;
  const tomorrow = addDays(date, 1);
  for (const r of all.filter((x) => x.status === "approved" && !x.reminderSent && x.iso === tomorrow)) {
    try { await sendReminder(r); r.reminderSent = true; await saveRequest(r); }
    catch (e) { console.error("reminder failed", r.id, e.message); }
  }
};
export const config = { schedule: "0 * * * *" };
