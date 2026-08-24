from fastapi.testclient import TestClient

from services.gpu_control import app as gpu_app
from services.gpu_control.bringup import reset_pipeline


async def _noop_bring_up(settings):  # noqa: ARG001
    return None


def _client(monkeypatch, token=None):
    if token is None:
        # Empty overrides a token loaded from repo .env (dotenv does not override).
        monkeypatch.setenv("GPU_CONTROL_TOKEN", "")
    else:
        monkeypatch.setenv("GPU_CONTROL_TOKEN", token)
    gpu_app._start_requested_at = None
    gpu_app._bring_up_task = None
    reset_pipeline()
    monkeypatch.setattr(gpu_app, "bring_up_gpu", _noop_bring_up)
    return TestClient(gpu_app.app)


def test_health_and_status_are_unauthenticated(monkeypatch):
    monkeypatch.setattr(
        gpu_app.aws,
        "describe_instance",
        lambda settings: {
            "instance_id": "i-09526a2a9268135f2",
            "ec2_state": "stopped",
            "private_ip": None,
        },
    )
    client = _client(monkeypatch)
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["service"] == "gpu_control"
    status = client.get("/gpu/status")
    assert status.status_code == 200
    assert status.json()["state"] == "stopped"
    assert "eta_seconds" not in status.json()


def test_start_without_env_token_is_503(monkeypatch):
    client = _client(monkeypatch, token=None)
    response = client.post("/gpu/start")
    assert response.status_code == 503


def test_start_wrong_token_is_401(monkeypatch):
    client = _client(monkeypatch, token="correct-token")
    response = client.post(
        "/gpu/start", headers={"X-GPU-Control-Token": "wrong-token"}
    )
    assert response.status_code == 401


def test_start_sets_eta_then_stop_clears_it(monkeypatch):
    monkeypatch.setattr(
        gpu_app.aws,
        "start_instance",
        lambda settings: {
            "instance_id": "i-09526a2a9268135f2",
            "ec2_state": "pending",
            "private_ip": None,
        },
    )
    monkeypatch.setattr(
        gpu_app.aws,
        "stop_instance",
        lambda settings: {
            "instance_id": "i-09526a2a9268135f2",
            "ec2_state": "stopping",
            "private_ip": None,
        },
    )
    monkeypatch.setattr(
        gpu_app.aws,
        "describe_instance",
        lambda settings: {
            "instance_id": "i-09526a2a9268135f2",
            "ec2_state": "pending",
            "private_ip": None,
        },
    )
    client = _client(monkeypatch, token="correct-token")
    started = client.post(
        "/gpu/start", headers={"X-GPU-Control-Token": "correct-token"}
    )
    assert started.status_code == 200
    body = started.json()
    assert body["state"] == "starting"
    assert "eta_seconds" in body
    assert "estimate" in body["eta_copy"]

    monkeypatch.setattr(
        gpu_app.aws,
        "describe_instance",
        lambda settings: {
            "instance_id": "i-09526a2a9268135f2",
            "ec2_state": "stopping",
            "private_ip": None,
        },
    )
    stopped = client.post(
        "/gpu/stop", headers={"X-GPU-Control-Token": "correct-token"}
    )
    assert stopped.status_code == 200
    assert stopped.json()["state"] == "stopping"
    assert "eta_seconds" not in stopped.json()


def test_start_schedules_bring_up(monkeypatch):
    async def marked(settings):  # noqa: ARG001
        return None

    monkeypatch.setattr(
        gpu_app.aws,
        "start_instance",
        lambda settings: {
            "instance_id": "i-09526a2a9268135f2",
            "ec2_state": "pending",
            "private_ip": None,
        },
    )
    monkeypatch.setattr(
        gpu_app.aws,
        "describe_instance",
        lambda settings: {
            "instance_id": "i-09526a2a9268135f2",
            "ec2_state": "pending",
            "private_ip": None,
        },
    )
    client = _client(monkeypatch, token="correct-token")
    monkeypatch.setattr(gpu_app, "bring_up_gpu", marked)
    started = client.post(
        "/gpu/start", headers={"X-GPU-Control-Token": "correct-token"}
    )
    assert started.status_code == 200
    assert started.json()["state"] == "starting"
    assert gpu_app._bring_up_task is not None
