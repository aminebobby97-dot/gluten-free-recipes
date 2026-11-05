-- Checks for the keyword replenishment migration. Run after all migrations,
-- the proposed migrations up to 20261105000001 and the seed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/keyword_replenishment_test.sql
-- Everything runs inside a transaction that is rolled back.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'reader@example.test');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-00000000000a');
insert into public.publishing_jobs (job_type, job_date, idempotency_key, status) values ('daily_recipe', '2026-11-06', 'test:2026-11-06', 'running');

set local role service_role;

-- 1. The worker records a try and a keyword-idea AI call.
insert into public.keyword_replenishments (job_id, run_date, usable_before)
select id, '2026-11-06', 4 from public.publishing_jobs where idempotency_key = 'test:2026-11-06';
insert into public.generation_attempts (job_id, kind, provider, model, prompt_version, status, cost_usd)
select id, 'keywords', 'anthropic', 'claude-opus-5-5', 'keywords-v1', 'succeeded', 0.12 from public.publishing_jobs where idempotency_key = 'test:2026-11-06';

-- 2. Earlier attempt kinds still work; unknown ones do not.
insert into public.generation_attempts (job_id, kind, provider, model, prompt_version, status)
select id, 'recipe', 'anthropic', 'claude-opus-5-5', 'recipe-v5', 'succeeded' from public.publishing_jobs where idempotency_key = 'test:2026-11-06';
do $$
begin
  begin
    insert into public.generation_attempts (job_id, kind, provider, model, prompt_version, status)
    select id, 'nonsense', 'anthropic', 'claude-opus-5-5', 'x', 'succeeded' from public.publishing_jobs where idempotency_key = 'test:2026-11-06';
    raise exception 'an unknown attempt kind was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 3. A second try on the same day is allowed, a third is not.
update public.keyword_replenishments set status = 'failed', error_message = 'test' where run_date = '2026-11-06';
insert into public.keyword_replenishments (run_date, usable_before) values ('2026-11-06', 4);
do $$
begin
  begin
    insert into public.keyword_replenishments (run_date, usable_before) values ('2026-11-06', 4);
    raise exception 'a third top-up on one day was allowed';
  exception when check_violation then null;
  end;
end $$;

-- 4. After a successful try, no more tries that day; the next day is fine.
insert into public.keyword_replenishments (run_date, usable_before, status) values ('2026-11-07', 2, 'succeeded');
do $$
begin
  begin
    insert into public.keyword_replenishments (run_date, usable_before) values ('2026-11-07', 40);
    raise exception 'a top-up after a successful one was allowed';
  exception when check_violation then null;
  end;
end $$;

-- 5. The worker cannot delete the history.
do $$
begin
  begin
    delete from public.keyword_replenishments;
    raise exception 'service_role deleted keyword top-ups';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 6. Admins read it; other signed-in users and visitors see nothing and cannot write.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  if (select count(*) from public.keyword_replenishments) <> 3 then raise exception 'the admin cannot read keyword top-ups'; end if;
  begin
    insert into public.keyword_replenishments (run_date, usable_before) values ('2026-11-08', 1);
    raise exception 'an admin inserted a keyword top-up directly';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  if (select count(*) from public.keyword_replenishments) <> 0 then raise exception 'a non-admin can read keyword top-ups'; end if;
end $$;
reset role;

set local role anon;
do $$
begin
  begin
    perform 1 from public.keyword_replenishments;
    raise exception 'anon can read keyword top-ups';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'keyword_replenishment_test: all checks passed';
rollback;
