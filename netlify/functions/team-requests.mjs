import { json, currentUser } from "../lib/shared.mjs";
import { listRequests } from "../lib/requests.mjs";
import { dayMeta } from "../lib/week.mjs";
import { fmtRange } from "../lib/time.mjs";

// GET /api/team/requests -> every request, newest first, for the team console.
// Approve and decline still go through POST /api/respond. Access details are never included.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.team) return json(403, { error: "team_only" });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const all = await listRequests();
  const requests = all.sort((a, b) => b.createdAt - a.createdAt).map((r) => {
    const d = dayMeta(r.iso), l = r.listing || {};
    return {
      id: r.id, status: r.status, mls: r.mls, iso: r.iso, from: r.from, to: r.to,
      addr: l.addr, city: l.city, img: l.img || null,
      day: d.label, date: d.date, time: fmtRange(r.from, r.to),
      agent: { name: r.agent.name, email: r.agent.email }, phone: r.phone, notes: r.notes,
      createdAt: r.createdAt, decidedAt: r.decidedAt || null, decidedBy: r.decidedByName || null,
    };
  });
  return json(200, { requests });
};
export const config = { path: "/api/team/requests" };
