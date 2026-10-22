import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { getRequest, saveRequest, isTeam } from "../lib/requests.mjs";
import { cancelRequest, changeRequest, keepRequest } from "../lib/actions.mjs";
import { logEvent, byHand } from "../lib/mls.mjs";
import { runSync } from "../lib/sync.mjs";
import { isMlsNumber } from "../lib/homes.mjs";

// Sending a job from a page request: keep the webhook call well inside the function time limit.
// If the bot is slower than this the job is retried like any failed delivery.
const NOW_TIMEOUT_MS = 7000;
const sendNow = () => runSync({ timeoutMs: NOW_TIMEOUT_MS }).catch((e) => console.error("MLS sync failed", e.message)); // the minute's run picks it up

// Team actions on a request after it was made.
// POST /api/manage { id, action: "change", iso, from, to }  move an approved open house
// POST /api/manage { id, action: "cancel" }                 cancel it, or approve the agent's cancellation request (agent and team are emailed)
// POST /api/manage { id, action: "keep" }                   turn down the agent's cancellation request (agent is emailed)
// POST /api/manage { id, action: "start" }                  send an open house scheduled with the AI agent to the bot now
// POST /api/manage { id, action: "retry" }                  send a failed MLS job to the bot again
export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!isTeam(user.email)) return json(403, { error: "team_only" });
  const b = await req.json().catch(() => null);
  const r = b && (await getRequest(String(b.id || "")));
  if (!r) return json(404, { error: "not_found" });

  let out;
  if (b.action === "change") out = await changeRequest(r, user, { iso: String(b.iso || ""), from: Number(b.from), to: Number(b.to) });
  else if (b.action === "cancel") out = await cancelRequest(r, { ...user, team: true });
  else if (b.action === "keep") out = await keepRequest(r, user);
  else if (b.action === "start") {
    if (r.status !== "approved" || !isMlsNumber(r.mls) || byHand(r)) return json(409, { error: "nothing_to_start", message: "This open house isn't scheduled with the AI agent." });
    // The bot takes one job at a time, soonest open house first, so this may send another request's
    // job and leave this one queued; the approve page shows which.
    await sendNow();
    out = { status: 200, ok: true };
  } else if (b.action === "retry") {
    if (!r.sync || !["failed", "needs_login", "dry_run_ok"].includes(r.sync.state)) return json(409, { error: "nothing_to_retry", message: "There's no failed MLS job to retry." });
    // Clearing the finished job lets the sync job send this change again.
    r.sync.job = null; r.sync.delivery = null; r.sync.state = "idle";
    await saveRequest(r);
    await logEvent(r.id, "retry", { note: "MLS job queued again" }, user.email);
    await sendNow();
    out = { status: 200, ok: true };
  } else return json(400, { error: "invalid_action" });

  const { status, ...body } = out;
  return json(status, body);
};
export const config = { path: "/api/manage" };
