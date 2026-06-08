-- Run this in the Supabase SQL editor to create the tasks table.

create table if not exists public.tasks (
  id          uuid        primary key default gen_random_uuid(),
  text        text        not null default '',
  done        boolean     not null default false,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.tasks enable row level security;

-- Permissive anon access (matches existing app pattern)
create policy "anon all" on public.tasks
  for all to anon using (true) with check (true);
