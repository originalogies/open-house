import { json } from "./_lib.mjs";

export default async () => json(200, { googleClientId: process.env.GOOGLE_CLIENT_ID || null });
export const config = { path: "/api/config" };
