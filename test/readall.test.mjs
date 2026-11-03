import test from "node:test";
import assert from "node:assert/strict";
import { readAll } from "../netlify/lib/readall.mjs";

// A stand-in for a Netlify Blobs store that counts reads. `readEtag`/`readData` let a read lag behind the list.
function fakeStore(items) {
  const s = {
    items, reads: 0,
    list: async ({ prefix }) => ({ blobs: Object.entries(s.items).filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, etag: `"${v.etag}"` })) }),
    getWithMetadata: async (key) => {
      s.reads++;
      const v = s.items[key];
      return v ? { data: structuredClone(v.readData ?? v.data), etag: v.noEtag ? undefined : `"${v.readEtag ?? v.etag}"`, metadata: {} } : null;
    },
  };
  return s;
}
const values = (pairs) => pairs.map(([, v]) => v.n).sort((a, b) => a - b);

test("readAll reads each blob once while it is unchanged", async () => {
  const s = fakeStore({ "req/a": { etag: "1", data: { n: 1 } }, "req/b": { etag: "1", data: { n: 2 } }, "other/c": { etag: "1", data: { n: 3 } } });
  assert.deepEqual(values(await readAll(s, "one", "req/")), [1, 2]);
  assert.equal(s.reads, 2);
  assert.deepEqual(values(await readAll(s, "one", "req/")), [1, 2]);
  assert.equal(s.reads, 2); // nothing changed, nothing read

  s.items["req/a"] = { etag: "2", data: { n: 10 } };
  delete s.items["req/b"];
  s.items["req/d"] = { etag: "1", data: { n: 4 } };
  assert.deepEqual(values(await readAll(s, "one", "req/")), [4, 10]);
  assert.equal(s.reads, 4); // only the changed blob and the new one
});

test("readAll hands out copies, so changing a result changes nothing kept", async () => {
  const s = fakeStore({ "req/a": { etag: "1", data: { n: 1 } } });
  (await readAll(s, "two", "req/"))[0][1].n = 99;
  assert.deepEqual(values(await readAll(s, "two", "req/")), [1]);
});

test("readAll reads again when a lagging read returned an older copy", async () => {
  const s = fakeStore({ "req/a": { etag: "2", data: { n: 2 }, readEtag: "1", readData: { n: 1 } } });
  assert.deepEqual(values(await readAll(s, "three", "req/")), [1]); // the store hasn't caught up yet
  s.items["req/a"] = { etag: "2", data: { n: 2 } };
  assert.deepEqual(values(await readAll(s, "three", "req/")), [2]);
  assert.equal(s.reads, 2);
});

test("readAll never reuses a read that came without an etag", async () => {
  const s = fakeStore({ "req/a": { etag: "1", data: { n: 1 }, noEtag: true } });
  await readAll(s, "four", "req/");
  await readAll(s, "four", "req/");
  assert.equal(s.reads, 2);
});
