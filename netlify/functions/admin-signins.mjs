import { json, currentUser } from "../lib/shared.mjs";
import { listSignIns, KEEP_DAYS } from "../lib/signins.mjs";

// GET /api/admin/signins -> { signins: [{ at, result, email, name, device, page }], keepDays }, newest first: each time
// someone signed in, was turned away or signed out (signins.mjs). For the Admin Console's Sign-ins page. Admins only.
export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.admin) return json(403, { error: "admin_only" });
  return json(200, { signins: await listSignIns(), keepDays: KEEP_DAYS });
};
export const config = { path: "/api/admin/signins" };
