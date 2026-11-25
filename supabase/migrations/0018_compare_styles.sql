-- Style picking (BC-41): a video can ask its style step for the same beat in 2–3 styles and pick
-- one from the frames. compare_styles is on by default for a video without a style; candidates are
-- the styles Matthew ticked (empty: the session picks them from the brief).
alter table public.productions
  add column compare_styles boolean not null default false,
  add column style_candidates text[] not null default '{}';
