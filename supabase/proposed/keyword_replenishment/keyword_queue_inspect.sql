-- Run in the Supabase SQL Editor. Read-only: changes nothing.
-- Shows why the daily run of November 5, 2026 found no usable keyword: how many
-- keywords exist, what state they are in, and why the rest are left out.
-- Works before and after the keyword replenishment migration.

with s as (select max_keyword_difficulty as max_kd from public.automation_settings where id),
k as (select kw.*, s.max_kd from public.keywords kw cross join s)
select sort, check_name, value from (
  select 1 as sort, 'Keywords in total' as check_name, count(*)::text as value from k
  union all
  select 2, 'Status: ' || status::text, count(*)::text from k group by status
  union all
  select 3, 'USABLE NOW (what the daily run can pick)', count(*)::text from k
  where status = 'new' and assigned_recipe_id is null and attempt_count < 3 and (keyword_difficulty is null or keyword_difficulty <= max_kd)
  union all
  select 4, 'New, but harder than the max difficulty (' || coalesce((select max_kd::text from s), '?') || ')', count(*)::text from k
  where status = 'new' and attempt_count < 3 and keyword_difficulty > max_kd
  union all
  select 5, 'New, but skipped after 3 failed attempts', count(*)::text from k where status = 'new' and attempt_count >= 3
  union all
  select 6, 'Rejected: too similar to another keyword or recipe', count(*)::text from k where status = 'rejected' and last_error like 'Too similar%'
  union all
  select 7, 'Rejected: pork-free and alcohol-free rule', count(*)::text from k where status = 'rejected' and last_error like 'Rejected by the pork-free%'
  union all
  select 8, 'Rejected: failed 3 jobs or other reason', count(*)::text from k
  where status = 'rejected' and last_error is not null and last_error not like 'Too similar%' and last_error not like 'Rejected by the pork-free%'
  union all
  select 9, 'Rejected by hand in the admin', count(*)::text from k where status = 'rejected' and last_error is null
  union all
  select 10, 'Queued but held by a failed job of an earlier day', count(*)::text from k
  where status = 'queued' and exists (select 1 from public.publishing_jobs j where j.keyword_id = k.id and j.status = 'failed' and j.job_date < (now() at time zone 'utc')::date)
  union all
  select 11, 'Recipes in total (any status)', count(*)::text from public.recipes
  union all
  select 12, 'Job fd31343f: status and error', coalesce(max(status::text || ': ' || coalesce(error_message, '')), 'not found') from public.publishing_jobs where id = 'fd31343f-8d54-40bc-8b9c-265c312e1d0f'
) x
order by sort, check_name;
