# 0001: Next.js on Vercel + Supabase

## Context
Single user, $0 budget, a dashboard plus an API plus a scheduler. Matthew's other projects use React/TypeScript, Supabase and Vercel.

## Decision
Next.js 15 (App Router, TypeScript strict) on Vercel Hobby for the UI and API. Supabase (free tier) for Postgres, Auth (magic link, one allowed email), Storage and `pg_cron`.

## Consequences
- One codebase and one deploy. Local and CI testing use the Supabase Docker stack.
- Vercel function limits (time, 4.5 MB body) shape the design: short scheduler ticks, and uploads go straight to Storage.
- Free-tier limits: 500 MB of database and 1 GB of storage (video files are deleted after posting). A project pauses after 7 days of inactivity, which may cost $25/mo for Pro (open question).
