import test from "node:test";
import assert from "node:assert/strict";
import { checkTeamAdd } from "../netlify/lib/changes.mjs";
import { holdsSlot, knownAgents } from "../netlify/lib/requests.mjs";
import { upcomingDays } from "../netlify/lib/week.mjs";

// The team adding an open house request for an agent (Requests > Add a request, team-new-request.mjs).
const NOW = Date.parse("2026-11-09T16:00:00Z"); // Mon Nov 9, 10 AM Central
const SAT = "2026-11-14", SUN = "2026-11-15";
const r = (o = {}) => ({ id: "a".repeat(32), mls: "21413668", iso: SAT, from: 13, to: 15, status: "pending", agent: { email: "pat@x.com", name: "Pat Agent" }, ...o });
const next = (o = {}) => ({ mls: "21413668", iso: SAT, from: 13, to: 15, ...o });
const check = (n, all = [], o = {}) => checkTeamAdd(n, all, { agentEmail: "kelly@x.com", now: NOW, ...o });

test("a request the team adds holds its hours while it waits", () => {
  assert.ok(holdsSlot(r({ addedBy: { email: "team@x.com", name: "Team" } })));
  assert.ok(!holdsSlot(r()));                                            // an agent's own request doesn't, until approved
  assert.ok(holdsSlot(r({ status: "approved" })));
  assert.ok(!holdsSlot(r({ status: "declined", addedBy: { email: "team@x.com" } })));
  assert.ok(!holdsSlot(r({ status: "expired", addedBy: { email: "team@x.com" } })));
});

test("team add rules", () => {
  assert.equal(check(next()), null);
  // any day of the week the seller allows: Saturday and Sunday unless the team changes the home's days
  assert.equal(check(next({ iso: "2026-11-13" })), "The seller doesn't offer Fridays for this home.");
  assert.equal(check(next({ iso: "2026-11-13" }), [], { days: ["fri", "sat"] }), null);
  assert.equal(check(next({ iso: "2026-11-11" }), [], { days: ["wed"] }), null);
  assert.equal(check(next({ iso: "nope" })), "Pick a valid date.");
  assert.match(check(next({ iso: SUN }), [], { days: ["sat"] }), /doesn't offer Sundays/);
  assert.match(check(next({ from: 8 })), /between 9:00 AM and 7:00 PM/);
  assert.match(check(next({ from: 15, to: 15 })), /between 9:00 AM and 7:00 PM/);
  assert.equal(check(next({ iso: "2026-11-08" })), "That time has already passed.");
  // the weekly cutoff doesn't apply to the team: a weekend a month out is fine
  assert.equal(check(next({ iso: "2026-12-05" })), null);
});

test("team adds can't take hours someone else holds", () => {
  const added = r({ addedBy: { email: "team@x.com" } });
  assert.match(check(next({ from: 14, to: 16 }), [r({ status: "approved" })]), /already holds those hours/);
  assert.match(check(next(), [added]), /already holds those hours/);
  assert.equal(check(next({ from: 15, to: 17 }), [added]), null);       // back to back is fine
  assert.equal(check(next({ mls: "999" }), [added]), null);             // another home
  assert.equal(check(next(), [r()]), null);                             // someone else's request that's only waiting
  // the same agent already asked for those hours: approve theirs instead
  assert.match(check(next(), [r({ agent: { email: "Kelly@x.com", name: "Kelly" } })]), /Approve their request instead/);
});

test("team adds and open houses already on the MLS", () => {
  const external = [{ iso: SAT, from: 13, to: 15 }];
  assert.match(check(next({ from: 14, to: 16 }), [], { external }), /already on the MLS \(1:00 PM to 3:00 PM\)/);
  assert.match(check(next(), [], { external }), /already on the MLS/);                        // exact, but not entered by hand
  assert.equal(check(next(), [], { external, enteredByHand: true }), null);                   // the team entered this one
  assert.match(check(next({ from: 13, to: 16 }), [], { external, enteredByHand: true }), /already on the MLS/);
  assert.equal(check(next({ iso: SUN }), [], { external }), null);
});

test("the days the team can add for: every day from today to the end of the week three weeks out", () => {
  const days = (now) => upcomingDays(new Date(now));
  const mon = days(NOW); // Monday Nov 9, 10 AM: today through Sunday Dec 6
  assert.equal(mon.length, 28);
  assert.deepEqual([mon[0], mon.at(-1)].map((d) => [d.iso, d.key, d.label]), [["2026-11-09", "mon", "Monday"], ["2026-12-06", "sun", "Sunday"]]);
  assert.deepEqual(mon.slice(0, 7).map((d) => d.key), ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  // Sunday morning: today is listed, then the next three weeks
  assert.deepEqual([days("2026-11-15T15:00:00Z")[0].iso, days("2026-11-15T15:00:00Z").length], ["2026-11-15", 22]);
  // Sunday at 6:30 PM: no full hour left today, so it starts Monday
  assert.equal(days("2026-11-16T00:30:00Z")[0].iso, "2026-11-16");
});

test("who the team can add a request for", () => {
  const all = [
    { createdAt: 1, agent: { email: "Pat@x.com", name: "Pat A." }, phone: "111" },
    { createdAt: 2, agent: { email: "pat@x.com", name: "Pat Agent" } },  // the newest name wins; the phone stays
    { createdAt: 3, agent: { email: "lee@x.com", name: "Lee Host" }, phone: "222" },
  ];
  const agreements = [{ email: "new@x.com", signedName: "New Agent", status: "signed" }, { email: "lee@x.com", signedName: "Lee Signed" }, { email: "noname@x.com" }];
  assert.deepEqual(knownAgents(all, agreements), [
    { email: "lee@x.com", name: "Lee Host", phone: "222" },
    { email: "new@x.com", name: "New Agent", phone: "" },
    { email: "pat@x.com", name: "Pat Agent", phone: "111" },
  ]);
});
