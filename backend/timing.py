"""Reusable timer for measuring how long a job takes to run.

Wrap any unit of work that was requested by the frontend (a realtime signal now,
text/audio/image generation later) in `time_job` so every job's duration is logged
the same way, and can be compared against the frontend's `timeJob` (lib/job-timer.ts).
"""

import logging
import time
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger("job_timer")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(message)s")


def format_duration(seconds: float) -> str:
    """Formats a duration in seconds as e.g. "3h 23min 45s 32ms", dropping leading zero units."""
    total_ms = round(seconds * 1000)
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)

    parts = []
    if hours:
        parts.append(f"{hours}h")
    if hours or minutes:
        parts.append(f"{minutes}min")
    if hours or minutes or secs:
        parts.append(f"{secs}s")
    parts.append(f"{millis}ms")

    return " ".join(parts)


@contextmanager
def time_job(label: str) -> Iterator[None]:
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        logger.info("[job-timer] %s: %s", label, format_duration(elapsed))
