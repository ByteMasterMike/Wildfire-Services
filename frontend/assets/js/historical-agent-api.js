/**
 * Agent-service client for the Historical Map chat panel.
 * Depends on window.WILDFIRE_AGENT_BASE from api-config.js.
 */
(() => {
  const agentBase = () =>
    String(window.WILDFIRE_AGENT_BASE || "http://127.0.0.1:8004").replace(/\/$/, "");

  async function health() {
    const response = await fetch(`${agentBase()}/health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * POST /ask/stream and invoke onEvent(name, data) for each SSE event.
   * Pass AbortSignal to cancel; server cancels orchestration when the connection drops.
   */
  async function askStream(question, { onEvent, signal } = {}) {
    const response = await fetch(`${agentBase()}/ask/stream`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`
      );
    }
    if (!response.body) {
      throw new Error("Streaming body unavailable in this browser");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";

    const flushBlock = (block) => {
      const lines = block.split(/\r?\n/);
      let eventName = currentEvent;
      const dataLines = [];
      lines.forEach((line) => {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      });
      if (!dataLines.length) return;
      const raw = dataLines.join("\n");
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        data = { raw };
      }
      if (typeof onEvent === "function") onEvent(eventName, data);
      currentEvent = "message";
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
        if (block.trim()) flushBlock(block);
      }
    }
    if (buffer.trim()) flushBlock(buffer);
  }

  async function getArtifact(ref) {
    const response = await fetch(`${agentBase()}/artifacts/${encodeURIComponent(ref)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  window.WildfireAgentApi = {
    apiBase: agentBase,
    health,
    askStream,
    getArtifact,
  };
})();
