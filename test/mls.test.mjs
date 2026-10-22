import test from "node:test";
import assert from "node:assert/strict";

process.env.MLS_WEBHOOK_SECRET = "s".repeat(40);
const { nextAction, needsDispatch, buildPayload, applyResult, sign, verify, desiredFor } = await import("../netlify/lib/mls.mjs");
const { checkChange, checkCancel, checkCancelRequest, openCancelRequest } = await import("../netlify/lib/changes.mjs");
const { ics } = await import("../netlify/lib/email.mjs");

const NOW = Date.parse("2026-10-21T13:00:00Z"); // Wed Oct 21, 8 AM Central
const listing = { mls: "21413668", addr: "1704 Overlook Drive", city: "Grapevine", zip: "76051" };
const req = (o = {}) => ({ id: "a".repeat(32), mls: "21413668", iso: "2026-10-24", day: "sat", from: 13, to: 16, status: "approved",
  listing, agent: { email: "agent@synergyrealtors.com", name: "Pat Agent" }, decidedBy: "team@georgeandnoonan.com", decidedAt: NOW, ...o });
const onMls = (r) => ({ ...r, sync: { current: desiredFor(r), state: "synced" } });

test("desired state -> action", () => {
  assert.equal(nextAction(req()), "add");                                       // approved, not on MLS
  assert.equal(nextAction(onMls(req())), null);                                 // matches
  assert.equal(nextAction({ ...onMls(req()), from: 14 }), "update");            // team moved it
  assert.equal(nextAction({ ...onMls(req()), status: "cancelled" }), "cancel"); // cancelled after booking
  assert.equal(nextAction(req({ status: "cancelled" })), null);                 // cancelled before the bot ran: nothing to do
  assert.equal(nextAction(req({ status: "pending" })), null);
});

test("dispatch rules", () => {
  assert.equal(needsDispatch(req(), NOW, "off"), null);                         // automation off
  const d = needsDispatch(req(), NOW, "live");
  assert.equal(d.action, "add");
  // in flight: don't send twice
  assert.equal(needsDispatch(req({ sync: { job: { key: d.key, done: false } } }), NOW, "live"), null);
  // failed: waits for Retry
  assert.equal(needsDispatch(req({ sync: { state: "failed", job: { key: d.key, done: true } } }), NOW, "live"), null);
  // a dry run that passed is re-sent once the mode is switched to live
  const dry = needsDispatch(req(), NOW, "dry_run");
  assert.ok(needsDispatch(req({ sync: { state: "dry_run_ok", job: { key: dry.key, done: true } } }), NOW, "live"));
  // delivery backoff
  assert.equal(needsDispatch(req({ sync: { delivery: { key: d.key, attempts: 1, nextTryAt: NOW + 60000 } } }), NOW, "live"), null);
  // past open houses are left alone
  assert.equal(needsDispatch(req({ iso: "2026-10-17" }), NOW, "live"), null);
  // the team chose to enter this one by hand: never sent, even when it's changed or cancelled later
  assert.equal(needsDispatch(req({ mlsMethod: "manual" }), NOW, "live"), null);
  assert.equal(needsDispatch({ ...onMls(req({ mlsMethod: "manual" })), from: 14 }, NOW, "live"), null);
  assert.equal(needsDispatch(req({ mlsMethod: "agent" }), NOW, "live").action, "add");
});

test("entered by hand or by the AI agent", async () => {
  const { byHand, agentReady } = await import("../netlify/lib/mls.mjs");
  const env = { ...process.env };
  try {
    delete process.env.MLS_BOOKING_MODE; process.env.GROKBOT_WEBHOOK_URL = "https://bot.example/hook";
    assert.equal(agentReady(), false);                                            // automation off
    assert.equal(byHand(req({ mlsMethod: "agent" })), true);                      // off means everything is by hand
    process.env.MLS_BOOKING_MODE = "live";
    assert.equal(agentReady(), true);
    assert.equal(byHand(req({ mlsMethod: "manual" })), true);
    assert.equal(byHand(req({ mlsMethod: "agent" })), false);
    assert.equal(byHand(req()), false);                                           // approved before the choice existed: the bot, as before
    delete process.env.GROKBOT_WEBHOOK_URL;
    assert.equal(agentReady(), false);                                            // no bot to send to
  } finally { process.env = env; }
});

test("webhook payload", () => {
  const r = { ...onMls(req()), from: 14, to: 17 };
  const p = buildPayload(r, needsDispatch(r, NOW, "live"), "job_1", { dryRun: false, site: "https://open-house.synergyrealtors.com" });
  assert.equal(p.action, "update");
  assert.deepEqual([p.date, p.start, p.end, p.type], ["2026-10-24", "14:00", "17:00", "Public"]);
  assert.deepEqual([p.original_date, p.original_start, p.original_end], ["2026-10-24", "13:00", "16:00"]);
  assert.equal(p.mls_number, "21413668");
  assert.equal(p.address, "1704 Overlook Drive, Grapevine, TX 76051");
  assert.equal(p.callback_url, "https://open-house.synergyrealtors.com/api/mls/callback");
  assert.ok(!("access" in p) && !JSON.stringify(p).includes("lockbox"));
  const c = { ...onMls(req()), status: "cancelled" };
  const pc = buildPayload(c, needsDispatch(c, NOW, "live"), "job_2");
  assert.deepEqual([pc.action, pc.remove_method, pc.start, pc.original_start], ["cancel", "cancel", "13:00", "13:00"]);
  assert.equal(pc.callback_url, "https://open-house.synergyrealtors.com/api/mls/callback");      // no site recorded: production
  const local = req({ site: "http://localhost:8888" });
  assert.equal(buildPayload(local, needsDispatch(local, NOW, "live"), "job_3").callback_url, "http://localhost:8888/api/mls/callback");
});

test("bot results update the MLS state", () => {
  const r = req(); const d = needsDispatch(r, NOW, "live");
  r.sync = { state: "booking", job: { id: "job_1", key: d.key, from: d.from, to: d.to, done: false } };
  assert.ok(applyResult(r, { job_id: "job_other", result: "booked" }).ignored);   // stale job
  assert.equal(applyResult(r, { job_id: "job_1", result: "booked" }).state, "synced");
  assert.deepEqual(r.sync.current, { iso: "2026-10-24", from: 13, to: 16, type: "Public" });
  assert.ok(applyResult(r, { job_id: "job_1", result: "booked" }).ignored);       // repeated callback
  assert.equal(nextAction(r), null);

  const c = { ...r, status: "cancelled" }; const dc = needsDispatch(c, NOW, "live");
  c.sync = { ...c.sync, job: { id: "job_2", key: dc.key, from: dc.from, to: dc.to, done: false } };
  applyResult(c, { job_id: "job_2", result: "cancelled" });
  assert.equal(c.sync.current, null);

  const f = req(); f.sync = { job: { id: "job_3", key: "k", to: desiredFor(f), done: false } };
  assert.equal(applyResult(f, { job_id: "job_3", result: "needs_login", message: "Sign-in needed" }).state, "needs_login");
  assert.equal(f.sync.current, undefined);
});

test("webhook signatures", () => {
  const body = '{"a":1}', ts = String(Math.floor(NOW / 1000));
  assert.ok(verify(ts, sign(ts, body), body, NOW));
  assert.ok(!verify(ts, sign(ts, body), '{"a":2}', NOW));                       // tampered body
  assert.ok(!verify(ts, sign(ts, body), body, NOW + 6 * 60000));                // replayed after 5 minutes
  assert.ok(!verify(ts, "nope", body, NOW));
});

test("team change rules", () => {
  const r = req();
  assert.equal(checkChange(r, { iso: "2026-10-25", from: 14, to: 16 }, [r], NOW), null);
  assert.match(checkChange(r, { iso: "2026-10-23", from: 14, to: 16 }, [r], NOW), /Saturday or Sunday/);
  assert.match(checkChange(r, { iso: "2026-10-25", from: 8, to: 10 }, [r], NOW), /9:00 AM and 7:00 PM/);
  assert.match(checkChange(r, { iso: "2026-10-25", from: 16, to: 14 }, [r], NOW), /9:00 AM and 7:00 PM/);
  assert.match(checkChange(r, { iso: "2026-10-24", from: 13, to: 16 }, [r], NOW), /same time/);
  assert.match(checkChange(r, { iso: "2026-10-17", from: 13, to: 16 }, [r], NOW), /already passed/);
  const other = req({ id: "b".repeat(32), iso: "2026-10-25", from: 15, to: 17 });
  assert.match(checkChange(r, { iso: "2026-10-25", from: 14, to: 16 }, [r, other], NOW), /Another approved/);
  assert.match(checkChange(req({ status: "pending" }), { iso: "2026-10-25", from: 14, to: 16 }, [], NOW), /Only approved/);
  assert.match(checkChange(r, { iso: "2026-10-25", from: 14, to: 16 }, [r], Date.parse("2026-10-24T18:30:00Z")), /already started/);
});

const agent = { email: "agent@synergyrealtors.com", name: "Pat Agent", team: false }, stranger = { email: "x@synergyrealtors.com", team: false }, team = { email: "t@georgeandnoonan.com", team: true };

test("cancel rules: only the team cancels", () => {
  assert.equal(checkCancel(req(), team, NOW), null);
  assert.equal(checkCancel(req({ status: "pending" }), team, NOW), null);
  assert.match(checkCancel(req(), agent, NOW), /Only the George & Noonan team/);   // agents ask instead
  assert.match(checkCancel(req({ status: "declined" }), team, NOW), /already declined/);
  assert.equal(checkCancel(req(), team, Date.parse("2026-10-24T17:00:00Z")), null);   // Saturday noon, still before 1 PM start
  assert.match(checkCancel(req(), team, Date.parse("2026-10-24T18:30:00Z")), /already started/);
});

test("agents ask the team to cancel their own requests", () => {
  assert.equal(checkCancelRequest(req(), agent, NOW), null);                     // own approved open house
  assert.equal(checkCancelRequest(req({ status: "pending" }), agent, NOW), null); // own pending request
  assert.match(checkCancelRequest(req(), stranger, NOW), /your own/);
  assert.match(checkCancelRequest(req({ status: "cancelled" }), agent, NOW), /already cancelled/);
  assert.match(checkCancelRequest(req(), agent, Date.parse("2026-10-24T18:30:00Z")), /already started/);
  const asked = req({ cancelRequest: { at: NOW, by: agent.email } });
  assert.ok(openCancelRequest(asked));
  assert.match(checkCancelRequest(asked, agent, NOW), /already asked/);            // one open request at a time
  const kept = req({ cancelRequest: { at: NOW, by: agent.email, outcome: "kept" } });
  assert.ok(!openCancelRequest(kept));
  assert.equal(checkCancelRequest(kept, agent, NOW), null);                      // can ask again after the team kept it
});

test("calendar invites update and cancel the same event", () => {
  const up = ics(req({ seq: 1 }));
  assert.match(up, /METHOD:PUBLISH/); assert.match(up, /SEQUENCE:1/); assert.match(up, /UID:a{32}@/);
  const cx = ics(req({ seq: 2, status: "cancelled" }));
  assert.match(cx, /METHOD:CANCEL/); assert.match(cx, /STATUS:CANCELLED/); assert.match(cx, /UID:a{32}@/);
});

const { openHouseEntries } = await import("../netlify/lib/listings.mjs");

test("team changes are checked against open houses already on the MLS", () => {
  const r = { ...req(), sync: { current: { iso: "2026-10-24", from: 13, to: 16, type: "Public" } } };
  // Repliers sends UTC; 19:00Z on Oct 25 is 2 PM Central.
  const ext = openHouseEntries({ openHouse: [
    { startTime: "2026-10-24T18:00:00.000-00:00", endTime: "2026-10-24T21:00:00.000-00:00", status: "Active" },   // this request's own entry
    { startTime: "2026-10-25T19:00:00.000-00:00", endTime: "2026-10-25T21:00:00.000-00:00", status: "Active" },   // entered outside the portal
    { startTime: "2026-10-25T15:00:00.000-00:00", endTime: "2026-10-25T17:00:00.000-00:00", status: "Cancelled" },
  ] });
  assert.deepEqual(ext, [{ iso: "2026-10-24", from: 13, to: 16 }, { iso: "2026-10-25", from: 14, to: 16 }]);
  assert.match(checkChange(r, { iso: "2026-10-25", from: 15, to: 17 }, [r], NOW, ext), /already on the MLS \(2:00 PM to 4:00 PM\)/);
  assert.equal(checkChange(r, { iso: "2026-10-25", from: 10, to: 12 }, [r], NOW, ext), null);       // cancelled entry doesn't block
  assert.equal(checkChange(r, { iso: "2026-10-24", from: 14, to: 17 }, [r], NOW, ext), null);       // its own entry doesn't block
  assert.equal(checkChange(r, { iso: "2026-10-25", from: 16, to: 18 }, [r], NOW, ext), null);       // back to back is fine
});
