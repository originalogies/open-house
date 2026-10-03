import { json, currentUser } from "../lib/shared.mjs";

export default async (req) => {
  const user = await currentUser(req);
  return user ? json(200, user) : json(401, { error: "signed_out" });
};
export const config = { path: "/api/me" };
