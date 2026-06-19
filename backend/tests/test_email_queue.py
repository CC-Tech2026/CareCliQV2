import unittest
from unittest.mock import patch

from backend.app.core.config import settings
from backend.app.services.email_queue import EmailQueue


class EmailQueueTests(unittest.TestCase):
    def test_enqueue_processes_jobs_in_order(self):
        queue = EmailQueue(workers=1, maxsize=10)
        seen: list[str] = []

        queue.start()
        try:
            queue.enqueue(label="first", send=lambda: seen.append("first"))
            queue.enqueue(label="second", send=lambda: seen.append("second"))
            queue._queue.join()
        finally:
            queue.stop()

        self.assertEqual(seen, ["first", "second"])

    def test_enqueue_rejects_when_full(self):
        queue = EmailQueue(workers=0, maxsize=1)
        queue._running = True
        queue.enqueue(label="blocked", send=lambda: None)
        result = queue.enqueue(label="overflow", send=lambda: None)
        self.assertEqual(result["status"], "queue_full")

    @patch("backend.app.services.email_service.send_email")
    def test_queue_email_job_respects_disabled_setting(self, send_email_mock):
        from backend.app.services.email_service import queue_email_job

        original = settings.email_enabled
        settings.email_enabled = False
        try:
            result = queue_email_job(label="test", send=lambda: send_email_mock())
            self.assertEqual(result["status"], "disabled")
            send_email_mock.assert_not_called()
        finally:
            settings.email_enabled = original


if __name__ == "__main__":
    unittest.main()
