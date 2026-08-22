"""EC2 start/stop/describe for the demo GPU instance. Credentials from the instance role."""

from __future__ import annotations

from typing import Any

from services.gpu_control.config import GpuControlSettings


def _client(settings: GpuControlSettings):
    import boto3

    kwargs: dict[str, Any] = {}
    if settings.region:
        kwargs["region_name"] = settings.region
    return boto3.client("ec2", **kwargs)


def describe_instance(settings: GpuControlSettings) -> dict[str, Any]:
    client = _client(settings)
    response = client.describe_instances(InstanceIds=[settings.instance_id])
    reservations = response.get("Reservations") or []
    instances = [
        item
        for reservation in reservations
        for item in (reservation.get("Instances") or [])
    ]
    if not instances:
        raise RuntimeError(f"Instance {settings.instance_id} was not found")
    instance = instances[0]
    state = ((instance.get("State") or {}).get("Name") or "").strip().lower()
    return {
        "instance_id": instance.get("InstanceId") or settings.instance_id,
        "ec2_state": state,
        "private_ip": instance.get("PrivateIpAddress"),
    }


def start_instance(settings: GpuControlSettings) -> dict[str, Any]:
    client = _client(settings)
    client.start_instances(InstanceIds=[settings.instance_id])
    return describe_instance(settings)


def stop_instance(settings: GpuControlSettings) -> dict[str, Any]:
    client = _client(settings)
    client.stop_instances(InstanceIds=[settings.instance_id])
    return describe_instance(settings)
