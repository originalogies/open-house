import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { getRequest, saveRequest } from "../lib/requests.mjs";
import { sendFeedbackToTeam } from "../lib/email.mjs";
import { feedbackOpen, cleanFeedback, endMs, withPhotoUrls, feedbackPhotoUrl, saveFeedbackPhoto, deleteFeedbackPhoto, MAX_FEEDBACK_PHOTOS, PRACTICE_ID, isPractice } from "../lib/feedback.mjs";
import { sampleOpenHouse } from "../lib/email-previews.mjs";
import { dayMeta } from "../lib/week.mjs";
import { fmtRange, chicagoNow } from "../lib/time.mjs";
import { openCancelRequest } from "../lib/changes.mjs";
import { textTeamFeedback } from "../lib/texts.mjs";

// GET  /api/feedback?id=...                     the open house (status, who approved it, the agent's request notes),
//                                               any feedback already sent, and photos added to the form so far
// POST /api/feedback { id, visitors, interest, price, liked, disliked, forSeller, teamNotes, brokerFlag }
// POST /api/feedback { id, action: "photo", data }      add a JPEG or PNG to the form -> { photos }
// POST /api/feedback { id, action: "unphoto", photo }   take one off again           -> { photos }
// Only the agent who hosted can see or send it, once, after the open house ends. The team is emailed, and it goes out as a
// group text to the agent, Troy, Lucy and London (texts.mjs).
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  const isPost = req.method === "POST";
  if (isPost && !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  if (!isPost && req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const b = isPost ? await req.json().catch(() => null) : { id: new URL(req.url).searchParams.get("id") };
  if (b && isPractice(b.id)) return practice(isPost, b);
  const r =b && (await getRequest(String(b.id || "")));
  // Agents only see their own open houses; anyone else's id looks like it doesn't exist.
  if (!r || r.agent.email !== user.email) return json(404, { error: "not_found" });
  const pending = () => (r.feedbackPhotos || []).map((p) => ({ id: p, url: feedbackPhotoUrl(r.id, p) }));

  if (!isPost) {
    const d = dayMeta(r.iso), l = r.listing || {};
    return json(200, {
      id: r.id, addr: l.addr, city: l.city, img: l.img || null, day: d.label, date: d.date, time: fmtRange(r.from, r.to),
      open: feedbackOpen(r), status: r.status, endsAt: endMs(r), feedback: r.feedback ? withPhotoUrls(r) : null,
      iso: r.iso, decidedBy: r.decidedByName || null, notes: r.notes || "", cancelRequested: openCancelRequest(r),
      photos: r.feedback ? [] : pending(),
    });
  }
  if (r.feedback) return json(409, { error: "already_sent", message: "You already sent feedback for this open house." });
  if (!feedbackOpen(r)) return json(409, { error: "not_open", message: r.status === "approved" ? "You can leave feedback once the open house ends." : "This open house didn't take place." });

  if (b.action === "photo") {
    if ((r.feedbackPhotos || []).length >= MAX_FEEDBACK_PHOTOS) return json(400, { error: "too_many_photos", message: `You can add up to ${MAX_FEEDBACK_PHOTOS} photos.` });
    const { photo, error } = await saveFeedbackPhoto(r.id, b.data);
    if (error) return json(400, { error: "invalid_photo", message: error });
    r.feedbackPhotos = [...(r.feedbackPhotos || []), photo];
    await saveRequest(r);
    return json(200, { photos: pending() });
  }
  if (b.action === "unphoto") {
    if (!(r.feedbackPhotos || []).includes(b.photo)) return json(404, { error: "no_photo" });
    r.feedbackPhotos = r.feedbackPhotos.filter((p) => p !== b.photo);
    await saveRequest(r);
    await deleteFeedbackPhoto(r.id, b.photo).catch(() => {});
    return json(200, { photos: pending() });
  }

  const { error, feedback } = cleanFeedback(b, Date.now(), r.feedbackPhotos || []);
  if (error) return json(400, { error: "invalid", message: error });
  r.feedback = feedback;
  delete r.feedbackPhotos;
  await saveRequest(r);
  await textTeamFeedback(r); // a group text to the agent, Troy, Lucy and London; never throws
  try { await sendFeedbackToTeam(r); }
  catch (e) {
    console.error("feedback email failed", r.id, e.message);
    return json(502, { error: "email_failed", message: "Your feedback was saved, but the email to the team didn't send. They'll still see it in the Admin Console." });
  }
  return json(200, { ok: true });
};
// The practice form (PRACTICE_ID in lib/feedback.mjs): the sample home, hosted 1 to 3 PM today, for anyone signed in.
// What they send is checked like real feedback, then thrown away: nothing is saved and no one is emailed.
async function practice(isPost, b) {
  if (!isPost) {
    const { listing: l } = await sampleOpenHouse();
    const d = dayMeta(chicagoNow().date);
    return json(200, {
      id: PRACTICE_ID, practice: true, addr: l.addr, city: l.city, img: l.img || null, day: d.label, date: d.date, time: fmtRange(13, 15),
      open: true, status: "approved", endsAt: 0, feedback: null, iso: d.iso, decidedBy: null, notes: "", cancelRequested: false, photos: [],
    });
  }
  if (b.action === "photo" || b.action === "unphoto") return json(400, { error: "practice", message: "Photos can't be added on the practice form. On a real one, they upload as you add them." });
  const { error } = cleanFeedback(b, Date.now(), []);
  if (error) return json(400, { error: "invalid", message: error });
  return json(200, { ok: true, practice: true });
}
export const config = { path: "/api/feedback" };
