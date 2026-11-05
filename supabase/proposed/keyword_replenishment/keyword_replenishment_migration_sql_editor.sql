-- Keyword replenishment migration, for the Supabase SQL Editor.
-- The same SQL as supabase/proposed/20261105000001_keyword_replenishment.sql,
-- wrapped in one transaction: if any statement fails, nothing is changed.
-- Run keyword_replenishment_before.sql first and keyword_replenishment_verify.sql after.
-- Safe to run more than once. It only ADDS one table (with its security rules
-- and a daily-limit trigger) and lets the AI log record keyword-idea calls. No
-- keyword, recipe, Pin, setting or security rule of an existing table changes,
-- and nothing is deleted.

begin;

create table if not exists public.keyword_replenishments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.publishing_jobs (id) on delete set null,
  run_date date not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  usable_before integer not null check (usable_before >= 0),
  usable_after integer check (usable_after is null or usable_after >= 0),
  requested integer not null default 0 check (requested between 0 and 200),
  suggested integer not null default 0 check (suggested >= 0),
  inserted integer not null default 0 check (inserted >= 0),
  rejected integer not null default 0 check (rejected >= 0),
  -- Up to 60 screened-out ideas with the reason: [{ keyword, reason, detail }]
  rejections jsonb not null default '[]'::jsonb check (jsonb_typeof(rejections) = 'array'),
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists keyword_replenishments_date_idx on public.keyword_replenishments (run_date desc, started_at desc);

-- At most 2 tries per UTC day, and none once one succeeded that day.
create or replace function public.keyword_replenishments_daily_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Two workers starting at once still see each other's row.
  perform pg_advisory_xact_lock(hashtext('keyword_replenishments:' || new.run_date::text));
  if exists (select 1 from public.keyword_replenishments where run_date = new.run_date and status = 'succeeded') then
    raise exception 'The keyword queue was already topped up on %.', new.run_date using errcode = 'check_violation';
  end if;
  if (select count(*) from public.keyword_replenishments where run_date = new.run_date) >= 2 then
    raise exception 'Keyword top-up was already tried twice on %.', new.run_date using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'keyword_replenishments_daily_limit' and tgrelid = 'public.keyword_replenishments'::regclass) then
    create trigger keyword_replenishments_daily_limit
    before insert on public.keyword_replenishments
    for each row execute function public.keyword_replenishments_daily_limit();
  end if;
end $$;

alter table public.keyword_replenishments enable row level security;
revoke all on public.keyword_replenishments from public, anon, authenticated;
grant select on public.keyword_replenishments to authenticated;
-- The worker records and updates top-ups but can never delete the history.
revoke delete, truncate on public.keyword_replenishments from service_role;
grant select, insert, update on public.keyword_replenishments to service_role;

drop policy if exists "keyword_replenishments: admin read" on public.keyword_replenishments;
create policy "keyword_replenishments: admin read"
  on public.keyword_replenishments for select to authenticated
  using ((select public.is_admin()));

-- generation_attempts.kind: every earlier value plus 'keywords'.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.generation_attempts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.generation_attempts drop constraint %I', v_name);
  end loop;
end $$;

alter table public.generation_attempts
  add constraint generation_attempts_kind_check
  check (kind in ('recipe', 'review', 'repair', 'image', 'image_check', 'pin_image', 'pin_image_check', 'keywords'));

commit;
