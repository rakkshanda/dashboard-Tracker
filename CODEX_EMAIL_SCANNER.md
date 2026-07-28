# Codex task — build the Gmail → Supabase job-email scanner

You are implementing the **producer** half of a job-application tracker. The **consumer**
half (a dashboard "Review scan" card) is already built and deployed by someone else — do
**not** touch it. Your job: read a Gmail inbox, classify each recent email, and insert one
row per email into a Supabase table called `email_scan`. That's it. The human reviews and
approves rows in the dashboard; approval (not you) is what promotes a row into the real
`jobs` table.

**Never write to the `jobs` table. Only insert into `email_scan`.**

---

## Architecture (how your piece fits)

```
   [ the other Gmail account ]                  YOU BUILD THIS
             │  Gmail API (your OAuth)      ┌────────────────────────┐
             ▼                              │  scanner script        │
   "Thank you for applying…"  ───────────► │  read → classify →     │
   "Unfortunately…"                        │  upsert into email_scan │
   "Schedule your interview…"              └───────────┬────────────┘
                                                       │ Supabase (service role key)
                                                       ▼
                                            public.email_scan  (review_state='pending')
                                                       │
                                                       ▼   (already built — not your job)
                                            Dashboard "Review scan" card →
                                            user checks rows → "Approve & add" →
                                            inserts into public.jobs
```

---

## The contract — `email_scan` table (already created)

Table `public.email_scan` in Supabase project `dmzonyrwdqzugsshcxgb`. Insert rows with
exactly these columns (extras are ignored, missing ones are fine/null):

| column          | type        | what to put in it                                                        |
|-----------------|-------------|--------------------------------------------------------------------------|
| `message_id`    | text UNIQUE | Gmail message id. **Dedup key** — upsert on this, never insert twice.     |
| `category`      | text        | one of: `application` \| `rejection` \| `update` \| `misc`               |
| `status`        | text        | finer status: `Applied` \| `Rejected` \| `Interview` \| `Assessment` \| `Offer` |
| `company`       | text        | employer name (best extraction)                                          |
| `title`         | text        | role/job title if present                                                |
| `applied_date`  | date        | date applied if stated, else the email's date (`YYYY-MM-DD`)             |
| `email_date`    | timestamptz | when the email arrived (ISO 8601). Drives the card's date + sort order.  |
| `subject`       | text        | email subject                                                            |
| `sender`        | text        | From header                                                              |
| `body`          | text        | **plaintext** body snapshot, truncate to ~6000 chars. Powers "view email" with no live Gmail call. |
| `classification`| text        | one short human line shown under the row, e.g. `application confirmed` / `rejection — not moving forward` / `not job-related — will be ignored` |
| `job_id`        | text        | ATS/job id if you can parse one, else empty                              |
| `source`        | text        | leave as `Email` (the table default)                                     |
| `review_state`  | text        | leave as `pending` (the table default). Do **not** set approved/dismissed. |

The dashboard groups rows by `category` into chips (emails / applications / rejections /
updates / misc). Only `application`, `rejection`, and `update` rows get a checkbox the user
can approve; `misc` is shown for transparency and ignored.

---

## Classification rules

For each email decide `category` + `status`, then extract `company` / `title`.

- **application** — an application confirmation / acknowledgement.
  Signals: "thank you for applying", "we received your application", "application submitted",
  "thanks for your interest … we received your application", "application confirmation".
  → `status = Applied`.
- **rejection** — a decline.
  Signals: "unfortunately", "we have decided not to move forward / not to proceed",
  "we will not be moving forward", "pursuing other candidates", "won't be advancing".
  → `status = Rejected`.
- **update** — a real forward step that needs action.
  Signals: interview invite / scheduling, online assessment / coding test / HackerRank /
  Codility, recruiter screen, "next steps", offer.
  → `status = Interview` | `Assessment` | `Offer` as appropriate.
- **misc** — everything else: OTP / "security code for your application", job-alert blasts
  ("10 more jobs for you… apply now"), newsletters, promotions, generic marketing.
  → `status` null, `classification = "not job-related — will be ignored"`.

Notes / gotchas seen in this inbox:
- Greenhouse sends **"Security code for your application to X"** — that's an OTP → **misc**,
  not an application.
- The same role can send **duplicate** confirmations (e.g. multiple "Thank you for applying
  to Rocket Money") — the `message_id` unique upsert handles that; still, prefer to keep the
  earliest per (company,title) if you dedupe further.
- Extract `company` from the subject/sender first ("Thank you for applying to **EnergyHub**",
  `no-reply@**anduril**.com`), fall back to the body.

You may classify with heuristics or an LLM — your choice. If you use an LLM, ask it to return
strict JSON `{category, status, company, title, job_id, classification}` per email.

---

## Supabase connection

- **URL:** `https://dmzonyrwdqzugsshcxgb.supabase.co`
- **Key:** use the **service_role** key (Supabase dashboard → Project Settings → API →
  `service_role`). It bypasses RLS, which is what you want for a server-side writer.
  Put it in an env var (e.g. `SUPABASE_SERVICE_KEY`); **never commit it or print it.**
- Insert with an **upsert on `message_id`** so re-running the scan is idempotent.

REST upsert (no SDK needed):

```
POST https://dmzonyrwdqzugsshcxgb.supabase.co/rest/v1/email_scan?on_conflict=message_id
Headers:
  apikey: $SUPABASE_SERVICE_KEY
  Authorization: Bearer $SUPABASE_SERVICE_KEY
  Content-Type: application/json
  Prefer: resolution=merge-duplicates,return=minimal
Body: [ { ...one object per email with the columns above... } ]
```

---

## Gmail access

Use the Gmail API for the **other** account (the one this dashboard's operator is NOT scanning
elsewhere). Standard path: a Desktop-app OAuth client → `credentials.json` → run once to cache
`token.json` (scope `gmail.readonly`). Gitignore both; never print them.

Scan window: run on demand or on a cron; scope to recent mail (e.g. `newer_than:1d`, or since
your last successful run). For each message pull: `message_id`, `From`, `Subject`, internal
date, and the plaintext body (walk the MIME parts; strip HTML if only HTML exists).

---

## Reference skeleton (Python — adapt freely, verify the current library APIs first)

```python
import os, base64, requests
from googleapiclient.discovery import build
# ... auth: load token.json / run InstalledAppFlow with gmail.readonly ...

SB_URL = "https://dmzonyrwdqzugsshcxgb.supabase.co"
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"]

def plaintext(payload) -> str:
    # walk parts, prefer text/plain; fall back to stripped text/html; cap ~6000 chars
    ...

def classify(subject, sender, body) -> dict:
    # -> {"category","status","company","title","job_id","classification"}
    ...

def scan(query="newer_than:1d"):
    gmail = build("gmail", "v1", credentials=creds)
    ids = gmail.users().messages().list(userId="me", q=query).execute().get("messages", [])
    rows = []
    for m in ids:
        msg = gmail.users().messages().get(userId="me", id=m["id"], format="full").execute()
        h = {x["name"].lower(): x["value"] for x in msg["payload"].get("headers", [])}
        body = plaintext(msg["payload"])
        c = classify(h.get("subject",""), h.get("from",""), body)
        rows.append({
            "message_id": m["id"],
            "category": c["category"], "status": c.get("status"),
            "company": c.get("company"), "title": c.get("title"),
            "job_id": c.get("job_id"), "classification": c.get("classification"),
            "subject": h.get("subject",""), "sender": h.get("from",""),
            "email_date": to_iso(int(msg["internalDate"])),      # ms epoch -> ISO
            "applied_date": to_date(int(msg["internalDate"])),   # YYYY-MM-DD
            "body": body[:6000],
        })
    if rows:
        requests.post(
            f"{SB_URL}/rest/v1/email_scan?on_conflict=message_id",
            headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                     "Content-Type": "application/json",
                     "Prefer": "resolution=merge-duplicates,return=minimal"},
            json=rows, timeout=30).raise_for_status()

if __name__ == "__main__":
    scan()
```

---

## Definition of done

1. Running the scanner inserts one `email_scan` row per recent email, correctly classified,
   with `review_state='pending'` and a plaintext `body` snapshot.
2. Re-running it does **not** create duplicates (upsert on `message_id`).
3. You never wrote to `jobs`.
4. Open the dashboard: the "Review scan" card shows your rows grouped with correct chip
   counts; "view email" renders the stored body; checking applications + "Approve & add"
   moves them into the jobs table. (That half already works — your rows just need to match
   the contract above.)
