"""Unit tests for harness SSE progress and cancelable provider posts."""

from __future__ import annotations

import asyncio

import httpx

from services.agent.config import AgentSettings
from services.agent.orchestrator import AgentOrchestrator
from services.agent.provider import _cancellable_post
from services.agent.streaming import format_sse
from services.agent.tools import ToolExecution


def test_format_sse_event_shape():
    text = format_sse("routing", {"path": "deterministic", "expect_slow": False})
    assert text.startswith("event: routing\n")
    assert "data: {" in text
    assert text.endswith("\n\n")
    assert "expect_slow" in text


def test_ask_emits_routing_tool_and_answer_events():
    class Provider:
        async def complete(self, **kwargs):
            raise AssertionError("deterministic path must not call the model")

    class Executor:
        async def execute(self, tool, arguments, **kwargs):
            if tool == "data_query_spatial":
                return ToolExecution(
                    tool=tool,
                    arguments=arguments,
                    ok=True,
                    summary={
                        "kind": "summary",
                        "region": {"id": "PGE", "type": "utility"},
                        "start_date": "2024-01-01",
                        "end_date": "2024-12-31",
                        "counts": {"ignitions": 20},
                        "metadata": {},
                    },
                    raw={},
                    error=None,
                    artifact=None,
                    latency_ms=1,
                    qualification_call=bool(kwargs.get("qualification_call")),
                )
            return ToolExecution(
                tool=tool,
                arguments=arguments,
                ok=True,
                summary={
                    "dataset": "cpuc_ignitions",
                    "result_mode": "count",
                    "total": 12,
                    "utility": "PGE",
                    "start_date": "2024-01-01",
                    "end_date": "2024-12-31",
                    "metadata": {},
                },
                raw={"total": 12},
                error=None,
                artifact=None,
                latency_ms=1,
                qualification_call=bool(kwargs.get("qualification_call")),
            )

        async def close(self):
            return None

    async def run():
        events: list[tuple[str, dict]] = []

        async def on_event(event, data):
            events.append((event, data))

        orchestrator = AgentOrchestrator(
            AgentSettings(),
            Provider(),  # type: ignore[arg-type]
            Executor(),  # type: ignore[arg-type]
        )
        result = await orchestrator.ask(
            "How many PG&E utility-attributed ignitions were there in 2024?",
            on_event=on_event,
        )
        assert result.response["status"] == "answer", result.response.get(
            "answer_text"
        )
        names = [name for name, _ in events]
        assert names[0] == "routing"
        assert events[0][1]["path"] == "deterministic"
        assert events[0][1]["expect_slow"] is False
        assert "tool_call" in names
        assert "tool_result" in names
        assert names[-1] == "answer"
        assert result.response["route"]["answer_origin"] == "deterministic"
        assert result.response["route"]["synthesis_fallback"] is False

    asyncio.run(run())


def test_ask_cancel_before_tools_emits_cancelled_error():
    class Provider:
        async def complete(self, **kwargs):
            raise AssertionError("should not reach model")

    class Executor:
        async def execute(self, tool, arguments, **kwargs):
            raise AssertionError("cancelled before tools")

    async def run():
        events: list[tuple[str, dict]] = []
        cancel = asyncio.Event()
        cancel.set()

        async def on_event(event, data):
            events.append((event, data))

        orchestrator = AgentOrchestrator(
            AgentSettings(),
            Provider(),  # type: ignore[arg-type]
            Executor(),  # type: ignore[arg-type]
        )
        result = await orchestrator.ask(
            "How many PG&E utility-attributed ignitions were there in 2024?",
            on_event=on_event,
            cancel_event=cancel,
        )
        assert result.response["status"] == "error"
        assert result.response["code"] == "cancelled"
        assert events[-1][0] == "error"
        assert events[-1][1]["code"] == "cancelled"

    asyncio.run(run())


def test_cancellable_post_aborts_in_flight_request():
    started = asyncio.Event()
    cancelled = asyncio.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        # MockTransport is sync; simulate long work via a barrier the cancel
        # path does not need — use a slow ASGI-less delay in the client task.
        raise AssertionError("use async transport")

    async def run():
        async def app(scope, receive, send):
            assert scope["type"] == "http"
            started.set()
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                cancelled.set()
                raise
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": b'{"ok":true}'})

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            cancel = asyncio.Event()

            async def cancel_soon():
                await started.wait()
                cancel.set()

            cancel_task = asyncio.create_task(cancel_soon())
            try:
                await _cancellable_post(
                    client,
                    "/slow",
                    json_payload={},
                    cancel_event=cancel,
                )
                raise AssertionError("expected CancelledError")
            except asyncio.CancelledError:
                pass
            finally:
                await cancel_task
            # Give the ASGI handler a moment to observe cancellation.
            await asyncio.sleep(0.05)

    asyncio.run(run())
