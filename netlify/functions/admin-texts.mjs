import { getStore } from "@netlify/blobs";
import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { sampleOpenHouse } from "../lib/email-previews.mjs";
import { TEXTS, QUO_FROM, textsOn, fmtPhone, getRoster, rosterMatch, sendText } from "../lib/texts.mjs";

// GET  /api/admin/texts -> Settings > Texts: whether texts are on, the Quo number they come from, the agent roster
//      (how many agents and when it was loaded, not their numbers), the signed-in admin's own roster number, and
//      each text as it reads for a sample open house. Admin only, like the rest of Settings.
// POST /api/admin/texts { action: "test" } -> texts those samples to the signed-in admin's own roster number, so
//      the team can see they arrive (Quo key, carrier registration). At most once a minute.
const WHEN = {
  reminder: "9:00 AM the day before, with the Reminder email.",
  feedbackAsk: "As the open house ends, with the Feedback request email.",
  feedbackRemind: "3 hours after it ends if there's still no feedback, with the Feedback reminder email.",
};
const NAME = { reminder: "Reminder", feedbackAsk: "Feedback request", feedbackRemind: "Feedback reminder" };
const TEST_GAP = 60 * 1000;

export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.admin) return json(403, { error: "admin_only" });
  const [roster, { sample }] = await Promise.all([getRoster(), sampleOpenHouse(user.name)]);
  const me = rosterMatch(roster, user);
  const texts = Object.keys(TEXTS).map((key) => ({ key, name: NAME[key], when: WHEN[key], body: TEXTS[key].body(sample()) }));

  if (req.method === "GET") {
    return json(200, {
      on: textsOn(), from: fmtPhone(QUO_FROM), texts, me: me ? { name: me.name, phone: fmtPhone(me.phone) } : null,
      roster: { count: roster.agents.length, updatedAt: roster.updatedAt || null, source: roster.source || "" },
    });
  }
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const b = await req.json().catch(() => null);
  if (b?.action !== "test") return json(400, { error: "invalid_action" });
  if (!textsOn()) return json(409, { error: "off", message: "Texts are off. Add QUO_API_KEY in Netlify first." });
  if (!me) return json(409, { error: "no_number", message: "You're not on the agent roster, so there's no number to text." });
  const store = getStore({ name: "open-house-agents", consistency: "strong" });
  const last = await store.get("test", { type: "json" }).catch(() => null);
  if (last && Date.now() - last.at < TEST_GAP) return json(429, { error: "too_soon", message: "Test texts just went out. Give them a minute." });
  await store.setJSON("test", { at: Date.now(), by: user.email });
  try {
    for (const t of texts) await sendText(me.phone, t.body);
  } catch (e) {
    console.error("test text failed", e.message);
    return json(502, { error: "text_failed", message: `Quo didn't send it: ${e.message.replace(/^Quo /, "")}.` });
  }
  return json(200, { ok: true, sent: texts.length, to: fmtPhone(me.phone) });
};
export const config = { path: "/api/admin/texts" };
