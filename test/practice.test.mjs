import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BlobsServer } from "@netlify/blobs/server";

// The practice feedback form: the sample open house's link opens the real form for anyone signed in, and what they
// send is checked like real feedback but never saved or emailed. Against a local Blobs server and a stand-in Resend.
process.env.SESSION_SECRET = "x".repeat(40);
process.env.ADMIN_EMAILS = "boss@synergyrealtors.com";
process.env.TEAM_EMAILS = "";
process.env.ALLOWED_DOMAINS = "synergyrealtors.com";
process.env.RESEND_API_KEY = "resend-key";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-practice-"));
const blobs = new BlobsServer({ directory: dir, token: "t" });
const { port } = await blobs.start();
const edge = `http://localhost:${port}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: "test", token: "t" })).toString("base64");
after(async () => { await blobs.stop(); await fs.rm(dir, { recursive: true, force: true }); });

const emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === "https://api.resend.com/emails") { emails.push(JSON.parse(init.body)); return Response.json({ id: "em" }); }
  return realFetch(url, init);
};

const { makeSession } = await import("../netlify/lib/shared.mjs");
const { getRequest } = await import("../netlify/lib/requests.mjs");
const { PRACTICE_ID, isPractice } = await import("../netlify/lib/feedback.mjs");
const { sampleOpenHouse } = await import("../netlify/lib/email-previews.mjs");
const feedback = (await import("../netlify/functions/feedback.mjs")).default;

const ORIGIN = "http://localhost:8888";
const agent = { cookie: `oh_session=${makeSession({ email: "pat@synergyrealtors.com", name: "Pat Agent" })}`, origin: ORIGIN };
const get = (headers) => feedback(new Request(`${ORIGIN}/api/feedback?id=${PRACTICE_ID}`, { headers }));
const post = (headers, body) => feedback(new Request(`${ORIGIN}/api/feedback`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }));

test("the sample open house's link is the practice form", async () => {
  const { sample } = await sampleOpenHouse();
  assert.ok(isPractice(sample().id));
  assert.ok(!isPractice("abc"));
});

test("anyone signed in gets the practice form open, on a home hosted today", async () => {
  const r = await get(agent);
  assert.equal(r.status, 200);
  const o = await r.json();
  assert.equal(o.practice, true);
  assert.equal(o.open, true);
  assert.equal(o.feedback, null);
  assert.ok(o.addr);
  assert.equal((await get({})).status, 401); // still needs sign-in
});

test("practice sends are checked like real ones, then nothing is saved or emailed", async () => {
  const bad = await post(agent, { id: PRACTICE_ID, visitors: "", interest: "some", price: "right" });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /groups/);

  const ok = await post(agent, { id: PRACTICE_ID, visitors: 3, interest: "some", price: "right", liked: "The kitchen", disliked: "", forSeller: "", teamNotes: "" });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, practice: true });
  assert.equal(emails.length, 0);
  assert.equal(await getRequest(PRACTICE_ID), null);

  // And again: practice never becomes "already sent".
  assert.equal((await post(agent, { id: PRACTICE_ID, visitors: 0, interest: "little", price: "none" })).status, 200);
});

test("photos can't be added to the practice form", async () => {
  const r = await post(agent, { id: PRACTICE_ID, action: "photo", data: "data:image/jpeg;base64,AAAA" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "practice");
});
