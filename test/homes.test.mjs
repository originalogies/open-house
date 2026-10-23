import test from "node:test";
import assert from "node:assert/strict";

const { cleanHome, isHomeId, isMlsNumber, asListing, addressKey, linkSuggestions, mergeInfo, newHomeId } = await import("../netlify/lib/homes.mjs");
const { teamView, publicListing } = await import("../netlify/lib/listings.mjs");
const { needsDispatch } = await import("../netlify/lib/mls.mjs");

const good = { addr: " 1704  Overlook Drive ", city: "Grapevine", zip: "76051", price: "495000", bd: "3", ba: "2.5", sf: "1745" };

test("team-added home fields are checked and cleaned", () => {
  assert.deepEqual(cleanHome(good).fields, { addr: "1704 Overlook Drive", city: "Grapevine", zip: "76051", price: 495000, bd: 3, ba: 2.5, sf: 1745 });
  assert.match(cleanHome({ ...good, addr: "" }).error, /Street address is required/);
  assert.match(cleanHome({ ...good, zip: "7605" }).error, /5-digit ZIP/);
  assert.match(cleanHome({ ...good, ba: "2.25" }).error, /bathroom count/);   // halves only
  assert.match(cleanHome({ ...good, bd: "1.5" }).error, /bedroom count/);
  assert.match(cleanHome({ ...good, price: "" }).error, /price/);
  assert.deepEqual(cleanHome({ price: "500000" }, { partial: true }).fields, { price: 500000 }); // update only what's sent
});

test("team-added home ids never look like MLS numbers", () => {
  const id = newHomeId();
  assert.ok(isHomeId(id) && !isMlsNumber(id));
  assert.ok(isMlsNumber("21413668") && !isHomeId("21413668"));
  const l = asListing({ id, ...cleanHome(good).fields, photos: ["abcdef123456"] });
  assert.equal(l.mls, id);
  assert.equal(l.img, `/api/home-photo?id=${id}&p=abcdef123456`);
  assert.ok(l.teamAdded);
  assert.equal(asListing({ id, ...cleanHome(good).fields, photos: [] }).img, "");
});

test("MLS listings at the same address are suggested for linking", () => {
  const home = { addr: "1704 Overlook Dr.", zip: "76051" };
  assert.equal(addressKey("1704 Overlook Drive", "76051"), addressKey("1704 overlook dr", "76051-1234"));
  const mls = [
    { mls: "21413668", addr: "1704 Overlook Drive", zip: "76051" },
    { mls: "1", addr: "1704 Overlook Drive", zip: "76092" },   // same street, other town
    { mls: "2", addr: "1706 Overlook Drive", zip: "76051" },
  ];
  assert.deepEqual(linkSuggestions(home, mls).map((l) => l.mls), ["21413668"]);
  assert.equal(addressKey("2800 North Kimball Avenue", "76092"), addressKey("2800 N Kimball Ave", "76092"));
});

test("linking keeps the home's instructions, access details and Vacant", () => {
  const home = { offeredWeek: "2026-10-24", priorityWeek: null, days: ["sun"], instr: ["Shoes off"], access: "Lockbox 1234", vacant: true };
  const fresh = { offeredWeek: null, priorityWeek: null, days: ["sat", "sun"], instr: [], access: "", vacant: false };
  assert.deepEqual(mergeInfo(home, fresh), home);
  // A home with nothing set yet doesn't wipe what the MLS listing already had.
  const blankHome = { offeredWeek: null, priorityWeek: null, days: ["sat", "sun"], instr: [], access: "", vacant: false };
  const mlsHad = { offeredWeek: null, priorityWeek: null, days: ["sat"], instr: ["Use side door"], access: "Gate 99", vacant: true };
  assert.deepEqual(mergeInfo(blankHome, mlsHad), mlsHad);
});

test("instructions, access details and Vacant carry into the next week", () => {
  const info = { offeredWeek: "2026-10-24", priorityWeek: "2026-10-24", days: ["sat"], instr: ["Shoes off"], access: "Lockbox 1234", vacant: true };
  assert.deepEqual(teamView(info, { satIso: "2026-10-24" }), { offered: true, priority: true, days: ["sat"], instr: ["Shoes off"], access: "Lockbox 1234", vacant: true });
  // Next weekend: publishing and Priority start over; everything else stays with the home.
  assert.deepEqual(teamView(info, { satIso: "2026-10-31" }), { offered: false, priority: false, days: ["sat"], instr: ["Shoes off"], access: "Lockbox 1234", vacant: true });
  assert.equal(teamView({ ...info, vacant: undefined }, { satIso: "2026-10-24" }).vacant, false); // saved before Vacant existed
});

test("agents see Vacant, never access details", () => {
  const l = { mls: "21297798", addr: "2006 Nighthawk Court", days: ["sat"], instr: [], access: "Gate 1234", vacant: true };
  assert.equal(publicListing(l).vacant, true);
  assert.equal(publicListing({ ...l, vacant: undefined }).vacant, false);
  assert.ok(!("access" in publicListing(l)));
});

test("open houses on a home that isn't on the MLS yet aren't sent to the MLS bot", () => {
  const NOW = Date.parse("2026-10-21T13:00:00Z");
  const r = { id: "a".repeat(32), mls: newHomeId(), iso: "2026-10-24", from: 13, to: 16, status: "approved", listing: { addr: "1704 Overlook Drive", city: "Grapevine", zip: "76051" }, sync: { current: null, state: "not_on_mls" } };
  assert.equal(needsDispatch(r, NOW, "live"), null);
  assert.equal(needsDispatch({ ...r, mls: "21413668", sync: { current: null, state: "idle" } }, NOW, "live").action, "add"); // after linking
});
