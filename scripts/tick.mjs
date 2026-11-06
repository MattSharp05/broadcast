// `pnpm tick`: runs one scheduler tick by calling POST /api/cron/tick, as pg_cron does every
// minute. Reads APP_URL and CRON_SECRET from the environment or .env.local; the app must be
// running (`pnpm dev` or `pnpm start`) with the same CRON_SECRET.
const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set. Add it to .env.local (and restart the app).");
  process.exit(1);
}

const res = await fetch(`${base}/api/cron/tick`, {
  method: "POST",
  headers: { "x-cron-secret": secret },
});
const body = await res.text();
let pretty = body;
try {
  pretty = JSON.stringify(JSON.parse(body), null, 2);
} catch {
  // Not JSON: print as is.
}
console.log(`POST ${base}/api/cron/tick → ${res.status}\n${pretty}`);
process.exit(res.ok ? 0 : 1);
