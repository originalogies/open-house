import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BlobsServer } from "@netlify/blobs/server";
import { parseLimit, limitFor, overLimit } from "../netlify/lib/limits.mjs";

// Listing limits: set per agent on the Admin Console's Agents page (admin-limits.mjs), marked on the portal's homes
// (listings.mjs), and enforced when an agent requests an open house (requests.mjs). Run against a local Blobs
// server and a stand-in Repliers with two homes, one at $1,500,000 and one at $600,000.

test("parsing a limit typed on the Agents page", () => {
  assert.equal(parseLimit("750,000"), 750000);
  assert.equal(parseLimit("$1,250,000"), 1250000);
  assert.equal(parseLimit(" 900000 "), 900000);
  assert.equal(parseLimit(800000), 800000);
  assert.equal(parseLimit(""), null);          // blank: no limit
  assert.equal(parseLimit(null), null);
  assert.equal(parseLimit("  $ "), null);
  assert.equal(parseLimit("abc"), undefined);  // invalid
  assert.equal(parseLimit("-5"), undefined);
  assert.equal(parseLimit("0"), undefined);
  assert.equal(parseLimit("1e6"), undefined);
});

test("which homes are over a limit", () => {
  const limits = { "pat@x.com": 750000 };
  assert.equal(limitFor(limits, "Pat@X.com "), 750000);
  assert.equal(limitFor(limits, "kelly@x.com"), null);
  assert.equal(limitFor({}, "pat@x.com"), null);
  assert.equal(overLimit(750000, 750000), false); // at the limit books
  assert.equal(overLimit(750001, 750000), true);
  assert.equal(overLimit(5000000, null), false);  // no limit books everything
  assert.equal(overLimit(0, 750000), false);      // a home with no price yet isn't held back
  assert.equal(overLimit(undefined, 750000), false);
});

// ---- end to end, through the API handlers ----
process.env.SESSION_SECRET = "x".repeat(40);
process.env.ADMIN_EMAILS = "boss@synergyrealtors.com";
process.env.TEAM_EMAILS = "";
process.env.ALLOWED_DOMAINS = "synergyrealtors.com";
process.env.REPLIERS_API_KEY = "repliers-key";
delete process.env.DOCUSEAL_API_KEY;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-limits-"));
const blobs = new BlobsServer({ directory: dir, token: "t" });
const { port } = await blobs.start();
const edge = `http://localhost:${port}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: "test", token: "t" })).toString("base64");
after(async () => { await blobs.stop(); await fs.rm(dir, { recursive: true, force: true }); });

const home = (mls, price, num) => ({ mlsNumber: mls, listPrice: String(price), status: "A",
  address: { streetNumber: num, streetName: "Overlook", streetSuffix: "Drive", city: "Southlake", zip: "76092" },
  details: { propertyType: "Residential", numBedrooms: 4, numBathrooms: 4, sqft: 4000 }, images: ["a.jpg"], openHouse: [] });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.hostname === "localhost") return realFetch(url, init); // the Blobs server
  if (u.hostname !== "api.repliers.io") throw new Error(`no network in tests: ${u.hostname}`); // no real emails
  if (u.searchParams.get("sortBy") === "updatedOnDesc") return Response.json({ listings: [] });
  return Response.json({ numPages: 1, listings: [home("21000001", 1500000, "1704"), home("21000002", 600000, "1706")] });
};

const { makeSession } = await import("../netlify/lib/shared.mjs");
const fn = async (name) => (await import(`../netlify/functions/${name}.mjs`)).default;
const [limitsApi, accessApi, inventoryApi, listingsApi, requestsApi] =
  await Promise.all(["admin-limits", "admin-access", "inventory-listings", "listings", "requests"].map(fn));
const BOSS = `oh_session=${makeSession({ email: "boss@synergyrealtors.com", name: "Boss Person" })}`;
const PAT = `oh_session=${makeSession({ email: "pat@synergyrealtors.com", name: "Pat Agent" })}`;
const call = (handler, method, url, cookie, body) => handler(new Request(`https://open-house.synergyrealtors.com${url}`, {
  method, headers: { cookie, ...(body && { "content-type": "application/json" }) }, body: body && JSON.stringify(body) }));
const setLimit = (limit, cookie = BOSS) => call(limitsApi, "PUT", "/api/admin/limits", cookie, { email: "pat@synergyrealtors.com", limit });
const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const lockedOf = async () => {
  const d = await (await call(listingsApi, "GET", "/api/listings", PAT)).json();
  return Object.fromEntries(d.listings.map((l) => [l.mls, !!l.locked]));
};
const book = async (mls) => (await call(requestsApi, "POST", "/api/requests", PAT, { mls, day: "zzz", from: 13, to: 15 })).json();

test("admins set, change and clear an agent's limit; it comes back on the Agents page", async () => {
  assert.equal((await setLimit("750,000", PAT)).status, 403, "agents can't set limits");
  const bad = await setLimit("lots");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /dollar amount/);

  const ok = await (await setLimit("$750,000")).json();
  assert.equal(ok.limit, 750000);
  let access = await (await call(accessApi, "GET", "/api/admin/access", BOSS)).json();
  assert.deepEqual(access.limits, { "pat@synergyrealtors.com": 750000 });

  await setLimit("");
  access = await (await call(accessApi, "GET", "/api/admin/access", BOSS)).json();
  assert.deepEqual(access.limits, {}, "blank clears it");
});

test("homes over the limit come locked on the portal, and the server won't book them", async () => {
  for (const mls of ["21000001", "21000002"]) {
    const r = await call(inventoryApi, "PUT", "/api/inventory/listings", BOSS, { mls, offered: true, days: ALL_DAYS });
    assert.equal(r.status, 200);
  }
  // No limit: nothing locked, and the limit check never turns a request away.
  assert.deepEqual(await lockedOf(), { 21000001: false, 21000002: false });
  assert.notEqual((await book("21000001")).error, "over_limit");

  await setLimit("750000");
  assert.deepEqual(await lockedOf(), { 21000001: true, 21000002: false });
  const over = await call(requestsApi, "POST", "/api/requests", PAT, { mls: "21000001", day: "sat", from: 13, to: 15 });
  assert.equal(over.status, 403);
  const d = await over.json();
  assert.equal(d.error, "over_limit");
  assert.match(d.message, /^Reach out to a George & Noonan Team member to request an open home at this address\.$/);
  assert.notEqual((await book("21000002")).error, "over_limit", "under the limit books as usual");

  await setLimit("1,500,000"); // at the price exactly
  assert.deepEqual(await lockedOf(), { 21000001: false, 21000002: false });
  assert.notEqual((await book("21000001")).error, "over_limit");
});
