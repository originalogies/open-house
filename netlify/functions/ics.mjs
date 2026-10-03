import { getRequest } from "../lib/requests.mjs";
import { ics } from "../lib/email.mjs";

// Calendar link from the Confirmed email. The id is an unguessable 128-bit token and the file
// contains only the address and time, no access details.
export default async (req) => {
  const r = await getRequest(new URL(req.url).searchParams.get("id") || "");
  if (!r || r.status !== "approved") return new Response("Not found", { status: 404 });
  return new Response(ics(r), { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="open-house.ics"' } });
};
export const config = { path: "/api/ics" };
