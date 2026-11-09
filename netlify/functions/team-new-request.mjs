import { json, currentUser, sameOrigin, normalizeEmail } from "../lib/shared.mjs";
import { bookableHomes, snapshot } from "../lib/listings.mjs";
import { listRequests, saveRequest, newId, knownAgents } from "../lib/requests.mjs";
import { listAgreements } from "../lib/agreement.mjs";
import { approveRequest } from "../lib/actions.mjs";
import { checkTeamAdd, dayKeyOf } from "../lib/changes.mjs";
import { upcomingDays, FIRST_HOUR, LAST_HOUR } from "../lib/week.mjs";
import { chicagoNow } from "../lib/time.mjs";
import { currentWeek } from "../lib/settings.mjs";
import { mode, agentReady, logEvent } from "../lib/mls.mjs";
import { siteFor } from "../lib/email.mjs";

// The team adds an open house request for an agent (the Admin Console's "Add a request" on Requests), usually
// one they already know is approved.
// GET  /api/team/new-request -> what the form offers: who can host, the homes, the next weekends' days.
// POST /api/team/new-request { agent: { email, name }, mls, iso, from, to, notes, autoApprove, method, sendEmails }
// autoApprove: approved now, like the Approve button (approveRequest): the agent and team get the Confirmed email
// and calendar invite, unless sendEmails is false (then nobody is emailed, now or when the AI agent finishes).
// A home on the MLS needs method "manual" (entered on the MLS by hand) or "agent" (the AI agent enters it;
// approved once it's on the MLS). Otherwise it waits under "Waiting for a decision" and nobody is emailed; approving
// it later from Review emails as usual.
// Either way its hours are held from the start (holdsSlot), so no one else can book them.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.team) return json(403, { error: "team_only" });
  const week = await currentWeek();

  if (req.method === "GET") {
    const [{ homes, warning }, all, agreements] = await Promise.all([bookableHomes(week), listRequests(), listAgreements().catch(() => [])]);
    return json(200, {
      agents: knownAgents(all, agreements).map(({ email, name }) => ({ email, name })),
      homes: homes.map((h) => ({ mls: h.mls, addr: h.addr, city: h.city, img: h.img, teamAdded: !!h.teamAdded, offered: h.offered, days: h.days, mlsOpenHouses: h.mlsOpenHouses })),
      days: upcomingDays(), today: chicagoNow(), firstHour: FIRST_HOUR, lastHour: LAST_HOUR, mode: mode(), agentReady: agentReady(), warning,
    });
  }

  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const b = await req.json().catch(() => null);
  const email = normalizeEmail(b?.agent?.email), name = String(b?.agent?.name || "").trim().slice(0, 80);
  if (!email || !name) return json(400, { error: "agent_required", message: "Choose who's hosting the open house, with their name and email." });
  const [{ homes, warning }, all] = await Promise.all([bookableHomes(week), listRequests()]);
  const home = homes.find((h) => h.mls === String(b.mls || ""));
  if (!home) return warning ? json(502, { error: "listings_unavailable", message: "Listings are unavailable right now. Try again shortly." })
    : json(400, { error: "invalid_home", message: "Choose a home." });

  const autoApprove = b.autoApprove === true, quiet = autoApprove && b.sendEmails === false, next = { mls: home.mls, iso: String(b.iso || ""), from: Number(b.from), to: Number(b.to) };
  const err = checkTeamAdd(next, all, { agentEmail: email, days: home.days, external: home.mlsOpenHouses, enteredByHand: autoApprove && b.method === "manual" });
  if (err) return json(409, { error: "cannot_add", message: err });

  const record = {
    id: newId(), ...next, day: dayKeyOf(next.iso), listing: snapshot(home), notes: String(b.notes || "").slice(0, 1000).trim(),
    phone: knownAgents(all).find((p) => p.email === email)?.phone || "", agent: { email, name },
    site: siteFor(new URL(req.url).origin), status: "pending", createdAt: Date.now(), reminderSent: false,
    addedBy: { email: user.email, name: user.name }, ...(quiet ? { sendEmails: false } : {}),
  };
  const added = `Added by ${user.name} for ${name}`;
  if (autoApprove) {
    const { status, body } = await approveRequest(record, user, { method: b.method, mlsEntered: b.method === "manual" }, { all, added });
    return json(status, { ...body, id: record.id });
  }
  await saveRequest(record);
  await logEvent(record.id, "added", { note: `${added}. Waiting for a decision, with its hours held. Nobody was emailed` }, user.email);
  return json(200, { ok: true, id: record.id, status: "pending" });
};
export const config = { path: "/api/team/new-request" };
