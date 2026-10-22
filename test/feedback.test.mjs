import test from "node:test";
import assert from "node:assert/strict";
import { feedbackOpen, feedbackStep, cleanFeedback, endMs, feedbackByHome } from "../netlify/lib/feedback.mjs";

const H = 60 * 60 * 1000;
// Saturday Oct 24 2026, 1 to 3 PM Central (CDT): ends 20:00 UTC.
const r = (extra = {}) => ({ status: "approved", iso: "2026-10-24", from: 13, to: 15, ...extra });
const end = Date.UTC(2026, 9, 24, 20);

test("open house end time is Central", () => {
  assert.equal(endMs(r()), end);
});

test("feedback opens when an approved open house ends", () => {
  assert.ok(!feedbackOpen(r(), end - 1));
  assert.ok(feedbackOpen(r(), end));
  assert.ok(!feedbackOpen(r({ status: "cancelled" }), end + H));
  assert.ok(!feedbackOpen(r({ status: "declined" }), end + H));
});

test("ask an hour after, remind once a day later, then stop", () => {
  assert.equal(feedbackStep(r(), end + 30 * 60 * 1000), null);
  assert.equal(feedbackStep(r(), end + H), "ask");
  assert.equal(feedbackStep(r(), end + 4 * 24 * H), null); // too old: never asked
  const asked = end + H;
  assert.equal(feedbackStep(r({ feedbackAskedAt: asked }), asked + 23 * H), null);
  assert.equal(feedbackStep(r({ feedbackAskedAt: asked }), asked + 24 * H), "remind");
  assert.equal(feedbackStep(r({ feedbackAskedAt: asked, feedbackRemindedAt: asked + 24 * H }), asked + 48 * H), null);
  assert.equal(feedbackStep(r({ feedbackAskedAt: asked, feedback: { at: 1 } }), asked + 24 * H), null); // already sent
  assert.equal(feedbackStep(r({ status: "cancelled" }), end + H), null);
});

test("feedback form rules", () => {
  const ok = { visitors: 12, interest: "some", happened: " Busy afternoon. ", teamNotes: "", brokerFlag: false };
  const { feedback } = cleanFeedback(ok, 5);
  assert.deepEqual(feedback, { at: 5, visitors: 12, interest: "some", happened: "Busy afternoon.", teamNotes: "", brokerFlag: false });
  assert.equal(cleanFeedback({ ...ok, visitors: 0 }).feedback.visitors, 0);
  assert.match(cleanFeedback({ ...ok, visitors: "" }).error, /how many/);
  assert.match(cleanFeedback({ ...ok, visitors: -1 }).error, /how many/);
  assert.match(cleanFeedback({ ...ok, visitors: 2.5 }).error, /how many/);
  assert.match(cleanFeedback({ ...ok, interest: "huge" }).error, /interest/);
  assert.match(cleanFeedback({ ...ok, happened: "   " }).error, /what happened/);
  assert.match(cleanFeedback({ ...ok, happened: "x".repeat(5001) }).error, /too long/);
  assert.match(cleanFeedback({ ...ok, brokerFlag: true }).error, /broker/);          // a flag needs a note
  assert.equal(cleanFeedback({ ...ok, brokerFlag: true, teamNotes: "Back door was open" }).feedback.brokerFlag, true);
  assert.equal(cleanFeedback({ ...ok, brokerFlag: "yes" }).feedback.brokerFlag, false); // only a real true counts
});

test("feedback is grouped by home, across MLS numbers, newest open house first", () => {
  const agent = { name: "Pat Lee", email: "pat@synergyrealtors.com" };
  const home = (mls, addr, extra = {}) => r({ id: mls + extra.iso, mls, agent, listing: { addr, city: "Grapevine", zip: "76051", img: null }, ...extra });
  const fb = (visitors, interest, brokerFlag = false) => ({ at: 1, visitors, interest, happened: "x", teamNotes: brokerFlag ? "Door open" : "", brokerFlag });
  const all = [
    home("111", "1704 Overlook Drive", { iso: "2026-10-10", feedback: fb(8, "lots") }),
    home("222", "1704 Overlook Dr.", { iso: "2026-10-17", feedback: fb(3, "some", true) }), // relisted: new MLS number, same home
    home("222", "1704 Overlook Dr", { iso: "2026-10-18" }),                                  // hosted, no feedback yet
    home("222", "1704 Overlook Dr", { iso: "2026-10-31" }),                                  // not hosted yet
    home("222", "1704 Overlook Dr", { iso: "2026-10-11", status: "declined" }),
    home("333", "6900 Rockingham Court", { iso: "2026-10-24", feedback: fb(5, "little") }),
  ];
  const homes = feedbackByHome(all, end + H);
  assert.equal(homes.length, 2);
  const [a, b] = homes;
  assert.equal(a.addr, "1704 Overlook Dr"); // the flagged home comes first even though Rockingham was hosted later
  assert.deepEqual(a.mls.sort(), ["111", "222"]);
  assert.equal(a.hosted, 3);
  assert.equal(a.withFeedback, 2);
  assert.equal(a.visitors, 11);
  assert.deepEqual(a.interest, { lots: 1, some: 1, little: 0 });
  assert.equal(a.flags, 1);
  assert.deepEqual(a.openHouses.map((o) => o.iso), ["2026-10-18", "2026-10-17", "2026-10-10"]);
  assert.equal(a.openHouses[0].feedback, null);
  assert.equal(b.addr, "6900 Rockingham Court");
  assert.equal(b.lastIso, "2026-10-24");
  assert.ok(!("access" in a) && !("notes" in a.openHouses[0])); // nothing private goes to the console
});
