import { json, currentUser } from "../lib/shared.mjs";
import { listRequests } from "../lib/requests.mjs";
import { dayMeta } from "../lib/week.mjs";
import { fmtRange } from "../lib/time.mjs";
import { feedbackByHome } from "../lib/feedback.mjs";

// GET /api/team/feedback -> every home that's hosted an open house, with each open house and the
// agent's feedback, for the Admin Console's Feedback tab. Team only. Access details are never included.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.team) return json(403, { error: "team_only" });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const homes = feedbackByHome(await listRequests()).map((h) => ({
    ...h,
    openHouses: h.openHouses.map((o) => ({ ...o, day: dayMeta(o.iso).label, date: dayMeta(o.iso).date, time: fmtRange(o.from, o.to) })),
  }));
  return json(200, { homes });
};
export const config = { path: "/api/team/feedback" };
