-- Local seed, run by `pnpm db:reset` after the migrations.
-- The Live and Sandbox workspaces (and their settings rows) come from 0001_schema.sql, because
-- production needs them too. Sandbox example data is loaded by scenarios (BC-8), not here.
select 1;
