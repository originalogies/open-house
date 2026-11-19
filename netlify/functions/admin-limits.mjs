import { json, currentUser, normalizeEmail, sameOrigin } from "../lib/shared.mjs";
import { parseLimit, setLimit } from "../lib/limits.mjs";

// PUT /api/admin/limits { email, limit } -> sets one agent's listing limit (whole dollars); a blank limit clears it.
// Admins only, from the Agents page. Returns every limit.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.admin) return json(403, { error: "admin_only" });
  if (req.method !== "PUT") return json(405, { error: "method_not_allowed" });
  if (!sameOrigin(req)) return json(403, { error: "bad_origin" });
  const b = await req.json().catch(() => null);
  const email = normalizeEmail(b?.email), limit = parseLimit(b?.limit);
  if (!email || limit === undefined) return json(400, { error: "invalid_limit", message: "Enter a dollar amount, like 750,000, or leave it blank for no limit." });
  return json(200, { ok: true, email, limit, limits: await setLimit(email, limit) });
};
export const config = { path: "/api/admin/limits" };
