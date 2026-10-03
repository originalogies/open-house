import { json, currentUser } from "../lib/shared.mjs";
import { offeredListings, publicListing } from "../lib/listings.mjs";
import { listRequests } from "../lib/requests.mjs";
import { currentWeek } from "../lib/settings.mjs";

export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  const week = await currentWeek();
  let offered;
  try { offered = await offeredListings(week); }
  catch (e) { console.error(e.message); return json(502, { error: "listings_unavailable" }); }

  const all = (await listRequests()).filter((r) => Object.values(week.days).some((d) => d.iso === r.iso));
  const live = (r) => r.status === "pending" || r.status === "approved";
  const dayKey = (iso) => Object.keys(week.days).find((k) => week.days[k].iso === iso);
  const listings = offered.map((l) => ({
    ...publicListing(l),
    // Hours locked by someone else's approved request, or already on the MLS.
    taken: [
      ...all.filter((r) => r.mls === l.mls && r.status === "approved" && r.agent.email !== user.email).map((r) => ({ day: dayKey(r.iso), from: r.from, to: r.to })),
      ...l.external,
    ],
    mine: all.filter((r) => r.mls === l.mls && r.agent.email === user.email && live(r)).map((r) => ({ id: r.id, day: dayKey(r.iso), from: r.from, to: r.to, status: r.status })),
  }));
  return json(200, { week: { sat: week.days.sat, sun: week.days.sun }, firstHour: week.firstHour, lastHour: week.lastHour, closesLabel: week.closesLabel, cutoffEnabled: week.cutoffEnabled, closed: false, listings });
};
export const config = { path: "/api/listings" };
