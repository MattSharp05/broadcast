-- One open review batch per video (BC-36): Send notes is refused while a batch is with Claude, and
-- this makes two sends at once (a double click, two tabs) fail instead of starting two sessions.
create unique index review_batches_one_open_idx on public.review_batches (production_id)
  where status in ('sent', 'running');
