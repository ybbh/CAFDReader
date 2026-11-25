# caf:llm/v1 — experimental mediated host capability

Status: experimental v1; independent of the unchanged `caf:doc-web@1` bridge.
The document profile/WIT remains compatible. No arbitrary network bridge exists.

## Admission and ABI

Manifest/build policy: `llm = "caf:llm@1"`. Execution requires
`profile = "caf-x1"` and `deterministic = false`. Ordinary network, filesystem,
clock and random flags remain false. Omission preserves legacy serialization.
Unsupported versions and undeclared imports fail closed. Old runtimes reject
this policy/profile rather than silently running it as caf-d1.

The WIT source is [llm.wit](../llm.wit), package `caf:llm@1.0.0`.
This is the existing CAF **core-module ABI**, not automatic Component Model
canonical lowering. The WIT host exchange maps explicitly to core import
`caf:llm/v1.exchange(i32,i32,i32,i32)->i32`. Parameters are request pointer/length,
reply pointer/capacity. Requests are UTF-8 JSON, at most 32,768 bytes. The caller
supplies exactly 131,072 writable reply bytes. Return value is bytes written,
or -1 for invalid memory/budget. Invalid JSON/UTF-8 returns invalid status. Memory ranges and maximum reply budget
are checked/reserved before effects; retrying a too-small buffer never submits.

The independent fixture imports the host WIT and exports its existing document
interface plus test operations. Production ask/find/describe belongs to phase 1.

## JSON commands

Only the listed fields are accepted. Commands run synchronously and yield to the
host event loop immediately; no JSPI, synchronous network, or shared memory is
required. The Worker handles host completions outside its serial call queue.

- `{"op":"discover"}` → ready, protocol, backends. Each public backend has
  `tier` (local/cloud), model, nullable provider-reported digest. No endpoint/key.
- `{"op":"submit","model_hint":"auto","prompt":"...","max_tokens":128,"temperature":0}`
  → pending with numeric id, or unavailable/invalid/limit.
- `{"op":"poll","id":1}` → current task state; unknown for missing ids.
- `{"op":"cancel","id":1}` → cancelled for a pending task; terminal state is
  preserved. Late completion after cancellation cannot replace it.

model_hint is auto/local/cloud only. Prompt is 1–16,384 UTF-8 bytes; max_tokens
is 1–1,024; temperature is finite, 0–2. There are at most two pending tasks and
128 submitted tasks per component instance. Completed tasks remain pollable
until session close. Completion may be completed/denied/unavailable/error/
cancelled/limit/invalid. Cancellation is best effort at the provider; a remote
provider may still account tokens after the browser aborts.

LLM declaration enables the mediated import, **not consent to transport**.
Reader authorizes by complete artifact root, component and tier. Persistent
allow stores only that decision; once lasts for the current book session.
No grant transfers to a changed root or a different tier. Changing configuration
aborts pending requests. A local failure never silently falls back to cloud.

## Receipts and trust

Reader signs every dispatched attempt with an ephemeral, nonextractable Web
Crypto ECDSA P-256 private key. Receipt body includes protocol, root_hash,
component, session-monotonic call_id, task_id, backend tier, model, configured_model, model_source,
nullable model_digest, model_digest_source, parameters, request_hash,
response_hash, timestamp, latency_ms, status, code, usage, signature_algorithm,
and trust. `model_digest_source = listing-at-configuration` means a digest
observed from Ollama's model listing, **not attestation of the loaded weights**.
model_source distinguishes provider-response from configuration fallback. A differing reported model clears the digest. Cloud model identifiers do not establish immutable weights.

Signature input is UTF-8 JSON with object keys recursively sorted, arrays in
order, no whitespace. `public_key` (public JWK) and `signature` (hex raw r||s)
are outside the signed body. Verification uses the supplied public key; it does
not establish an independently trusted host identity. The request hash covers
the canonical provider body, never HTTP headers/endpoint. Response hash covers
the exact guest-visible UTF-8 text after defensive secret redaction. Error or
cancelled calls without a delivered answer have null response_hash. Unknown
usage is null, never zero. Times are the host's untrusted wall clock.

An AI badge is host-owned. Phase 0 has no citation verifier and explicitly shows
“no verifiable citations”; signing a reply does not make its facts true. Phase 1
must verify payload citations before reporting that individual citations pass.

## Lifecycle and limits

Timeout is 10 seconds after authorization and signing-key setup; consent time
is not generation latency. Provider responses are bounded to 256 KiB and answer
text to 32 KiB. Redirects are denied; ambient browser credentials are omitted.
Raw transport exceptions/provider error bodies are not returned to the guest.
Reader retains up to 128 call receipts in memory, with usage reset/export.
Clearing usage does not erase already displayed receipts; it never writes CAF
bytes. DOM receipt history is capped at 20 records. Closing a book cancels tasks,
drops session consent and hides its receipts. Refresh/navigation drops configs,
secrets, signing key and usage. Saved consent remains independently revocable.

Rust caf-runtime supplies a nonblocking Mailbox SDK: announce public models,
drain requests, apply consent/transport/receipt policy in the embedding host,
then complete tasks. The CLI installs no provider and honestly returns no
available backends. Native Reader Rust transport is not implemented in this
browser-first delivery; do not advertise native key isolation based on it.
