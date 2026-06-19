from __future__ import annotations

import logging
import queue
import threading
from dataclasses import dataclass
from typing import Callable

from ..core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmailJob:
    label: str
    send: Callable[[], None]


class EmailQueue:
    """In-process SMTP queue with worker threads.

    Jobs are processed FIFO. Use a single worker for Gmail rate limits;
    increase EMAIL_QUEUE_WORKERS only if your provider allows it.
    """

    def __init__(self, *, workers: int = 1, maxsize: int = 1000) -> None:
        self._workers = max(1, workers)
        self._queue: queue.Queue[EmailJob | None] = queue.Queue(maxsize=max(1, maxsize))
        self._threads: list[threading.Thread] = []
        self._running = False
        self._lock = threading.Lock()
        self._enqueued = 0
        self._sent = 0
        self._failed = 0
        self._rejected = 0

    def start(self) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
            for index in range(self._workers):
                thread = threading.Thread(
                    target=self._worker_loop,
                    name=f"email-worker-{index}",
                    daemon=True,
                )
                thread.start()
                self._threads.append(thread)
            logger.info(
                "Email queue started (%s worker(s), max size %s)",
                self._workers,
                self._queue.maxsize,
            )

    def stop(self, *, timeout: float = 30.0) -> None:
        with self._lock:
            if not self._running:
                return
            self._running = False
            threads = list(self._threads)
            self._threads.clear()

        for _ in threads:
            try:
                self._queue.put(None, timeout=1)
            except queue.Full:
                pass

        for thread in threads:
            thread.join(timeout=timeout)

        logger.info(
            "Email queue stopped (sent=%s failed=%s rejected=%s pending=%s)",
            self._sent,
            self._failed,
            self._rejected,
            self.pending(),
        )

    def pending(self) -> int:
        return self._queue.qsize()

    def stats(self) -> dict[str, int]:
        return {
            "pending": self.pending(),
            "enqueued": self._enqueued,
            "sent": self._sent,
            "failed": self._failed,
            "rejected": self._rejected,
            "workers": self._workers,
            "max_size": self._queue.maxsize,
        }

    def enqueue(self, *, label: str, send: Callable[[], None]) -> dict[str, str | int]:
        if not self._running:
            logger.warning("Email queue not running; sending %s inline", label)
            try:
                send()
                self._sent += 1
                return {"status": "sent", "queue_size": 0}
            except Exception as exc:
                self._failed += 1
                logger.error("Inline email send failed (%s): %s", label, exc)
                return {"status": "failed", "queue_size": 0}

        job = EmailJob(label=label, send=send)
        try:
            self._queue.put(job, block=False)
        except queue.Full:
            self._rejected += 1
            logger.error("Email queue full; rejected job %s", label)
            return {"status": "queue_full", "queue_size": self.pending()}

        self._enqueued += 1
        return {"status": "queued", "queue_size": self.pending()}

    def _worker_loop(self) -> None:
        while True:
            try:
                job = self._queue.get(timeout=1)
            except queue.Empty:
                if not self._running:
                    break
                continue

            if job is None:
                self._queue.task_done()
                break

            try:
                job.send()
                self._sent += 1
                logger.info("Email queue delivered: %s", job.label)
            except Exception as exc:
                self._failed += 1
                logger.error("Email queue failed (%s): %s", job.label, exc)
            finally:
                self._queue.task_done()


_email_queue = EmailQueue(
    workers=settings.email_queue_workers,
    maxsize=settings.email_queue_max_size,
)


def get_email_queue() -> EmailQueue:
    return _email_queue


def start_email_queue() -> None:
    _email_queue.start()


def stop_email_queue() -> None:
    _email_queue.stop()
