import base64
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "scanner.py"
SPEC = importlib.util.spec_from_file_location("email_scanner", MODULE_PATH)
scanner = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(scanner)


def encoded(value):
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


class ClassificationTests(unittest.TestCase):
    def test_application(self):
        result = scanner.classify(
            "Thank you for applying to EnergyHub",
            "EnergyHub Recruiting <no-reply@energyhub.com>",
            "We received your application for the Software Engineer position.",
        )
        self.assertEqual(("application", "Applied"), (result["category"], result["status"]))
        self.assertEqual("EnergyHub", result["company"])
        self.assertEqual("Software Engineer", result["title"])

    def test_greenhouse_security_code_is_misc(self):
        result = scanner.classify(
            "Security code for your application to Acme",
            "no-reply@greenhouse.io",
            "Your verification code is 123456.",
        )
        self.assertEqual(("misc", None), (result["category"], result["status"]))

    def test_rejection_beats_generic_next_steps(self):
        result = scanner.classify(
            "Update on your application",
            "Acme Recruiting <jobs@acme.com>",
            "Unfortunately, we will not be moving forward. Thank you for taking the next steps.",
        )
        self.assertEqual(("rejection", "Rejected"), (result["category"], result["status"]))

    def test_assessment(self):
        result = scanner.classify(
            "Coding assessment invitation",
            "recruiting@anduril.com",
            "Complete this HackerRank challenge. Job ID: ENG-1234",
        )
        self.assertEqual(("update", "Assessment"), (result["category"], result["status"]))
        self.assertEqual("ENG-1234", result["job_id"])

    def test_job_alert_is_misc(self):
        result = scanner.classify(
            "10 new jobs for you",
            "alerts@example.com",
            "Jobs matching your profile. Apply now. Unsubscribe here.",
        )
        self.assertEqual("misc", result["category"])


class MessageTests(unittest.TestCase):
    def test_plaintext_prefers_plain_and_decodes_html_fallback(self):
        payload = {
            "mimeType": "multipart/alternative",
            "parts": [
                {"mimeType": "text/plain", "body": {"data": encoded("Plain body")}},
                {"mimeType": "text/html", "body": {"data": encoded("<p>HTML body</p>")}},
            ],
        }
        self.assertEqual("Plain body", scanner.plaintext(payload))
        self.assertEqual(
            "Hello\nworld",
            scanner.plaintext(
                {"mimeType": "text/html", "body": {"data": encoded("<p>Hello<br>world</p>")}}
            ),
        )

    def test_row_matches_contract_without_review_state(self):
        timestamp = int(datetime(2026, 7, 23, tzinfo=timezone.utc).timestamp() * 1000)
        message = {
            "id": "gmail-1",
            "internalDate": str(timestamp),
            "payload": {
                "mimeType": "text/plain",
                "headers": [
                    {"name": "Subject", "value": "Application confirmation"},
                    {"name": "From", "value": "jobs@acme.com"},
                ],
                "body": {"data": encoded("We received your application for role: Engineer")},
            },
        }
        row = scanner.message_to_row(message)
        self.assertEqual("gmail-1", row["message_id"])
        self.assertEqual("2026-07-23", row["applied_date"])
        self.assertNotIn("review_state", row)
        self.assertEqual("Email", row["source"])


if __name__ == "__main__":
    unittest.main()
