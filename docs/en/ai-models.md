# AI models: phase-zero operation and acceptance

This phase adds experimental `caf:llm/v1` without changing book bytes. See
[LLM v1](../../spec/en/llm-v1.md). Production Li Bai questions, citation
verification, maps and the poetry game are not implemented yet.

## Build and run

In the local CAF checkout, build the updated CLI with
`cargo build --bin caf-tool --offline`. In CAFDReader, with dependencies ready:

```sh
CAF_TOOL=/absolute/path/caf/target/debug/caf-tool npm run ai:build
npm run test:llm
python3 scripts/serve_offline.py
```

The build command builds/verifies the independent fixture twice and requires
identical SHA-256 hashes. Outputs: `build/llm-fixture.cafd`, `dist-host/`.
Prerequisites: Rust wasm32-unknown-unknown target, Python 3, project Node
dependencies. No book project's data directory is needed.

Open `http://127.0.0.1:8612/reader/` and select the fixture. Run browser checks:

```sh
BASE=http://127.0.0.1:8612 npm run test:llm-browser
```

The script tests Chrome, Firefox and WebKit at 390/1280 px and writes
`build/llm-browser-report.json`; any failure exits nonzero. Browser binaries
must match Playwright. CAFD_CHROME_EXECUTABLE, CAFD_FIREFOX_EXECUTABLE and
CAFD_WEBKIT_EXECUTABLE can explicitly select binaries; old binaries may have
incompatible automation protocols.

## Offline LAN preparation

Disconnecting the internet still leaves the phone, static host and Ollama
connected over the LAN. On a phone, localhost refers to the phone.

1. Install models ahead of time. Reader's preparation panel provides manual
   download/offline-import instructions; it never executes shell commands.
2. Configure Ollama's listening address and allowed Reader origin yourself.
3. Use device-trusted HTTPS for Reader so Web Crypto is available.
4. The model endpoint must also meet browser mixed-content, CORS and local
   network rules. For cross-browser LAN use, prepare a trusted HTTPS frontend
   for Ollama. An HTTPS page fetching a LAN HTTP endpoint is not guaranteed to
   work. That frontend is deployment preparation, not a document capability or
   a feature of Reader's static server.
5. Start the static server with a valid certificate. Keep certificate/private
   key files outside both the static root and the CAF:

```sh
python3 scripts/serve_offline.py --host 0.0.0.0 --port 8612 --cert /secure/server.pem --key /secure/server-key.pem
```

The server supports Range and disables directory listings. Reader needs no CDN;
there is no new PWA cache. Offline startup uses the LAN static service. This
helper is for a controlled demo network, not a production server replacement.

## Configuration and consent

The shelf AI link navigates into Reader. Configure there, then select a file in
the same page to avoid losing memory-only configuration. Default local endpoint:
`http://localhost:11434`. Detect installed models, then select one. Cloud is
initially disabled via an independent checkbox; when enabled, endpoint and model
are required. Enter an API base such as `/v1`; Reader appends `/chat/completions`.
An empty key only works with services permitting anonymous access.

The desktop Reader bypasses the browser and the page CSP connect-src: AI
requests are forwarded by the host process to the endpoints listed in
`~/.cafdreader/cfg.toml`, created on first launch with these defaults:

```toml
[ai]
endpoints = ["http://localhost:11434", "http://127.0.0.1:11434"]
```

Edits take effect immediately; no restart or rebuild is needed. The proxy only
permits `/api/tags` and `/api/chat` under each endpoint and only plain-HTTP
local/LAN addresses; HTTPS endpoints and the cloud tier are unavailable in the
desktop build for now.

Applying configuration does not prove connectivity. Use connection test/warmup;
its token usage is counted. Allow persists an artifact/component/tier decision;
once lasts for that open-book session; deny sends nothing. Revoke cancels
in-flight requests. Changing configuration also interrupts requests. Config,
endpoint, key, signing key and usage are page-memory-only and disappear on
navigation/refresh; consent decisions can persist independently.

## Three-minute phase-zero demonstration

- 0:00–0:30: open the AI fixture with no backend and show unavailable.
- 0:30–1:10: detect a preinstalled model, test/warm up, show model and latency.
- 1:10–1:50: ask, deny once, then allow for this session and show the reply.
- 1:50–2:30: expand the host receipt, inspect signature/hash/usage, export usage.
- 2:30–3:00: disable the backend and show honest fallback.

The complete Li Bai → citations → map → poetry-game script and requested closing
line belong to phase three; this phase does not demonstrate nonexistent features.

## Test matrix and current evidence

| Scenario | Entry point | Current result |
| --- | --- | --- |
| Missing declaration, version/profile conflict, network denied | Rust security / Web admit | Passed |
| Identical Rust/Web command boundaries | llm-vectors.json | Passed |
| No configured/available backend | llm.spec / llm-runtime.spec | Passed |
| Allow, deny, once, cross-artifact isolation | llm.spec | Passed at service layer |
| Local/cloud request shapes and unknown usage | llm.spec | Passed with mock provider |
| Timeout, cancellation, late result, queue limits | llm.spec / Rust mailbox | Passed |
| No endpoint/key in results, announcements or exports | llm.spec | Passed |
| Receipt signature, tampering, response hash | llm.spec / llm-runtime.spec | Passed |
| Real container → WASM → mailbox → service → receipt | llm-runtime.spec | Passed with mock provider |
| Desktop AI proxy: default config creation, endpoint allowlist, forwarding and abort | cargo test (src-tauri ai module) | Passed |
| Two equal builds and caf-tool verify | build_llm_fixture.py | Passed |
| Native CLI without provider | caf-tool run --fn llm-discover | Passed, empty list |
| Chrome/Firefox/WebKit UI and consent dialogs | llm-browser.spec | Pending passing run |
| Real Ollama / qwen2.5:7b | User-supplied receipt from 2026-11-19 | Successful; response hash and signature independently checked |
| Phone LAN and disconnected internet | Environment acceptance | Not completed |
| Existing Li Bai and Tetris full browser regression | Browser acceptance | Not completed |

## Known limitations and licensing

- The execution sandbox prevents Chrome/WebKit socket operations. Cached Firefox
  has a protocol mismatch with installed Playwright. These are failures, not
  passes; the browser report preserves the errors.
- The existing unit aggregator's reader-build-logic subprocess test hits
  spawnSync EPERM. New unit tests, the real WASM path and Rust workspace tests
  run separately. Existing assertions were not removed or weakened.
- This execution sandbox prohibits sockets; that does not establish whether the user’s Ollama is running. The user reported a successful connection test (4064 ms) and artifact call (207 ms, 31 input / 10 output tokens). Its response hash, session signature and tamper rejection were independently checked offline. Long-answer performance, phone LAN and three-engine browser acceptance remain unverified.
- Rust runtime has the mediated mailbox SDK. Desktop Reader AI traffic now
  passes through a native proxy enforcing the `~/.cafdreader/cfg.toml`
  allowlist (plain-HTTP endpoints only); native-process credential isolation is
  still not implemented. Browser isolation is from the book app, not a
  compromised host or privileged browser extension.
- Receipts are session-self-signed. Digests observed at configuration time are
  not execution attestation of model weights.
- There is no poetry index/citation verifier in phase zero. The fixture explicitly
  says it has no verifiable citations.
- No new third-party package was introduced. Rust reuses workspace serde and
  serde_json; Web uses Fetch/Web Crypto/DOM; tests reuse Playwright. Models are
  user-prepared and not redistributed in CAF; their licenses and service terms
  apply separately.
- No Jiangshan code/data/assets or CHGIS layers were imported. The phase-two
  licensing boundaries remain unchanged.

## Required security review

Endpoint and API key must remain host-memory-only. Inspect guest memory, iframe,
bridge messages, errors, logs, persistence and exports for leaks. Components
cannot choose URLs/HTTP headers or obtain arbitrary networking. Grants do not
cross artifact roots; close/cancel blocks late replies. Never fabricate token
usage, model hashes or citations.

## Interface references

- [Ollama chat](https://docs.ollama.com/api/chat)
- [Ollama model import](https://docs.ollama.com/import)
- [Web Crypto secure context](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle)
