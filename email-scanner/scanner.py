#!/usr/bin/env python3
"""Read-only Gmail scanner that writes only to Supabase public.email_scan."""

from __future__ import annotations

import argparse
import base64
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
from email.utils import parseaddr
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
SUPABASE_URL = "https://dmzonyrwdqzugsshcxgb.supabase.co"
ROOT = Path(__file__).resolve().parent
DEFAULT_CREDENTIALS = ROOT / "credentials.json"
DEFAULT_TOKEN = ROOT / "token.json"
BODY_LIMIT = 6000


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self._ignored_depth += 1
        elif not self._ignored_depth and tag in {"br", "p", "div", "li", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._ignored_depth:
            self._ignored_depth -= 1
        elif not self._ignored_depth and tag in {"p", "div", "li", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)


def html_to_text(value: str) -> str:
    parser = _TextExtractor()
    parser.feed(value)
    return clean_text(html.unescape("".join(parser.parts)))


def clean_text(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def _decode(data: str | None) -> str:
    if not data:
        return ""
    try:
        raw = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
        return raw.decode("utf-8", errors="replace")
    except (ValueError, TypeError):
        return ""


def plaintext(payload: dict[str, Any]) -> str:
    """Walk a Gmail MIME payload, preferring text/plain over HTML."""
    plain: list[str] = []
    rich: list[str] = []

    def walk(part: dict[str, Any]) -> None:
        mime = (part.get("mimeType") or "").lower()
        data = (part.get("body") or {}).get("data")
        if data and mime == "text/plain":
            plain.append(_decode(data))
        elif data and mime == "text/html":
            rich.append(_decode(data))
        for child in part.get("parts") or []:
            walk(child)

    walk(payload)
    selected = clean_text("\n".join(plain))
    if not selected:
        selected = html_to_text("\n".join(rich))
    return selected[:BODY_LIMIT]


def _sender_company(sender: str) -> str | None:
    display, address = parseaddr(sender)
    if display and not re.search(r"no.?reply|notifications?|recruiting|talent", display, re.I):
        return display.strip("\" ")
    domain = address.rsplit("@", 1)[-1].lower() if "@" in address else ""
    labels = [x for x in domain.split(".") if x]
    ignored = {
        "gmail", "google", "outlook", "hotmail", "yahoo", "mail", "greenhouse",
        "lever", "workday", "ashbyhq", "smartrecruiters", "myworkdayjobs",
    }
    candidates = [x for x in labels[:-1] if x not in ignored and x not in {"www", "jobs", "careers"}]
    return candidates[-1].replace("-", " ").title() if candidates else None


def extract_company(subject: str, sender: str, body: str) -> str | None:
    patterns = [
        r"(?:applying|application) (?:to|at|with) ([A-Z][\w&.'’+\- ]{1,60})",
        r"(?:interest in|joining) ([A-Z][\w&.'’+\- ]{1,60})",
        r"(?:from|with) ([A-Z][\w&.'’+\- ]{1,60})(?:[|:!\-]|$)",
    ]
    for source in (subject, body[:1200]):
        for pattern in patterns:
            match = re.search(pattern, source, re.I)
            if match:
                company = re.split(
                    r"\s+(?:for|regarding|as|on the|position|role)\b|[|:!\n]",
                    match.group(1),
                    maxsplit=1,
                    flags=re.I,
                )[0].strip(" .,-")
                if 1 < len(company) <= 80:
                    return company
    return _sender_company(sender)


def extract_title(subject: str, body: str) -> str | None:
    patterns = [
        r"(?:position|role|job)(?: of|:)?\s+([^\n|]{2,100})",
        r"(?:application for|applied for|candidacy for)\s+([^\n|]{2,100})",
        r"^([^\n|:]{2,100})\s+(?:application|interview|assessment)",
    ]
    for source in (subject, body[:1800]):
        for pattern in patterns:
            match = re.search(pattern, source, re.I)
            if match:
                title = re.split(
                    r"\s+(?:at|with|position at)\s+|[.!]\s",
                    match.group(1),
                    maxsplit=1,
                    flags=re.I,
                )[0].strip(" .,-")
                title = re.sub(r"^(?:the|a|an)\s+", "", title, flags=re.I)
                title = re.sub(r"\s+(?:position|role)$", "", title, flags=re.I)
                if 1 < len(title) <= 120:
                    return title
    return None


def extract_job_id(text: str) -> str | None:
    match = re.search(
        r"\b(?:job|requisition|req)(?:\s+(?:id|number|no\.?))?\s*[:#-]\s*([A-Z0-9][A-Z0-9_-]{2,30})",
        text,
        re.I,
    )
    return match.group(1) if match else None


def classify(subject: str, sender: str, body: str) -> dict[str, str | None]:
    combined = clean_text(f"{subject}\n{sender}\n{body}")
    lower = combined.lower()
    otp = re.search(
        r"\b(?:security|verification|one[- ]time|authentication)\s+code\b|\botp\b|"
        r"\bcode\s+(?:is|expires)\b",
        lower,
    )
    job_alert = re.search(
        r"\bjob alerts?\b|\bjobs? (?:for you|you may like|matching your profile)\b|"
        r"\bnew jobs?\b.*\bapply now\b|unsubscribe",
        lower,
    )
    rejection = re.search(
        r"\bunfortunately\b|not (?:be )?moving forward|not (?:to )?proceed|"
        r"pursu(?:e|ing) other candidates|won['’]?t be advancing|"
        r"decided not to (?:advance|continue|move forward)",
        lower,
    )
    application = re.search(
        r"thank(?:s| you) for applying|we (?:have )?received your application|"
        r"application (?:was )?submitted|application confirmation|"
        r"application (?:has been )?received|successfully applied",
        lower,
    )
    offer = re.search(
        r"\b(?:job|employment|formal) offer\b|offer of employment|pleased to offer",
        lower,
    )
    assessment = re.search(
        r"\b(?:online|technical|coding) assessment\b|\bcoding (?:test|challenge)\b|"
        r"\bhackerrank\b|\bcodility\b|\bassessment (?:invite|invitation)\b",
        lower,
    )
    interview = re.search(
        r"\binterview (?:invite|invitation|request|schedule|availability)\b|"
        r"\bschedule (?:an?|your) interview\b|\brecruiter (?:screen|call)\b|"
        r"\bphone screen\b|\bnext steps?\b",
        lower,
    )

    if otp or (job_alert and not (rejection or application or offer or assessment or interview)):
        category, status, note = "misc", None, "not job-related — will be ignored"
    elif rejection:
        category, status, note = "rejection", "Rejected", "rejection — not moving forward"
    elif offer:
        category, status, note = "update", "Offer", "offer received"
    elif assessment:
        category, status, note = "update", "Assessment", "assessment — action needed"
    elif interview:
        category, status, note = "update", "Interview", "interview — action needed"
    elif application:
        category, status, note = "application", "Applied", "application confirmed"
    else:
        category, status, note = "misc", None, "not job-related — will be ignored"

    return {
        "category": category,
        "status": status,
        "company": extract_company(subject, sender, body),
        "title": extract_title(subject, body),
        "job_id": extract_job_id(combined),
        "classification": note,
    }


def gmail_credentials(credentials_path: Path, token_path: Path) -> Any:
    try:
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError as exc:
        raise RuntimeError(
            "Gmail dependencies are missing; install email-scanner/requirements.txt"
        ) from exc

    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(GoogleRequest())
        else:
            if not credentials_path.exists():
                raise FileNotFoundError(f"OAuth client file not found: {credentials_path}")
            creds = InstalledAppFlow.from_client_secrets_file(
                str(credentials_path), SCOPES
            ).run_local_server(port=0)
        token_path.write_text(creds.to_json(), encoding="utf-8")
        try:
            token_path.chmod(0o600)
        except OSError:
            pass
    return creds


def list_message_ids(gmail: Any, query: str, maximum: int | None) -> list[str]:
    ids: list[str] = []
    page_token = None
    while maximum is None or len(ids) < maximum:
        remaining = 500 if maximum is None else min(500, maximum - len(ids))
        response = (
            gmail.users()
            .messages()
            .list(userId="me", q=query, maxResults=remaining, pageToken=page_token)
            .execute()
        )
        ids.extend(item["id"] for item in response.get("messages", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return ids[:maximum] if maximum is not None else ids


def message_to_row(message: dict[str, Any]) -> dict[str, Any]:
    payload = message.get("payload") or {}
    headers = {
        item.get("name", "").lower(): item.get("value", "")
        for item in payload.get("headers") or []
    }
    body = plaintext(payload)
    subject, sender = headers.get("subject", ""), headers.get("from", "")
    detected = classify(subject, sender, body)
    received = datetime.fromtimestamp(
        int(message["internalDate"]) / 1000, tz=timezone.utc
    )
    return {
        "message_id": message["id"],
        "category": detected["category"],
        "status": detected["status"],
        "company": detected["company"],
        "title": detected["title"],
        "applied_date": received.date().isoformat(),
        "email_date": received.isoformat().replace("+00:00", "Z"),
        "subject": subject,
        "sender": sender,
        "body": body,
        "classification": detected["classification"],
        "job_id": detected["job_id"],
        "source": "Email",
    }


def chunks(rows: list[dict[str, Any]], size: int = 100) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def upsert(rows: list[dict[str, Any]], service_key: str) -> None:
    url = f"{SUPABASE_URL}/rest/v1/email_scan?on_conflict=message_id"
    for batch in chunks(rows):
        request = Request(
            url,
            data=json.dumps(batch).encode("utf-8"),
            method="POST",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                if response.status not in {200, 201, 204}:
                    raise RuntimeError(f"Unexpected Supabase response: HTTP {response.status}")
        except HTTPError as exc:
            detail = exc.read(1000).decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase upsert failed: HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Supabase upsert failed: {exc.reason}") from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", default="newer_than:1d", help="Gmail search query")
    parser.add_argument("--max-messages", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true", help="scan and classify without writing")
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument("--token", type=Path, default=DEFAULT_TOKEN)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.max_messages is not None and args.max_messages < 1:
        print("--max-messages must be at least 1", file=sys.stderr)
        return 2
    if not args.dry_run and not os.environ.get("SUPABASE_SERVICE_KEY"):
        print("SUPABASE_SERVICE_KEY is required unless --dry-run is used", file=sys.stderr)
        return 2
    try:
        from googleapiclient.discovery import build

        creds = gmail_credentials(args.credentials, args.token)
        gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)
        ids = list_message_ids(gmail, args.query, args.max_messages)
        rows = []
        for message_id in ids:
            message = (
                gmail.users()
                .messages()
                .get(userId="me", id=message_id, format="full")
                .execute()
            )
            rows.append(message_to_row(message))
        counts = {name: 0 for name in ("application", "rejection", "update", "misc")}
        for row in rows:
            counts[row["category"]] += 1
        summary = ", ".join(f"{name}={count}" for name, count in counts.items())
        print(f"Scanned {len(rows)} message(s): {summary}")
        if args.dry_run:
            print("Dry run complete; no Supabase rows were written.")
        elif rows:
            upsert(rows, os.environ["SUPABASE_SERVICE_KEY"])
            print(f"Upserted {len(rows)} row(s) into email_scan.")
        else:
            print("No matching messages; nothing to write.")
        return 0
    except Exception as exc:
        print(f"Scanner failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
