import { runSync } from "../lib/sync.mjs";

// Runs every minute and sends the next MLS job to the bot when one is due (see lib/sync.mjs).
// Start and Retry on a request page run the same thing right away.
export default async () => { await runSync(); };
export const config = { schedule: "* * * * *" };
