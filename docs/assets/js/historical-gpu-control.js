/**
 * Start/stop strip for the demo GPU above the Ask form.
 * Token is prompted per action and never stored.
 */
(() => {
  const GpuApi = window.WildfireGpuControlApi;
  const root = document.getElementById("historical-gpu-control");
  if (!root || !GpuApi) return;

  const statusEl = document.getElementById("historical-gpu-status");
  const startBtn = document.getElementById("historical-gpu-start");
  const stopBtn = document.getElementById("historical-gpu-stop");
  const noteEl = document.getElementById("historical-gpu-note");

  const TRANSITIONAL = new Set(["starting", "loading_model", "stopping"]);
  const IDLE_MS = 30000;
  const TRANSITION_MS = 8000;

  let lastState = "unknown";
  let inFlight = false;
  let timer = null;

  const setStatusText = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  const setButtons = (state) => {
    const busy = inFlight || TRANSITIONAL.has(state);
    if (startBtn) {
      startBtn.disabled = busy || state === "ready";
    }
    if (stopBtn) {
      stopBtn.disabled = busy || state === "stopped";
    }
  };

  const statusCopy = (payload) => {
    const state = payload.state || "error";
    if (state === "stopped") {
      return "GPU is off. Counts, maps, and rankings still work.";
    }
    if (state === "starting") {
      return payload.eta_copy
        ? `Starting, ${payload.eta_copy}.`
        : "Starting the GPU instance…";
    }
    if (state === "loading_model") {
      return payload.eta_copy
        ? `Loading the model… ${payload.eta_copy}.`
        : "Loading the model…";
    }
    if (state === "ready") {
      return "GPU ready.";
    }
    if (state === "stopping") {
      return "Stopping the GPU instance…";
    }
    return payload.reason
      ? `GPU control error: ${payload.reason}`
      : "GPU control error.";
  };

  const applyPayload = (payload) => {
    lastState = payload.state || "error";
    window.WildfireGpuControl = { lastState };
    setStatusText(statusCopy(payload));
    if (noteEl && payload.ebs_note) {
      noteEl.textContent = payload.ebs_note;
    }
    setButtons(lastState);
    root.dataset.state = lastState;
    if (lastState === "ready" && window.WildfireAgentPanel?.refreshHealth) {
      window.WildfireAgentPanel.refreshHealth();
    }
  };

  const panelIsOpen = () =>
    Boolean(document.getElementById("historical-agent-panel")?.classList.contains("is-open"));

  const pollMs = () => (TRANSITIONAL.has(lastState) ? TRANSITION_MS : IDLE_MS);

  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (!panelIsOpen()) return;
    timer = setTimeout(() => {
      refresh().catch(() => {});
    }, pollMs());
  };

  async function refresh() {
    try {
      const payload = await GpuApi.status();
      applyPayload(payload);
    } catch (error) {
      lastState = "unavailable";
      window.WildfireGpuControl = { lastState };
      setStatusText(
        "GPU control is not running. Counts, maps, and rankings still work if the agent is up."
      );
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = true;
      root.dataset.state = "unavailable";
    }
    schedule();
  }

  const promptToken = (action) => {
    const value = window.prompt(
      `Enter the GPU control token to ${action} the instance. It is not saved.`
    );
    return value == null ? null : String(value);
  };

  const runAction = async (action) => {
    if (inFlight) return;
    const token = promptToken(action);
    if (token === null) return;
    if (!token.trim()) {
      setStatusText("A GPU control token is required.");
      return;
    }
    inFlight = true;
    setButtons(lastState);
    try {
      const payload = action === "start" ? await GpuApi.start(token) : await GpuApi.stop(token);
      applyPayload(payload);
    } catch (error) {
      const status = error?.status;
      if (status === 401) {
        setStatusText("That token was rejected.");
      } else if (status === 503) {
        setStatusText("Start and stop are disabled until GPU_CONTROL_TOKEN is set on the server.");
      } else {
        setStatusText(error?.message || `Could not ${action} the GPU.`);
      }
    } finally {
      inFlight = false;
      setButtons(lastState);
      schedule();
    }
  };

  if (startBtn) {
    startBtn.addEventListener("click", () => runAction("start"));
  }
  if (stopBtn) {
    stopBtn.addEventListener("click", () => runAction("stop"));
  }

  const panel = document.getElementById("historical-agent-panel");
  if (panel) {
    const observer = new MutationObserver(() => {
      if (panel.classList.contains("is-open")) {
        refresh().catch(() => {});
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
  }
})();
