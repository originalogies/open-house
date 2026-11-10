import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { chicagoToUtc } from "./time.mjs";
import { addressKey, photoType } from "./homes.mjs";

// Feedback from the agent after hosting an open house. Stored on the request as r.feedback:
// { at, visitors, interest, price, liked, disliked, forSeller, teamNotes, brokerFlag, photos }. `visitors` is the
// number of groups that came (the forms and pages call it Groups; feedback sent before Nov 10, 2026 asked for
// guests), and `interest` their Level of Interest.
// The guest feedback (liked, disliked, price, forSeller) is written to help the seller and the team
// sell the home. Feedback sent before those questions existed has `happened` in their place.
// Only the George & Noonan team and the agent who hosted see it.

const HOUR = 60 * 60 * 1000;
export const INTEREST = { lots: "Lots", some: "Some", little: "Little" };
export const PRICE = { high: "Too high", right: "About right", value: "Good value", none: "Didn't come up" };
// Who to call when something serious happens at an open house.
export const BROKER = { name: "London George", phone: "(817) 995-8080" };
const MAX_TEXT = 5000;
export const MAX_FEEDBACK_PHOTOS = 10;
export const MAX_FEEDBACK_PHOTO_BYTES = 3 * 1024 * 1024; // the page shrinks photos to about 1600px before upload

export const endMs = (r) => chicagoToUtc(r.iso, r.to).getTime();

// The hourly job runs on the hour, when open houses end. It counts an open house as ended from a few minutes
// before, so a run that starts a moment early still sends the feedback email at the end rather than an hour later,
// and the form opens as early so the link in that email works.
const EARLY = 5 * 60 * 1000;

// The agent can leave feedback once an approved open house has ended.
export const feedbackOpen = (r, now = Date.now()) => r.status === "approved" && now >= endMs(r) - EARLY;

// What the hourly job owes this request: "ask" when it ends, one "remind" 3 hours after it ends if there's still
// no feedback (and at least 2 hours after the ask, should the ask go out late), or nothing. Nothing is sent about
// open houses that ended more than 3 days ago, so agents aren't emailed about old open houses.
const REMIND_AFTER = 3 * HOUR;
export function feedbackStep(r, now = Date.now()) {
  if (!feedbackOpen(r, now) || r.feedback || now >= endMs(r) + 3 * 24 * HOUR) return null;
  if (!r.feedbackAskedAt) return "ask";
  if (!r.feedbackRemindedAt && now >= endMs(r) + REMIND_AFTER - EARLY && now >= r.feedbackAskedAt + 2 * HOUR) return "remind";
  return null;
}

// The team emails the agent a reminder to send feedback (the Admin Console, on a home's page). Returns why it
// can't be sent, or null. A few minutes must pass between reminders, so a double press sends one email.
// Each reminder is kept on the request as r.feedbackReminders: [{ at, by, byName }].
export const REMIND_GAP = 5 * 60 * 1000;
export function checkFeedbackReminder(r, now = Date.now()) {
  const first = (r.agent?.name || "the agent").split(" ")[0];
  if (r.feedback) return `${first} already sent feedback for this open house.`;
  if (!feedbackOpen(r, now)) return r.status === "approved" ? "The open house hasn't ended yet." : "This open house didn't take place.";
  const last = (r.feedbackReminders || []).at(-1);
  if (last && now - last.at < REMIND_GAP) return `A reminder already went to ${first} a few minutes ago.`;
  return null;
}

// Checks and cleans what the agent sent. `photos` are the ids already uploaded for this open house
// (the server's list, not the browser's). Returns { error } or { feedback }.
export function cleanFeedback(b, now = Date.now(), photos = []) {
  const text = (v) => String(v ?? "").replace(/\r\n/g, "\n").trim();
  const visitors = Number(b?.visitors);
  if (b?.visitors === "" || b?.visitors == null || !Number.isInteger(visitors) || visitors < 0 || visitors > 999) return { error: "Enter how many groups came (0 if none did)." };
  if (!INTEREST[b.interest]) return { error: "Pick the level of interest." };
  if (!PRICE[b.price]) return { error: "Pick what guests thought of the price (\"Didn't come up\" if nobody said)." };
  const liked = text(b.liked), disliked = text(b.disliked), forSeller = text(b.forSeller), teamNotes = text(b.teamNotes);
  // With visitors, the seller needs to hear what they said. An empty open house has nothing to report.
  if (visitors > 0 && !liked && !disliked) return { error: "Tell us what guests liked or didn't like about the home." };
  if ([liked, disliked, forSeller, teamNotes].some((t) => t.length > MAX_TEXT)) return { error: "That's too long. Keep each box under 5,000 characters." };
  const brokerFlag = b.brokerFlag === true;
  if (brokerFlag && !teamNotes) return { error: "Describe what the broker needs to know in the notes for the team." };
  return { feedback: { at: now, visitors, interest: b.interest, price: b.price, liked, disliked, forSeller, teamNotes, brokerFlag, photos: photos.slice(0, MAX_FEEDBACK_PHOTOS) } };
}

// ---- feedback photos ------------------------------------------------------------
// Photos the agent adds to their notes: JPEG or PNG, stored per open house under a random id.
// Private: only the agent who hosted and the team can see them (/api/feedback-photo). While the
// agent is still filling in the form, the ids wait on the request as r.feedbackPhotos.
const photoStore = () => getStore("open-house-feedback-photos");
export const isPhotoId = (p) => /^[a-f0-9]{12}$/.test(String(p || ""));
export async function saveFeedbackPhoto(reqId, data) {
  const buf = Buffer.from(String(data || "").replace(/^data:[^,]*,/, ""), "base64");
  const type = photoType(buf);
  if (!buf.length || buf.length > MAX_FEEDBACK_PHOTO_BYTES || !type) return { error: "Use a JPEG or PNG photo under 3 MB." };
  const p = crypto.randomBytes(6).toString("hex");
  await photoStore().set(`photo/${reqId}/${p}`, buf, { metadata: { type } });
  return { photo: p };
}
export const getFeedbackPhoto = (reqId, p) => (isPhotoId(p) ? photoStore().getWithMetadata(`photo/${reqId}/${p}`, { type: "arrayBuffer" }) : null);
export const deleteFeedbackPhoto = (reqId, p) => photoStore().delete(`photo/${reqId}/${p}`);
export const feedbackPhotoUrl = (reqId, p) => `/api/feedback-photo?id=${reqId}&p=${p}`;

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
      price: Object.fromEntries(Object.keys(PRICE).map((k) => [k, sent.filter((f) => f.price === k).length])),
      flags: sent.filter((f) => f.brokerFlag).length, lastIso: entries[0].iso,
      openHouses: entries.map((r) => ({ id: r.id, mls: r.mls, iso: r.iso, from: r.from, to: r.to,
        agent: { name: r.agent.name, email: r.agent.email }, feedback: r.feedback ? withPhotoUrls(r) : null,
        // Whether the agent was emailed a feedback link. History imported from the calendar or added by hand never is.
        emailed: !!r.feedbackAskedAt && !r.imported,
        // Reminders the team sent from the Admin Console: how many, and the latest.
        reminders: (r.feedbackReminders || []).length,
        reminded: (r.feedbackReminders || []).length ? { at: r.feedbackReminders.at(-1).at, byName: r.feedbackReminders.at(-1).byName } : null })),
    };
  }).sort((a, b) => Number(b.flags > 0) - Number(a.flags > 0) || b.lastIso.localeCompare(a.lastIso));
}

// Which homes from feedbackByHome are on the market now (currentHomes in listings.mjs): the same address, even
// relisted under a new MLS number, or one of its MLS numbers. The rest are past homes: sold, expired or withdrawn.
export const markActive = (homes, current) => homes.map((h) => ({ ...h, active: current.keys.has(h.key) || h.mls.some((m) => current.mls.has(m)) }));

// The feedback as the pages show it: photo ids become links (team and the hosting agent only).
export const withPhotoUrls = (r) => ({ ...r.feedback, photos: (r.feedback.photos || []).map((p) => feedbackPhotoUrl(r.id, p)) });
