import { json, currentUser, renewedSession } from "../lib/shared.mjs";

// Every signed-in page asks this first, so it's where a sign-in is renewed back to 90 days (shared.mjs).
// Someone removed from the access list gets 401 here and isn't renewed.
export default async (req) => {
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  const fresh = renewedSession(req);
  return json(200, user, fresh ? { "set-cookie": fresh } : {});
};
export const config = { path: "/api/me" };
