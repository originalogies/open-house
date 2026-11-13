import { json, currentUser } from "../lib/shared.mjs";
import { listRequests, holdsSlot } from "../lib/requests.mjs";
import { dayMeta } from "../lib/week.mjs";
import { fmtRange } from "../lib/time.mjs";
import { mode, agentReady, byHand } from "../lib/mls.mjs";
import { openCancelRequest } from "../lib/changes.mjs";
import { isMlsNumber } from "../lib/homes.mjs";
import { feedbackOpen, withPhotoUrls, homeKey } from "../lib/feedback.mjs";

// GET /api/team/requests -> every request, newest first, for the Admin Console, with its MLS status
// any open cancellation request from the agent, and the agent's feedback after hosting. Approve and decline go through POST /api/respond;
// cancel and keep go through POST /api/manage. Access details are never included.
export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const [user, all] = await Promise.all([currentUser(req), listRequests()]); // read together
  if (!user) return json(401, { error: "signed_out" });
  if (!user.team) return json(403, { error: "team_only" });

  all.sort((a, b) => b.createdAt - a.createdAt);
  // Each home's newest photo, for requests that saved none (history imported from the G&N calendar), matched by
  // address like the Feedback tab.
  const photos = new Map();
  for (const r of all) if (r.listing?.img && !photos.has(homeKey(r.listing))) photos.set(homeKey(r.listing), r.listing.img);
  const requests = all.map((r) => {
    const d = dayMeta(r.iso), l = r.listing || {};
    return {
      id: r.id, status: r.status, mls: r.mls, iso: r.iso, from: r.from, to: r.to,
      addr: l.addr, city: l.city, img: l.img || photos.get(homeKey(l)) || null,
      day: d.label, date: d.date, time: fmtRange(r.from, r.to),
      agent: { name: r.agent.name, email: r.agent.email }, phone: r.phone, notes: r.notes,
      createdAt: r.createdAt, decidedAt: r.decidedAt || null, decidedBy: r.decidedByName || null,
      cancelledBy: r.cancelledByName || null, imported: !!r.imported, // from the G&N calendar, not requested here
      approving: !!r.approving, // waiting for the AI agent to put it on the MLS before it's approved
      addedBy: r.addedBy?.name || null, // the team added it for the agent ("Add a request")
      holds: holdsSlot(r), // its hours are spoken for: nobody else can book or be approved for them
      mlsState: r.sync?.state || null, onMls: isMlsNumber(r.mls), byHand: byHand(r),
      cancelRequest: openCancelRequest(r) ? { at: r.cancelRequest.at, reason: r.cancelRequest.reason || "" } : null,
      feedback: r.feedback ? withPhotoUrls(r) : null, feedbackDue: !r.feedback && feedbackOpen(r),
    };
  });
  return json(200, { requests, mode: mode(), agentReady: agentReady() });
};
export const config = { path: "/api/team/requests" };
