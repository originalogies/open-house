const TZ = "America/Chicago";

export const fmtHour = (h) => `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}`;
export const fmtRange = (from, to) => `${fmtHour(from)} to ${fmtHour(to)}`;
export const fmtArrival = (from) => {
  const h = from - 1, m = 30; // 30 minutes before the start
  return `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
};

const parts = (date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" })
      .formatToParts(date).map((p) => [p.type, p.value])
  );

export const chicagoNow = (now = new Date()) => {
  const p = parts(now);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const fmtReceived = (ms) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(ms)).replace(" at ", ", ").replace(/, (\d{1,2}:\d{2})/, " at $1") + " CT";

// Chicago wall-clock time -> UTC Date (handles CDT/CST).
export const chicagoToUtc = (iso, hour) => {
  const [y, m, d] = iso.split("-").map(Number);
  for (const off of [5, 6]) {
    const c = new Date(Date.UTC(y, m - 1, d, hour + off));
    if (Number(parts(c).hour) === hour) return c;
  }
  return new Date(Date.UTC(y, m - 1, d, hour + 6));
};
