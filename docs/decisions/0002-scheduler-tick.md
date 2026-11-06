# 0002: Scheduler = pg_cron calls an idempotent tick endpoint every minute

## Context
Posts must go out at their slot within about a minute. Vercel Hobby cron runs only once a day. Instagram processes a Reel container asynchronously (from seconds to minutes).

## Decision
A `pg_cron` job runs `pg_net.http_post` to `POST /api/cron/tick` every minute, with a `CRON_SECRET` header. Each tick:
1. claims due work with `UPDATE … SET status = … WHERE … RETURNING`;
2. advances each item one step (create container, poll it, publish, fetch stats, refresh a token);
3. returns within about 20 s.

Waiting happens between ticks, never inside one.

## Consequences
- No long-running functions, and safe to call twice: the claim and the stored `container_id` stop double posting.
- The core state machine is a pure function, unit tested; the handler is thin.
- If ticks stop (pg_cron disabled, project paused), the rail shows "Scheduler: last tick N min ago" in amber.
