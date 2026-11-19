import { json, clearCookie, sameOrigin, readSession } from "../lib/shared.mjs";
import { recordSignIn } from "../lib/signins.mjs";

export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const s = readSession(req);
  if (s) await recordSignIn(req, { result: "signed_out", email: s.email, name: s.name }); // the Sign-ins page shows it
  return json(200, { ok: true }, { "set-cookie": clearCookie(req) });
};
export const config = { path: "/api/auth/logout" };
