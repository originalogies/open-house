import { json, clearCookie, sameOrigin } from "../lib/shared.mjs";

export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  return json(200, { ok: true }, { "set-cookie": clearCookie() });
};
export const config = { path: "/api/auth/logout" };
