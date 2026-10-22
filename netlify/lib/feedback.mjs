import { chicagoToUtc } from "./time.mjs";
import { addressKey } from "./homes.mjs";

// Feedback from the agent after hosting an open house. Stored on the request as r.feedback:
// { at, visitors, interest, happened, teamNotes, brokerFlag }. Only the George & Noonan team sees it.

const HOUR = 60 * 60 * 1000;
export const INTEREST = { lots: "Lots", some: "Some", little: "Little" };
const MAX_TEXT = 5000;

export const endMs = (r) => chicagoToUtc(r.iso, r.to).getTime();

// The agent can leave feedback once an approved open house has ended.
export const feedbackOpen = (r, now = Date.now()) => r.status === "approved" && now >= endMs(r);

// What the hourly job owes this request: "ask" an hour after it ends, one "remind" a day after
// the ask, or nothing. Open houses that ended more than 3 days ago are never asked about, so
// turning this on doesn't email agents about old open houses.
export function feedbackStep(r, now = Date.now()) {
  if (!feedbackOpen(r, now) || r.feedback) return null;
  if (!r.feedbackAskedAt) return now >= endMs(r) + HOUR && now < endMs(r) + 3 * 24 * HOUR ? "ask" : null;
  if (!r.feedbackRemindedAt && now >= r.feedbackAskedAt + 24 * HOUR) return "remind";
  return null;
}

// Checks and cleans what the agent sent. Returns { error } or { feedback }.
export function cleanFeedback(b, now = Date.now()) {
  const text = (v) => String(v ?? "").replace(/\r\n/g, "\n").trim();
  const visitors = Number(b?.visitors);
  if (b?.visitors === "" || b?.visitors == null || !Number.isInteger(visitors) || visitors < 0 || visitors > 999) return { error: "Enter how many people came (0 if nobody did)." };
  if (!INTEREST[b.interest]) return { error: "Pick the interest level." };
  const happened = text(b.happened), teamNotes = text(b.teamNotes);
  if (!happened) return { error: "Tell us what happened at the open house." };
  if (happened.length > MAX_TEXT || teamNotes.length > MAX_TEXT) return { error: "That's too long. Keep each box under 5,000 characters." };
  const brokerFlag = b.brokerFlag === true;
  if (brokerFlag && !teamNotes) return { error: "Describe what the broker needs to know in the notes for the team." };
  return { feedback: { at: now, visitors, interest: b.interest, happened, teamNotes, brokerFlag } };
}

// ---- feedback by home, for the Admin Console's Feedback tab --------------------------------
// Open houses are grouped by street address and ZIP rather than MLS number, so a home keeps its
// history when it's relisted under a new MLS number. Built from the requests themselves, so homes
// that sold or left the feed keep theirs too.
export const homeKey = (l) => addressKey(l?.addr, l?.zip);

// Every hosted open house (approved and ended), grouped by home: totals, plus each open house
// newest first with its feedback (null when the agent hasn't sent any). Homes with a broker flag
// come first, then the most recently hosted.
export function feedbackByHome(requests, now = Date.now()) {
  const homes = new Map();
  for (const r of requests.filter((x) => feedbackOpen(x, now))) {
    const l = r.listing || {}, key = homeKey(l);
    if (!homes.has(key)) homes.set(key, { key, mls: new Set(), entries: [] });
    const h = homes.get(key);
    h.mls.add(r.mls);
    h.entries.push(r);
  }
  return [...homes.values()].map((h) => {
    const entries = h.entries.sort((a, b) => b.iso.localeCompare(a.iso) || b.from - a.from);
    const sent = entries.filter((r) => r.feedback).map((r) => r.feedback);
    const l = entries[0].listing || {}; // the newest open house has the freshest address and photo
    return {
      key: h.key, addr: l.addr, city: l.city, zip: l.zip, img: entries.find((r) => r.listing?.img)?.listing.img || null,
      mls: [...h.mls], hosted: entries.length, withFeedback: sent.length,
      visitors: sent.reduce((n, f) => n + f.visitors, 0),
      interest: Object.fromEntries(Object.keys(INTEREST).map((k) => [k, sent.filter((f) => f.interest === k).length])),
      flags: sent.filter((f) => f.brokerFlag).length, lastIso: entries[0].iso,
      openHouses: entries.map((r) => ({ id: r.id, mls: r.mls, iso: r.iso, from: r.from, to: r.to,
        agent: { name: r.agent.name, email: r.agent.email }, feedback: r.feedback || null })),
    };
  }).sort((a, b) => Number(b.flags > 0) - Number(a.flags > 0) || b.lastIso.localeCompare(a.lastIso));
}
