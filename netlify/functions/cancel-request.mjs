import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { getRequest } from "../lib/requests.mjs";
import { requestCancellation } from "../lib/actions.mjs";

// POST /api/requests/cancel-request { id, reason? }
// Agents can't cancel on their own. They ask, any time before the open house starts (the weekly
// cutoff does not apply), and the George & Noonan team approves the cancellation or keeps it.
// Time changes also go through the team.
export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  const b = await req.json().catch(() => null);
  const r = b && (await getRequest(String(b.id || "")));
  // Agents only see their own requests; anyone else's id looks like it doesn't exist.
  if (!r || r.agent.email !== user.email) return json(404, { error: "not_found" });
  const { status, ...body } = await requestCancellation(r, user, b.reason);
  return json(status, body);
};
export const config = { path: "/api/requests/cancel-request" };
