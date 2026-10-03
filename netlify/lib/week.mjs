import { chicagoNow, addDays, chicagoToUtc } from "./time.mjs";

const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
const label = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${iso}T12:00:00Z`));
const short = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${iso}T12:00:00Z`));

export const dayMeta = (iso) => ({ iso, label: label(iso), date: short(iso) });

const closesFor = (sat) => chicagoToUtc(addDays(sat, -1), 17).getTime(); // Friday 5:00 PM CT

// The weekend currently open for requests: the next Saturday/Sunday whose Friday 5 PM cutoff has not passed.
export function getWeek(now = new Date()) {
  const today = chicagoNow(now).date;
  let sat = addDays(today, (6 - dow(today) + 7) % 7);
  if (now.getTime() > closesFor(sat)) sat = addDays(sat, 7);
  const sun = addDays(sat, 1), fri = addDays(sat, -1);
  return {
    days: { sat: dayMeta(sat), sun: dayMeta(sun) },
    satIso: sat,
    closes: closesFor(sat),
    closesLabel: `${label(fri)}, ${short(fri)} at 5:00 PM`,
    firstHour: 9,
    lastHour: 19,
  };
}
