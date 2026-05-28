# Supabase Security Note

The Supabase alert dated May 25, 2026 is consistent with how this repo is wired today.

Current exposure in this repo:

- [popup.js](/Users/rakshanda/save-jobs-extension/popup.js) writes directly to `public.jobs` with the public `anon` key.
- [dashy.html](/Users/rakshanda/save-jobs-extension/dashy.html) reads and mutates `public.jobs` and `public.app_kv` from the browser.
- [sticky-schedule/index.html](/Users/rakshanda/save-jobs-extension/sticky-schedule/index.html) and [sticky-schedule/sticky_web.html](/Users/rakshanda/save-jobs-extension/sticky-schedule/sticky_web.html) read and write `public.app_kv` from the browser.

Why the warning is real:

- Supabase's public `anon` key is safe to expose only when RLS is enabled and policies restrict access.
- If `public.jobs` or `public.app_kv` has RLS disabled, anyone with the project URL and public key can use the REST API against that table.
- Enabling RLS with permissive `TO anon USING (true)` policies would not actually solve this, because this app currently has no user authentication layer.

Immediate containment:

1. Open Supabase SQL Editor.
2. Run [supabase/lockdown.sql](/Users/rakshanda/save-jobs-extension/supabase/lockdown.sql).
3. Confirm the alert clears for the affected tables.

Impact of containment:

- The current browser-based app flow will stop being able to read and write those tables until access is redesigned.

Real fix options:

1. Add Supabase Auth and write proper per-user RLS policies.
2. Move writes and sensitive reads behind a backend that uses the service role key server-side only.

Without one of those changes, there is no secure way to keep the current "any browser with the public key can fully edit shared tables" model.
