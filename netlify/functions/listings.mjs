import { json, currentUser } from "../lib/shared.mjs";
import { offeredListings, publicListing } from "../lib/listings.mjs";
import { listRequests, holdsSlot } from "../lib/requests.mjs";
import { currentWeek } from "../lib/settings.mjs";
import { openCancelRequest } from "../lib/changes.mjs";

export default async (req) => {
  // Independent reads run together; the requests are read while the listings load.
  const [user, week] = await Promise.all([currentUser(req), currentWeek()]);
  if (!user) return json(401, { error: "signed_out" });
  if (user.mustSign) return json(403, { error: "agreement_required" }); // not until they sign the agreement
  const requests = listRequests();
  let offered;
  try { offered = await offeredListings(week); }
  catch (e) { console.error(e.message); requests.catch(() => {}); return json(502, { error: "listings_unavailable" }); }

  const all = (await requests).filter((r) => Object.values(week.days).some((d) => d.iso === r.iso));
  const live = (r) => r.status === "pending" || r.status === "approved";
  const dayKey = (iso) => Object.keys(week.days).find((k) => week.days[k].iso === iso);
  const listings = offered.map((l) => ({
    ...publicListing(l),
    // Hours locked by someone else's approved request, or already on the MLS.
    taken: [
      ...all.filter((r) => r.mls === l.mls && holdsSlot(r) && r.agent.email !== user.email).map((r) => ({ day: dayKey(r.iso), from: r.from, to: r.to })),
      ...l.external,
    ],
    mine: all.filter((r) => r.mls === l.mls && r.agent.email === user.email && live(r)).map((r) => ({ id: r.id, day: dayKey(r.iso), from: r.from, to: r.to, status: r.status, cancelRequested: openCancelRequest(r) })),
  }));
  return json(200, { week: { sat: week.days.sat, sun: week.days.sun }, firstHour: week.firstHour, lastHour: week.lastHour, closesLabel: week.closesLabel, cutoffEnabled: week.cutoffEnabled, closed: false, listings });
};
export const config = { path: "/api/listings" };
