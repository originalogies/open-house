import { getStore } from "@netlify/blobs";
import { DEFAULT_CUTOFF, normalizeCutoff, getWeek } from "./week.mjs";

const store = () => getStore("open-house-settings");

export async function getCutoff() {
  const saved = await store().get("cutoff", { type: "json" }).catch(() => null);
  return normalizeCutoff(saved) || DEFAULT_CUTOFF;
}
export const saveCutoff = (c) => store().setJSON("cutoff", c);

// The weekend open for requests under the current cutoff setting.
export async function currentWeek() {
  return getWeek(new Date(), await getCutoff());
}
