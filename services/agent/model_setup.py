"""Create a no-thinking Qwen alias when the installed template forces thinking."""

from __future__ import annotations

import httpx

from services.agent.config import AgentSettings

FORCED_THINK_SUFFIX = """{{- if and (ne .Role "assistant") $last }}<|im_start|>assistant
<think>
{{ end }}
{{- end }}"""

NO_THINK_SUFFIX = """{{- if and (ne .Role "assistant") $last }}<|im_start|>assistant
<think>

</think>

{{ end }}
{{- end }}"""


async def ensure_runtime_model(settings: AgentSettings) -> AgentSettings:
    """Return settings using an idempotent template-only alias when needed.

    The current Ollama qwen3 manifests force a ``<think>`` prefix in the model
    template even when the OpenAI request sends ``reasoning_effort=none``.
    Removing only that prefix preserves the exact weights and tool template,
    while making the requested thinking-off cell real and measurable.

    Also pins ``num_ctx`` on the alias. Ollama otherwise loads at 4096 even when
    the GGUF reports a much larger supported context.
    """
    if (
        settings.thinking != "off"
        or settings.model_runtime
        or not settings.model.lower().startswith("qwen3:")
        or "127.0.0.1:11434" not in settings.model_base_url
    ):
        return settings

    native_url = settings.model_base_url.removesuffix("/v1")
    async with httpx.AsyncClient(timeout=300.0) as client:
        shown = await client.post(
            native_url + "/api/show", json={"model": settings.model}
        )
        shown.raise_for_status()
        template = shown.json().get("template") or ""
        if FORCED_THINK_SUFFIX not in template:
            print(
                f"[agent] Base model {settings.model} has no forced-think template; "
                f"using it with num_ctx={settings.num_ctx} on each request"
            )
            return settings

        alias = f"{settings.model}-agent-nothink"
        corrected = template.replace(
            FORCED_THINK_SUFFIX,
            NO_THINK_SUFFIX,
            1,
        )
        created = await client.post(
            native_url + "/api/create",
            json={
                "model": alias,
                "from": settings.model,
                "template": corrected,
                "parameters": {"num_ctx": settings.num_ctx},
                "stream": False,
            },
        )
        created.raise_for_status()
        print(
            f"[agent] Using template-only no-thinking alias {alias} "
            f"for base model {settings.model} (Modelfile num_ctx={settings.num_ctx})"
        )
        return settings.with_runtime_model(alias)
