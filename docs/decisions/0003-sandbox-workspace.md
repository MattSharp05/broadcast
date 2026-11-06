# 0003: A Sandbox workspace with a fake provider for scenarios, e2e and QA

## Context
In batched QA mode, testing happens on production. Broadcast posts to real accounts, so scenarios must never touch real data or call Instagram.

## Decision
Every table carries `workspace_id`. The first migration creates two workspaces: **Live** and **Sandbox**. Sandbox accounts use the `fake` SocialProvider: deterministic and stored in the database, it "publishes" instantly or after N ticks, and can be told to fail. Scenarios (`?scenario=…`) reset and seed only the Sandbox, so they stay enabled in production. A workspace switcher in the rail shows which one you're in, and the Sandbox shows a persistent "Sandbox: example data" marker.

## Consequences
- QA links work on production with no risk to real accounts.
- e2e tests and live QA use the same scenarios.
- Every query must filter by workspace. Helpers in `src/lib/db` enforce it, and an integration test checks it.
