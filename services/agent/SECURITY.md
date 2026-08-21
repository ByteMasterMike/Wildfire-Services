# Agent security posture

This prototype is intentionally low-risk under lethal-trifecta and Rule-of-Two
reasoning because its capabilities and trust boundary are narrow:

- Read-only tools only.
- One trusted local user.
- No third-party or untrusted content ingestion.
- No database writes, filesystem-write tool, external messaging, or other
  external-communication capability.
- Loopback-only model and backend URLs by default.
- One exchange at a time; no conversation memory.

Prompt injection is not treated as reliably solvable by filtering. Safety comes
from architecture: tool schemas expose only bounded reads, backend response
content is treated as data, full payloads stay out of model context, unsupported
claims are blocked without tool evidence, and the provider rejects non-loopback
URLs unless an explicit reviewed override is enabled.

## Changes that require threat-model review

Do not add any of the following casually:

- web search or arbitrary URL retrieval
- document/file upload or third-party content ingestion
- database, filesystem, ticketing, email, or messaging writes
- public or multi-user access
- a remote model provider or any new external communication channel
- persistent conversation memory

Any one of these changes the trust boundary. Combining untrusted input, private
data, and an external side effect can create the lethal trifecta. A security
review must precede implementation, with authentication, authorization, tenant
isolation, data-retention, audit, egress, and prompt-injection consequences
documented explicitly.

## Non-goals

This prototype is not hardened for public deployment, hostile users, uploaded
documents, or secrets in prompts. It should run on loopback in a trusted local
environment only.
