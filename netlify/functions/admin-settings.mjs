import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { getCutoff, saveCutoff } from "../lib/settings.mjs";
import { getWeek, normalizeCutoff } from "../lib/week.mjs";

// Admin-only settings. Cutoff: { enabled, day: 0-6 (0 = Sunday), time: "HH:MM" Central }.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.admin) return json(403, { error: "admin_only" });

  const summary = (cutoff) => {
    const w = getWeek(new Date(), cutoff);
    return { weekend: `${w.days.sat.date} and ${w.days.sun.date}`, closesLabel: w.closesLabel };
  };

  if (req.method === "GET") {
    const cutoff = await getCutoff();
    return json(200, { cutoff, ...summary(cutoff) });
  }
  if (req.method === "PUT") {
    if (!sameOrigin(req)) return json(403, { error: "bad_origin" });
    const b = await req.json().catch(() => null);
    const cutoff = normalizeCutoff(b);
    if (!cutoff) return json(400, { error: "invalid_cutoff", message: "Pick a day and a time." });
    await saveCutoff(cutoff);
    return json(200, { ok: true, cutoff, ...summary(cutoff) });
  }
  return json(405, { error: "method_not_allowed" });
};
export const config = { path: "/api/admin/settings" };
