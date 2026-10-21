import { overlaps } from "./requests.mjs";
import { FIRST_HOUR, LAST_HOUR } from "./week.mjs";
import { chicagoToUtc } from "./time.mjs";

// Rules for changing or cancelling a request after it was made. Changes and cancellations are
// not limited by the weekly request cutoff; they stay open until the open house starts.

const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const dayKeyOf = (iso) => (dow(iso) === 6 ? "sat" : dow(iso) === 0 ? "sun" : null);
const startMs = (r) => chicagoToUtc(r.iso, r.from).getTime();

const fmtH = (h) => `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}`;
const sameBlock = (a, b) => !!a && !!b && a.iso === b.iso && a.from === b.from && a.to === b.to;

// Team changes the date or hours of an approved open house. Returns an error message or null.
// `external` is the listing's open houses already on the MLS ([{ iso, from, to }], from Repliers).
// The request's own MLS entry is ignored, since it's the one being moved.
export function checkChange(r, next, all, now = Date.now(), external = []) {
  if (r.status !== "approved") return "Only approved open houses can be changed.";
  if (now >= startMs(r)) return "This open house has already started.";
  const { iso, from, to } = next;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) || Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) return "Pick a valid date.";
  if (!dayKeyOf(iso)) return "Open houses are on Saturday or Sunday.";
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < FIRST_HOUR || to > LAST_HOUR || from >= to) return "Pick hours between 9:00 AM and 7:00 PM.";
  if (now >= chicagoToUtc(iso, from).getTime()) return "That time has already passed.";
  if (iso === r.iso && from === r.from && to === r.to) return "That's the same time it already has.";
  const moved = { ...r, iso, from, to };
  if (all.some((x) => x.id !== r.id && x.status === "approved" && overlaps(x, moved))) return "Another approved open house already holds those hours.";
  const own = [r.sync?.current, { iso: r.iso, from: r.from, to: r.to }];
  const clash = external.find((e) => !own.some((o) => sameBlock(o, e)) && e.iso === iso && e.from < to && from < e.to);
  if (clash) return `That overlaps an open house already on the MLS (${fmtH(clash.from)} to ${fmtH(clash.to)}).`;
  return null;
}

// An agent's cancellation request that the team hasn't answered yet.
export const openCancelRequest = (r) => !!r.cancelRequest && !r.cancelRequest.outcome;

// Only the team cancels: any pending or approved request, until it starts.
export function checkCancel(r, user, now = Date.now()) {
  if (!user.team) return "Only the George & Noonan team can cancel an open house.";
  if (!["pending", "approved"].includes(r.status)) return `This request is already ${r.status}.`;
  if (now >= startMs(r)) return "This open house has already started.";
  return null;
}

// Agents ask the team to cancel their own pending or approved request, until it starts.
export function checkCancelRequest(r, user, now = Date.now()) {
  if (r.agent?.email !== user.email) return "You can only ask to cancel your own requests.";
  if (!["pending", "approved"].includes(r.status)) return `This request is already ${r.status}.`;
  if (now >= startMs(r)) return "This open house has already started.";
  if (openCancelRequest(r)) return "You've already asked to cancel this one. The George & Noonan team will get back to you.";
  return null;
}
