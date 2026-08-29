# GPU control service

Starts and stops the demo GPU instance that runs Ollama (`qwen3:32b`). This is
not the agent and not data_query. The agent stays up when the GPU is off so
counts, maps, and rankings still work.

Default instance: `i-09526a2a9268135f2` (g6.xlarge, private `172.31.16.67`).
Ollama is probed from the backend box at `http://172.31.16.67:11434`. Do not
widen the GPU security group; 11434 stays open only to `172.31.2.9/32`.

## Run

```bash
# PowerShell: $env:PYTHONPATH = "."
# Required on the always-on backend before POST start/stop will work:
# GPU_CONTROL_TOKEN, GPU_AWS_REGION (or AWS_REGION), instance role credentials
uvicorn services.gpu_control.app:app --port 8005 --app-dir .
```

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health` | none |
| `GET` | `/gpu/status` | none |
| `POST` | `/gpu/start` | `X-GPU-Control-Token` |
| `POST` | `/gpu/stop` | `X-GPU-Control-Token` |

Missing `GPU_CONTROL_TOKEN` → POST returns **503** (start is never open).
Wrong or missing header → **401**.

`GET /gpu/status` is pollable. Concurrent `POST /gpu/start` is serialized with
an in-process lock. If a start is already running, or state is not `stopped` /
`error`, the handler returns the current status payload and does **not** call
`StartInstances` again. The lock resets when this process restarts.

`POST /gpu/start` returns immediately after `StartInstances` (`state: starting`)
and a background task then:

1. Polls until Ollama answers (same `/api/ps` probe as status).
2. If the model is not in VRAM, loads it with the agent's
   `ensure_context_loaded()` path (same `num_ctx` / options as Ask).
3. Pre-fires `POST /ask` on the local agent:
   `How many CPUC ignitions were there in 2023?`

`ready` requires the model resident **and** that pre-fire to return
`status=answer`. A failed or timed-out pre-fire is `error` with `reason`,
not a silent `ready`. `running` alone is not ready.

ETA is only present while this process saw `POST /gpu/start` and the state
is `starting` or `loading_model`. Restart the control service mid-boot and
ETA is omitted.

Stopping EC2 does **not** stop the EBS volume (~$20/month). There is no idle
auto-stop and no implicit start from Ask or `/health`.

## IAM (attach to `wildfire-backend-ssm-role`)

Do not apply this from the repo. Paste in the IAM console after substituting
`REGION` and `ACCOUNT_ID`. `ec2:DescribeInstances` does not support
resource-level ARNs, so that statement must use `*`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StartStopGpuInstance",
      "Effect": "Allow",
      "Action": [
        "ec2:StartInstances",
        "ec2:StopInstances"
      ],
      "Resource": "arn:aws:ec2:REGION:ACCOUNT_ID:instance/i-09526a2a9268135f2"
    },
    {
      "Sid": "DescribeInstancesStarRequiredNoResourceScope",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    }
  ]
}
```
