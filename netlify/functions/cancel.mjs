import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { getRequest } from "../lib/requests.mjs";
import { cancelRequest } from "../lib/actions.mjs";

// POST /api/requests/cancel { id }
// Agents cancel their own pending or approved request, any time before it starts (the weekly
// cutoff does not apply). Time changes go through the George & Noonan team.
export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  const b = await req.json().catch(() => null);
  const r = b && (await getRequest(String(b.id || "")));
  // Agents only see their own requests; anyone else's id looks like it doesn't exist.
  if (!r || (r.agent.email !== user.email && !user.team)) return json(404, { error: "not_found" });
  const { status, ...body } = await cancelRequest(r, user);
  return json(status, body);
};
export const config = { path: "/api/requests/cancel" };
