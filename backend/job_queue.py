"""A simple FIFO job queue for realtime requests.

Instead of running every incoming broadcast immediately (as realtime_dispatch.register_handler
does), features register their request/response handlers here. Each incoming request is pushed
onto a shared queue, and a pool of worker tasks pulls jobs off and processes them one at a time
(per worker). This keeps heavy work — LLM generation especially — from all running at once.
"""
import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable

from realtime_dispatch import run_and_reply

Handler = Callable[[dict], Awaitable[dict]]


@dataclass
class Job:
    channel: object
    request_event: str
    response_event: str
    handler: Handler
    data: dict


class JobQueue:
    def __init__(self, num_workers: int = 1) -> None:
        self._queue: asyncio.Queue[Job] = asyncio.Queue()
        self._num_workers = num_workers
        self._workers: list[asyncio.Task] = []

    def register(self, channel, request_event: str, response_event: str, handler: Handler) -> None:
        """Register a request/response handler whose jobs are queued rather than run immediately."""
        def on_request(broadcast: dict) -> None:
            job = Job(channel, request_event, response_event, handler, broadcast["payload"])
            self._queue.put_nowait(job)
            print(
                f"Queued '{request_event}' (jobId={job.data.get('jobId')}); "
                f"{self._queue.qsize()} job(s) waiting"
            )

        channel.on_broadcast(request_event, on_request)

    async def _worker(self, worker_id: int) -> None:
        while True:
            job = await self._queue.get()
            try:
                await run_and_reply(
                    job.channel, job.request_event, job.response_event, job.handler, job.data
                )
            except Exception as e:  # keep the worker alive no matter what a job does
                print(f"[worker {worker_id}] unexpected error: {e}")
            finally:
                self._queue.task_done()

    def qsize(self) -> int:
        """How many jobs are waiting (not counting any currently running). Reported to the Assets
        Lab so a queue wait isn't mistaken for generation time."""
        return self._queue.qsize()

    def start(self) -> None:
        """Spawn the worker tasks. Call once, from inside the running event loop."""
        self._workers = [
            asyncio.create_task(self._worker(i)) for i in range(self._num_workers)
        ]
