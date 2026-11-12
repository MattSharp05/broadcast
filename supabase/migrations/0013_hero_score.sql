-- The hero-assets skill's rubric for a proposal ("focal=1 secs=3.5 frame=close …"): stored as
-- sent, shown on the page and in the decisions export (the skill learns by grouping on it).
alter table public.hero_proposals add column score text not null default '';
