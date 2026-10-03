import { json, currentUser } from "../lib/shared.mjs";
import { troyListings, listingDetail, feedUpdatedOn, TROY_AGENT_ID } from "../lib/listings.mjs";

// Admin-only test of the Repliers data pull. GET lists Troy George's active and inactive
// (status U) listings, so an empty "active" result can be diagnosed. GET ?mls=NNN returns the full raw Repliers record for one listing.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.admin) return json(403, { error: "admin_only" });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const mls = new URL(req.url).searchParams.get("mls");
  try {
    if (mls) {
      if (!/^[A-Za-z0-9]+$/.test(mls)) return json(400, { error: "invalid_request" });
      return json(200, { listing: await listingDetail(mls) });
    }
    const listings = await troyListings();
    return json(200, { agent: "Troy George", agentId: TROY_AGENT_ID, count: listings.length, feedUpdatedOn: await feedUpdatedOn().catch(() => null), listings });
  } catch (e) { console.error(e.message); return json(502, { error: "listings_unavailable", message: e.message.slice(0, 200) }); }
};
export const config = { path: "/api/admin/listings" };
