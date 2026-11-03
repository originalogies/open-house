// Reads every JSON blob under a prefix as [key, value] pairs. Listing a store gives each blob's etag, so
// blobs this function instance already read (Netlify keeps instances warm between calls) are reused while
// unchanged and only new or changed ones are fetched: once warm, a call costs one list, not one read per blob.
// Callers get their own copies, so changing a result never changes what's kept.
const kept = new Map(); // "store|prefix" -> Map(key -> { etag, value })
const tag = (e) => String(e || "").replace(/^W\//, "").replace(/"/g, ""); // list and read may quote etags differently

export async function readAll(store, name, prefix) {
  const { blobs } = await store.list({ prefix });
  const before = kept.get(`${name}|${prefix}`) || new Map(), now = new Map();
  await Promise.all(blobs.map(async ({ key, etag }) => {
    const hit = before.get(key);
    if (hit && hit.etag && hit.etag === tag(etag)) return now.set(key, hit); // reads without an etag are never reused
    const got = await store.getWithMetadata(key, { type: "json" });
    // Keep the etag of the copy actually read: if a lagging read returned an older copy, it won't match
    // the listed etag next time and is fetched again.
    if (got && got.data != null) now.set(key, { etag: tag(got.etag), value: got.data });
  }));
  kept.set(`${name}|${prefix}`, now);
  return [...now].map(([key, { value }]) => [key, structuredClone(value)]);
}
