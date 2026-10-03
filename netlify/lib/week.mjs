import { chicagoNow, addDays, chicagoToUtc } from "./time.mjs";

const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
const fmt = (iso, o) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(new Date(`${iso}T12:00:00Z`));
const label = (iso) => fmt(iso, { weekday: "long" });
const short = (iso) => fmt(iso, { month: "short", day: "numeric" });

export const dayMeta = (iso) => ({ iso, label: label(iso), date: short(iso) });

const FIRST_HOUR = 9, LAST_HOUR = 19;
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

// The weekend currently open for requests: the current or next Saturday/Sunday whose cutoff has not passed.
export function getWeek(now = new Date(), cutoff = DEFAULT_CUTOFF) {
  const today = chicagoNow(now).date;
  let sat = dow(today) === 0 ? addDays(today, -1) : addDays(today, (6 - dow(today) + 7) % 7);
  while (now.getTime() > cutoffInfo(sat, cutoff).ms) sat = addDays(sat, 7);
  const c = cutoffInfo(sat, cutoff);
  return {
    days: { sat: dayMeta(sat), sun: dayMeta(addDays(sat, 1)) },
    satIso: sat,
    closes: c.ms,
    closesLabel: c.label,
    firstHour: FIRST_HOUR,
    lastHour: LAST_HOUR,
  };
}
