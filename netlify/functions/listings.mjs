import { json, currentUser } from "../lib/shared.mjs";
import { WEEK, LISTINGS, publicListing } from "../lib/listings.mjs";
import { listRequests, closed } from "../lib/requests.mjs";

export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  const all = await listRequests();
  const live = (r) => r.status === "pending" || r.status === "approved";
  const listings = LISTINGS.map((l) => ({
    ...publicListing(l),
    // Hours already locked by someone else's approved request.
    taken: all.filter((r) => r.mls === l.mls && r.status === "approved" && r.agent.email !== user.email).map(({ day, from, to }) => ({ day, from, to })),
    // This agent's own requests for the listing.
    mine: all.filter((r) => r.mls === l.mls && r.agent.email === user.email && live(r)).map(({ id, day, from, to, status }) => ({ id, day, from, to, status })),
  }));
  return json(200, { week: WEEK.days, firstHour: WEEK.firstHour, lastHour: WEEK.lastHour, closesLabel: WEEK.closesLabel, closed: closed(), listings });
};
export const config = { path: "/api/listings" };
