import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BlobsServer } from "@netlify/blobs/server";

// The Listings page's Refresh (netlify/functions/inventory-listings.mjs), against a local Blobs server and a
// stand-in Repliers that counts how often it's asked for the agents' listings.
process.env.SESSION_SECRET = "x".repeat(40);
process.env.ADMIN_EMAILS = "boss@synergyrealtors.com";
process.env.TEAM_EMAILS = "";
process.env.ALLOWED_DOMAINS = "synergyrealtors.com";
process.env.REPLIERS_API_KEY = "repliers-key";
delete process.env.DOCUSEAL_API_KEY;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-refresh-"));
const blobs = new BlobsServer({ directory: dir, token: "t" });
const { port } = await blobs.start();
const edge = `http://localhost:${port}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: "test", token: "t" })).toString("base64");
after(async () => { await blobs.stop(); await fs.rm(dir, { recursive: true, force: true }); });

const repliers = { listingReads: 0, price: 1500000 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.hostname !== "api.repliers.io") return realFetch(url, init);
  if (u.searchParams.get("sortBy") === "updatedOnDesc") // the feed's newest change, for "Repliers has MLS changes up to"
    return Response.json({ listings: [{ updatedOn: "2026-11-12T10:13:34.000-00:00", timestamps: { repliersUpdatedOn: "2026-11-12T16:37:27.460Z" } }] });
  repliers.listingReads++;
  return Response.json({ numPages: 1, listings: [{ mlsNumber: "21413668", listPrice: String(repliers.price), status: "A",
    address: { streetNumber: "1704", streetName: "Overlook", streetSuffix: "Drive", city: "Southlake", zip: "76092" },
    details: { propertyType: "Residential", numBedrooms: 4, numBathrooms: 4, sqft: 4000 }, images: ["a.jpg"], openHouse: [] }] });
};

const { makeSession } = await import("../netlify/lib/shared.mjs");
const handler = (await import("../netlify/functions/inventory-listings.mjs")).default;
const cookie = `oh_session=${makeSession({ email: "boss@synergyrealtors.com", name: "Boss Person" })}`;
const get = async (q = "") => {
  const res = await handler(new Request(`https://open-house.synergyrealtors.com/api/inventory/listings${q}`, { headers: { cookie } }));
  assert.equal(res.status, 200);
  return res.json();
};
const price = (d) => d.listings.find((l) => l.mls === "21413668").price;

test("Refresh asks Repliers again and says when it checked; other loads reuse the 5-minute copy", async () => {
  const first = await get();
  assert.equal(repliers.listingReads, 1);
  assert.ok(Date.parse(first.checkedAt) <= Date.now(), "checkedAt is when the copy came from Repliers");
  assert.equal(first.feedUpdatedAt, "2026-11-12T16:13:34.000Z"); // 10:13 AM Central

  repliers.price = 1450000; // a price change on the MLS
  const again = await get();
  assert.equal(repliers.listingReads, 1, "a normal load uses the server's copy");
  assert.equal(again.checkedAt, first.checkedAt);
  assert.equal(price(again), 1500000);

  await new Promise((r) => setTimeout(r, 5));
  const fresh = await get("?fresh=1");
  assert.equal(repliers.listingReads, 2, "Refresh asks Repliers again");
  assert.ok(fresh.checkedAt > first.checkedAt, "and the checked time moves");
  assert.equal(price(fresh), 1450000);
});

test("a server copy older than what the page already showed is fetched again", async () => {
  const shown = await get();
  const reads = repliers.listingReads;
  await get(`?since=${encodeURIComponent(shown.checkedAt)}`);
  assert.equal(repliers.listingReads, reads, "same copy: no need to ask again");
  await get(`?since=${encodeURIComponent(new Date(Date.parse(shown.checkedAt) - 60000).toISOString())}`);
  assert.equal(repliers.listingReads, reads, "the page showed an older copy: this one is newer");
  // Another server instance showed the page a newer copy than this instance holds.
  const newer = await get(`?since=${encodeURIComponent(new Date(Date.parse(shown.checkedAt) + 1000).toISOString())}`);
  assert.equal(repliers.listingReads, reads + 1);
  assert.ok(newer.checkedAt > shown.checkedAt);
  await get("?since=not-a-date");
  assert.equal(repliers.listingReads, reads + 1, "a bad value is ignored");
});
