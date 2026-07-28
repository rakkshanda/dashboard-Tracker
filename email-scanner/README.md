# Gmail → `email_scan` scanner

This command reads Gmail with the read-only OAuth scope and upserts snapshots into
Supabase's `email_scan` staging table. It never reads or writes `jobs`.

## Setup

1. In Google Cloud, enable the Gmail API and create an OAuth client of type
   **Desktop app**. Download it as `email-scanner/credentials.json`.
2. Install the dependencies:

   ```sh
   python3 -m venv email-scanner/.venv
   email-scanner/.venv/bin/pip install -r email-scanner/requirements.txt
   ```

3. Export the Supabase **service-role** key in the shell (do not put it in this
   repository):

   ```sh
   export SUPABASE_SERVICE_KEY='...'
   ```

4. Run a dry scan first. The first run opens Google's OAuth consent flow; choose
   the Gmail account that should be scanned:

   ```sh
   email-scanner/.venv/bin/python email-scanner/scanner.py --dry-run
   ```

5. Upsert the rows:

   ```sh
   email-scanner/.venv/bin/python email-scanner/scanner.py
   ```

The default Gmail query is `newer_than:1d`. Override it with `--query`, for
example `--query "newer_than:7d"`. Use `--max-messages` to cap a backfill.
OAuth is cached in the gitignored `email-scanner/token.json`.

Run the offline tests with:

```sh
python3 -m unittest discover -s email-scanner/tests -v
```
