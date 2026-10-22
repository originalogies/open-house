import { currentUser } from "../lib/shared.mjs";
import { getRequest } from "../lib/requests.mjs";
import { getFeedbackPhoto } from "../lib/feedback.mjs";

// GET /api/feedback-photo?id=<request id>&p=<photo id> -> a photo the agent added to their feedback.
// Private: only the agent who hosted and the George & Noonan team. Photo ids are never reused.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const r = await getRequest(String(u.searchParams.get("id") || ""));
  if (!r || (!user.team && r.agent.email !== user.email)) return new Response("Not found", { status: 404 });
  const photo = await Promise.resolve(getFeedbackPhoto(r.id, u.searchParams.get("p"))).catch(() => null);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(photo.data, { headers: { "content-type": photo.metadata?.type || "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
};
export const config = { path: "/api/feedback-photo" };
