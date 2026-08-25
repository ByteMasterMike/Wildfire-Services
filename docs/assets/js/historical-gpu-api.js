/**
 * GPU-control client for the Historical Map Ask panel.
 * Depends on window.WILDFIRE_GPU_CONTROL_BASE from api-config.js.
 */
(() => {
  const gpuBase = () =>
    String(window.WILDFIRE_GPU_CONTROL_BASE || "http://127.0.0.1:8005").replace(
      /\/$/,
      ""
    );

  async function readJson(response) {
    const text = await response.text().catch(() => "");
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { detail: text.slice(0, 200) };
      }
    }
    if (!response.ok) {
      const detail = payload.detail || payload.error || text.slice(0, 200);
      const error = new Error(
        `HTTP ${response.status}${detail ? `: ${detail}` : ""}`
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function status() {
    const response = await fetch(`${gpuBase()}/gpu/status`);
    return readJson(response);
  }

  async function start(token) {
    const response = await fetch(`${gpuBase()}/gpu/start`, {
      method: "POST",
      headers: { "X-GPU-Control-Token": String(token || "") },
    });
    return readJson(response);
  }

  async function stop(token) {
    const response = await fetch(`${gpuBase()}/gpu/stop`, {
      method: "POST",
      headers: { "X-GPU-Control-Token": String(token || "") },
    });
    return readJson(response);
  }

  window.WildfireGpuControlApi = {
    apiBase: gpuBase,
    status,
    start,
    stop,
  };
})();
