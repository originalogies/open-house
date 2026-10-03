import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { teamListings, getInfo, saveInfo, rawSample, probe } from "../lib/listings.mjs";
import { getWeek } from "../lib/week.mjs";

// Inventory page API. GET lists every active listing for the two agents with the team's settings.
// PUT { mls, offered, days, instr[], access } saves one listing. GET ?raw=1 shows one raw Repliers
// listing (no description) for checking field mapping.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.team) return json(403, { error: "team_only" });
  const week = getWeek();

  if (req.method === "GET") {
    try {
      if (new URL(req.url).searchParams.get("raw")) return json(200, { sample: await rawSample(), probe: await probe() });
      return json(200, { week: { sat: week.days.sat, sun: week.days.sun }, closesLabel: week.closesLabel, ...(await teamListings(week)) });
    } catch (e) { console.error(e.message); return json(502, { error: "listings_unavailable", message: e.message.slice(0, 200) }); }
  }

  if (req.method === "PUT") {
    if (!sameOrigin(req)) return json(403, { error: "bad_origin" });
    const b = await req.json().catch(() => null);
    if (!b || !/^[A-Za-z0-9]+$/.test(String(b.mls || ""))) return json(400, { error: "invalid_request" });
    const cur = await getInfo(b.mls);
    const days = (Array.isArray(b.days) ? b.days : cur.days).filter((d) => d === "sat" || d === "sun");
    const instr = (Array.isArray(b.instr) ? b.instr : cur.instr).map((s) => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, 15);
    const access = String(b.access ?? cur.access).slice(0, 500);
    const priorityWeek = b.priority === true ? week.satIso : b.priority === false ? null : cur.priorityWeek;
    const offeredWeek = b.offered === true ? week.satIso : b.offered === false ? null : cur.offeredWeek;
    if (offeredWeek && !days.length) return json(400, { error: "no_days", message: "Pick at least one day to offer." });
    await saveInfo(b.mls, { offeredWeek, priorityWeek, days, instr, access });
    return json(200, { ok: true });
  }
  return json(405, { error: "method_not_allowed" });
};
export const config = { path: "/api/inventory/listings" };
