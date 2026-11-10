import test from "node:test";
import assert from "node:assert/strict";
import { emailPreviews } from "../netlify/lib/email-previews.mjs";
import { capture, sendWithdrawn } from "../netlify/lib/email.mjs";

// Settings > Emails: every email the platform sends, built by the real code from a sample, and never sent.
test("every email previews, and nothing is sent", async () => {
  const realFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); throw new Error("no network in this test"); };
  try {
    const { emails } = await emailPreviews("Kelly Cawyer");
    assert.deepEqual([...new Set(emails.map((e) => e.group))],
      ["Request", "Approved", "Denied", "Reminder", "Feedback requested", "Feedback received", "Changes and cancellations", "Alerts for the team"]);
    assert.equal(emails.length, 14);
    for (const e of emails) assert.ok(e.subject && e.html.length > 100 && e.to && e.when, e.key);
    const by = Object.fromEntries(emails.map((e) => [e.key, e]));
    assert.match(by.confirmed.subject, /^Confirmed: open house at /);
    assert.match(by.confirmed.html, /Sample: lockbox on the front door/); // sample access details, never a real home's
    assert.deepEqual(by.confirmed.attachments, ["open-house.ics"]);
    assert.match(by.declined.html, /Sample: the sellers will be home that day/);
    assert.match(by["feedback-remind"].subject, /^Reminder: how did your open house/);
    // The feedback request and its reminder use template 5, laid out like the Confirmed email: logo, photo, details, button.
    for (const k of ["feedback-ask", "feedback-remind"]) {
      const h = by[k].html;
      assert.match(h, /gn-logo\.png/, k);
      assert.match(h, /\/\.netlify\/images\?url(=|&#x3D;)/, k); // Handlebars writes = as &#x3D; in links
      assert.match(h, /href="https:\/\/open-house\.synergyrealtors\.com\/feedback\/\?id(=|&#x3D;)sample0+"[^>]*>Leave feedback</, k);
      assert.match(h, /Date and time/, k);
      assert.doesNotMatch(h, /Sample: lockbox|\{\{/, k); // no access details, no unfilled fields
    }
    assert.match(by["feedback-ask"].html, /How did your open house go\?/);
    assert.match(by["feedback-remind"].html, /We&#x27;d still love to hear how it went|We'd still love to hear how it went/);
    assert.doesNotMatch(by["feedback-ask"].html, /still love to hear/);
    assert.match(by["feedback-team"].html, /Sample: the open kitchen/);
    assert.ok(!calls.some((u) => u.includes("resend")), "no email was sent");
  } finally { globalThis.fetch = realFetch; }
});

test("a real email sent while a preview is being built still goes out", async () => {
  const realFetch = globalThis.fetch, key = process.env.RESEND_API_KEY, sent = [];
  process.env.RESEND_API_KEY = "test-key";
  globalThis.fetch = async (url, o) => { sent.push(JSON.parse(o.body).subject); return new Response("{}"); };
  const r = { id: "x", iso: "2026-11-14", from: 13, to: 15, mls: "1", agent: { name: "Pat Lee", email: "pat@example.com" }, listing: { addr: "1 Oak Lane", city: "Southlake" } };
  try {
    const [kept] = await Promise.all([
      capture(async () => { await new Promise((ok) => setTimeout(ok, 5)); await sendWithdrawn(r, "Kelly", false); }),
      sendWithdrawn(r, "Kelly", false),                                                   // outside the preview: really sent
    ]);
    assert.equal(kept.length, 1);
    assert.deepEqual(sent, [kept[0].subject]);
  } finally { globalThis.fetch = realFetch; if (key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = key; }
});
