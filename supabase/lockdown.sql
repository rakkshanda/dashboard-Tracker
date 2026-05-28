-- Immediate containment for the Supabase warning raised on May 25, 2026.
-- This locks down the public tables used by this app until proper auth or
-- a server-side write path is in place.

begin;

alter table if exists public.jobs enable row level security;
alter table if exists public.app_kv enable row level security;

revoke all on table public.jobs from anon, authenticated;
revoke all on table public.app_kv from anon, authenticated;

drop policy if exists "public jobs read" on public.jobs;
drop policy if exists "public jobs insert" on public.jobs;
drop policy if exists "public jobs update" on public.jobs;
drop policy if exists "public jobs delete" on public.jobs;

drop policy if exists "public app_kv read" on public.app_kv;
drop policy if exists "public app_kv insert" on public.app_kv;
drop policy if exists "public app_kv update" on public.app_kv;
drop policy if exists "public app_kv delete" on public.app_kv;

commit;

-- After this runs, browser clients using the anon key will stop working
-- against these tables until you add either:
-- 1. Supabase Auth + restrictive RLS policies, or
-- 2. a backend that uses the service role key server-side.
