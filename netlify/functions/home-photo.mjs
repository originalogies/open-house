import { getPhoto } from "../lib/homes.mjs";

// GET /api/home-photo?id=<home id>&p=<photo id> -> a photo of a team-added home. Public like MLS
// photos, because the agent portal and emails both show it. Photo ids are random and never reused,
// so the response can be cached for good.
export default async (req) => {
  const u = new URL(req.url);
  const photo = await Promise.resolve(getPhoto(u.searchParams.get("id"), u.searchParams.get("p"))).catch(() => null);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(photo.data, { headers: { "content-type": photo.metadata?.type || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
};
export const config = { path: "/api/home-photo" };
