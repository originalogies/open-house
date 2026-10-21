import { currentUser } from "../lib/shared.mjs";
import { getRequest, isTeam } from "../lib/requests.mjs";
import { getScreenshot } from "../lib/mls.mjs";

// GET /api/mls/screenshot?id=<request id>  -> the bot's latest confirmation screenshot (team only).
export default async (req) => {
  const user = await currentUser(req);
  if (!user || !isTeam(user.email)) return new Response("Not found", { status: 404 });
  const r = await getRequest(new URL(req.url).searchParams.get("id") || "");
  const key = r?.sync?.job?.screenshot;
  if (!key) return new Response("Not found", { status: 404 });
  const shot = await getScreenshot(key);
  if (!shot) return new Response("Not found", { status: 404 });
  return new Response(shot.data, { headers: { "content-type": shot.metadata?.type || "image/png", "cache-control": "private, no-store" } });
};
export const config = { path: "/api/mls/screenshot" };
