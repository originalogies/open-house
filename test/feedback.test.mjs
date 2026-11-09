import test from "node:test";
import assert from "node:assert/strict";
import { feedbackOpen, feedbackStep, cleanFeedback, endMs, feedbackByHome, checkFeedbackReminder, REMIND_GAP, markActive } from "../netlify/lib/feedback.mjs";

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
  const ok = { visitors: 12, interest: "some", price: "high", liked: " Big kitchen. ", disliked: "Dated baths", forSeller: "", teamNotes: "", brokerFlag: false };
  const { feedback } = cleanFeedback(ok, 5, ["aaaaaaaaaaaa"]);
  assert.deepEqual(feedback, { at: 5, visitors: 12, interest: "some", price: "high", liked: "Big kitchen.", disliked: "Dated baths", forSeller: "", teamNotes: "", brokerFlag: false, photos: ["aaaaaaaaaaaa"] });
  assert.match(cleanFeedback({ ...ok, visitors: "" }).error, /how many/);
  assert.match(cleanFeedback({ ...ok, visitors: -1 }).error, /how many/);
  assert.match(cleanFeedback({ ...ok, visitors: 2.5 }).error, /how many/);
  assert.match(cleanFeedback({ ...ok, interest: "huge" }).error, /interest/);
  assert.match(cleanFeedback({ ...ok, price: "" }).error, /price/);
  // Visitors came: the seller needs to hear what they said, good or bad.
  assert.match(cleanFeedback({ ...ok, liked: " ", disliked: "" }).error, /liked or didn't like/);
  assert.ok(cleanFeedback({ ...ok, liked: "" }).feedback);
  assert.ok(cleanFeedback({ ...ok, disliked: "" }).feedback);
  // Nobody came: nothing to report.
  assert.equal(cleanFeedback({ ...ok, visitors: 0, price: "none", liked: "", disliked: "" }).feedback.visitors, 0);
  assert.match(cleanFeedback({ ...ok, disliked: "x".repeat(5001) }).error, /too long/);
  assert.match(cleanFeedback({ ...ok, forSeller: "x".repeat(5001) }).error, /too long/);
  assert.match(cleanFeedback({ ...ok, brokerFlag: true }).error, /broker/);          // a flag needs a note
  assert.equal(cleanFeedback({ ...ok, brokerFlag: true, teamNotes: "Back door was open" }).feedback.brokerFlag, true);
  assert.equal(cleanFeedback({ ...ok, brokerFlag: "yes" }).feedback.brokerFlag, false); // only a real true counts
  assert.equal(cleanFeedback(ok, 5, Array(12).fill("aaaaaaaaaaaa")).feedback.photos.length, 10);
});

test("feedback is grouped by home, across MLS numbers, newest open house first", () => {
  const agent = { name: "Pat Lee", email: "pat@synergyrealtors.com" };
  const home = (mls, addr, extra = {}) => r({ id: mls + extra.iso, mls, agent, listing: { addr, city: "Grapevine", zip: "76051", img: null }, ...extra });
  const fb = (visitors, interest, brokerFlag = false) => ({ at: 1, visitors, interest, price: "high", liked: "x", disliked: "", teamNotes: brokerFlag ? "Door open" : "", brokerFlag, photos: ["bbbbbbbbbbbb"] });
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
  assert.deepEqual(a.price, { high: 2, right: 0, value: 0, none: 0 });
  assert.match(a.openHouses[1].feedback.photos[0], /^\/api\/feedback-photo\?id=.+&p=bbbbbbbbbbbb$/); // photos come as private links
  assert.equal(b.addr, "6900 Rockingham Court");
  assert.equal(b.lastIso, "2026-10-24");
  assert.ok(!("access" in a) && !("notes" in a.openHouses[0])); // nothing private goes to the console
  // Emailed a feedback link: only open houses the hourly job asked about, never imported history.
  const oak = (iso, extra = {}) => home("444", "12 Oak Lane", { iso, ...extra });
  const [h] = feedbackByHome([oak("2026-10-17", { feedbackAskedAt: 1 }), oak("2026-10-11", { feedbackAskedAt: 1, imported: { source: "Added by hand" } }), oak("2026-10-04")], end + H);
  assert.deepEqual(h.openHouses.map((o) => o.emailed), [true, false, false]);
});

test("the team can email a reminder once the open house has ended and while there's no feedback", () => {
  const agent = { name: "Darby Schabel", email: "darby@x.com" };
  assert.equal(checkFeedbackReminder(r({ agent }), end + H), null);
  assert.equal(checkFeedbackReminder(r({ agent, imported: { source: "G&N Calendar" } }), end + 400 * 24 * H), null); // old history too
  assert.match(checkFeedbackReminder(r({ agent }), end - 1), /hasn't ended yet/);
  assert.match(checkFeedbackReminder(r({ agent, status: "cancelled" }), end + H), /didn't take place/);
  assert.match(checkFeedbackReminder(r({ agent, feedback: { at: 1 } }), end + H), /^Darby already sent feedback/);
  // a few minutes between reminders, so a double press sends one email
  const sent = r({ agent, feedbackReminders: [{ at: end + H, byName: "Team" }] });
  assert.match(checkFeedbackReminder(sent, end + H + 1000), /already went to Darby/);
  assert.equal(checkFeedbackReminder(sent, end + H + REMIND_GAP), null);
  // the home's page shows the latest reminder and how many
  const [h] = feedbackByHome([{ ...sent, id: "a".repeat(32), mls: "1", listing: { addr: "1 A St", zip: "76092" },
    feedbackReminders: [{ at: 5, byName: "Kelly" }, { at: 9, byName: "London" }] }], end + H);
  assert.deepEqual([h.openHouses[0].reminders, h.openHouses[0].reminded], [2, { at: 9, byName: "London" }]);
});

test("a home is active while it's on the market: same address (even relisted) or one of its MLS numbers", () => {
  const current = { keys: new Set(["1704 overlook dr|76051", "12 oak ln|76092"]), mls: new Set(["21413668", "H0123456789"]) };
  const h = (key, mls) => ({ key, mls });
  assert.deepEqual(markActive([
    h("1704 overlook dr|76051", ["111"]),        // relisted under a new MLS number: still the same home
    h("200 murano pl|76092", ["21136267"]),      // not on the market now: past
    h("9 elm st|76092", ["21413668"]),           // its MLS number is current
    h("12 oak ln|76092", ["H0123456789"]),       // a team-added home on the Listings page
  ], current).map((x) => x.active), [true, false, true, true]);
});
