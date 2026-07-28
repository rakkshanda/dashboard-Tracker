-- ============================================================================
--  email_scan  —  staging / review table for Gmail-detected job emails
-- ============================================================================
--  Pipeline:
--    PRODUCER  (Codex, reading the *other* Gmail account) INSERTS rows here,
--              one per detected email, classified. Never writes to `jobs`.
--    CONSUMER  (dashy.html "Review scan" card) reads review_state='pending',
--              shows them grouped, and on "Approve & add" inserts the checked
--              rows into `jobs` and flips review_state to 'approved'
--              (or 'dismissed' via the Dismiss button).
--
--  Run this once in the Supabase SQL editor for project dmzonyrwdqzugsshcxgb.
-- ============================================================================

create table if not exists public.email_scan (
  id             bigint generated always as identity primary key,
  message_id     text unique,                       -- Gmail message id — DEDUP KEY, never insert twice
  category       text not null default 'misc',      -- application | rejection | update | misc
  status         text,                              -- Applied | Rejected | Interview | Assessment | Offer
  company        text,
  title          text,
  applied_date   date,                              -- when you applied (best guess ok)
  email_date     timestamptz,                       -- when the email arrived (drives card date + sort)
  subject        text,
  sender         text,
  body           text,                              -- plaintext snapshot so "view email" needs NO Gmail call
  classification text,                              -- short human note shown under each row
  job_id         text,
  source         text default 'Email',
  review_state   text not null default 'pending',   -- pending | approved | dismissed
  created_at     timestamptz not null default now()
);

create index if not exists email_scan_pending_idx
  on public.email_scan (review_state, email_date desc);

-- ---------------------------------------------------------------------------
--  Access model
-- ---------------------------------------------------------------------------
--  The dashboard talks to Supabase with the ANON key from the browser (same as
--  it already does for `jobs`): it needs to SELECT pending rows and UPDATE
--  review_state. The scanner should write with the SERVICE ROLE key server-side
--  (service role bypasses RLS, so it needs no policy).
--
--  These permissive policies mirror how `jobs` behaves in this personal app
--  today. If you ever apply supabase/lockdown.sql and move to Supabase Auth,
--  tighten these the same way.
-- ---------------------------------------------------------------------------
alter table public.email_scan enable row level security;

drop policy if exists email_scan_anon_read   on public.email_scan;
drop policy if exists email_scan_anon_update on public.email_scan;
drop policy if exists email_scan_anon_insert on public.email_scan;

-- dashboard reads the review list
create policy email_scan_anon_read on public.email_scan
  for select to anon, authenticated using (true);

-- dashboard flips review_state on approve/dismiss
create policy email_scan_anon_update on public.email_scan
  for update to anon, authenticated using (true) with check (true);

-- OPTIONAL: only needed if the scanner writes with the ANON key instead of the
-- service role key. Safer to write with the service role key and delete this.
create policy email_scan_anon_insert on public.email_scan
  for insert to anon, authenticated with check (true);
