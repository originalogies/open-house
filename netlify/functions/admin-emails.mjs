import { json, currentUser } from "../lib/shared.mjs";
import { emailPreviews } from "../lib/email-previews.mjs";

// GET /api/admin/emails -> every email the platform sends, built from a sample open house, for Settings > Emails.
// Admin only, like the rest of Settings. Nothing is sent.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.admin) return json(403, { error: "admin_only" });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  return json(200, await emailPreviews(user.name));
};
export const config = { path: "/api/admin/emails" };
