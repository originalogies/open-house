import { chicagoNow, addDays, chicagoToUtc } from "./time.mjs";

const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
const fmt = (iso, o) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(new Date(`${iso}T12:00:00Z`));
const label = (iso) => fmt(iso, { weekday: "long" });
const short = (iso) => fmt(iso, { month: "short", day: "numeric" });

export const dayMeta = (iso) => ({ iso, label: label(iso), date: short(iso) });

// Open houses can be on any day the seller allows (a home's days, set on Listings; Saturday and Sunday unless the
// team changes them). The keys, in week order: weeks run Monday to Sunday.
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const dayKeyOf = (iso) => DAY_KEYS[(dow(iso) + 6) % 7];
// The Saturday of the Monday-to-Sunday week a date falls in. It names the week: publishing and Priority are saved
// against it (offeredWeek, priorityWeek), and the weekly cutoff is set relative to it.
export const weekSatOf = (iso) => addDays(iso, dow(iso) === 0 ? -1 : 6 - dow(iso));

export const FIRST_HOUR = 9, LAST_HOUR = 19;
// Cutoff setting: weekly, optional. day: 0 = Sunday .. 6 = Saturday, time: "HH:MM" Central.
export const DEFAULT_CUTOFF = { enabled: true, day: 5, time: "17:00" };

export const normalizeCutoff = (c) => {
  const day = Number(c?.day), m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(c?.time || ""));
  if (!Number.isInteger(day) || day < 0 || day > 6 || !m) return null;
  return { enabled: c.enabled !== false, day, time: `${m[1]}:${m[2]}` };
};

// Date the cutoff falls on for the weekend whose Saturday is `satIso`.
const cutoffIso = (satIso, day) => addDays(satIso, day === 0 ? 1 : day - 6);
const timeLabel = (time) => { const [h, m] = time.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

// When requests stop for a weekend. With the cutoff turned off, requests stay open until the
// last open house hour on Sunday.
export function cutoffInfo(satIso, cutoff = DEFAULT_CUTOFF) {
  if (!cutoff.enabled) {
    const sun = addDays(satIso, 1);
    return { ms: chicagoToUtc(sun, LAST_HOUR).getTime(), label: `${label(sun)}, ${short(sun)} at ${timeLabel(`${LAST_HOUR}:00`)}` };
  }
  const iso = cutoffIso(satIso, cutoff.day), [h, m] = cutoff.time.split(":").map(Number);
  return { ms: chicagoToUtc(iso, h).getTime() + m * 60000, label: `${label(iso)}, ${short(iso)} at ${timeLabel(cutoff.time)}` };
}

// A day an open house can still start on: a later day, or today while an hour can still start (Central time).
const stillOpen = (iso, { date, hour }) => iso > date || (iso === date && hour + 1 < LAST_HOUR);

// The days the team can add a request for: from today to the end of the week `weeks` weeks out (this week and the
// next three), every day of the week; the form offers the ones the home's seller allows. The weekly cutoff doesn't
// apply to the team.
export function upcomingDays(now = new Date(), weeks = 4) {
  const today = chicagoNow(now), last = addDays(weekSatOf(today.date), 1 + 7 * (weeks - 1));
  const out = [];
  for (let iso = today.date; iso <= last; iso = addDays(iso, 1)) if (stillOpen(iso, today)) out.push({ key: dayKeyOf(iso), ...dayMeta(iso) });
  return out;
}

// The week agents can request open houses for: Monday to Sunday, the current week or, once its cutoff has passed,
// the next. days: all seven, by key. Days already past stay in it (requests made for them still show), but agents
// can only request the ones openDays lists.
export function getWeek(now = new Date(), cutoff = DEFAULT_CUTOFF) {
  let sat = weekSatOf(chicagoNow(now).date);
  while (now.getTime() > cutoffInfo(sat, cutoff).ms) sat = addDays(sat, 7);
  const c = cutoffInfo(sat, cutoff), mon = addDays(sat, -5);
  return {
    days: Object.fromEntries(DAY_KEYS.map((k, i) => [k, dayMeta(addDays(mon, i))])),
    label: `${short(mon)} to ${short(addDays(sat, 1))}`, // "Nov 9 to Nov 15"
    satIso: sat,
    closes: c.ms,
    cutoffEnabled: cutoff.enabled,
    closesLabel: c.label,
    firstHour: FIRST_HOUR,
    lastHour: LAST_HOUR,
  };
}

// The days of the week agents can still request (getWeek): today while an hour can still start, and the days after.
export const openDays = (week, now = new Date()) => DAY_KEYS.filter((k) => stillOpen(week.days[k].iso, chicagoNow(now)));
