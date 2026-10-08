# ARCH FIX 1 REPORT

## 1. Result table

| Test name | Result |
| --- | --- |
| T1 sequential scene | PASS |
| T2 isolation A | PASS |
| T2 isolation B | PASS |
| T2b 6 concurrent clients x5 rounds | PASS |
| T3 new connection has empty scene | PASS |
| T4 2nd initialize does not disturb live session | PASS |
| T5a bogus session id -> 404 | PASS |
| T5b no session id (non-initialize) -> 400 | PASS |
| T5c server alive after bad requests | PASS |
| T6 DELETE ok then reuse -> 404 | PASS |
| T7a idle session evicted by TTL -> 404 | PASS |
| T8 active session count returns to 0 | PASS |
| T7b session cap: 4th initialize rejected (503) | PASS |
| T7c active sessions == cap | PASS |
| T8b all idle sessions cleaned after TTL | PASS |

## 2. Raw output of Step 3 (`node packages/server/test/e2e-sessions.mjs`)

```
PASS  T1 sequential scene  -- ["Delhi","Mumbai","Delhi → Mumbai"]
PASS  T2 isolation A  -- ["A-Delhi","A-Delhi"]
PASS  T2 isolation B  -- ["B-Mumbai","B-Kerala"]
PASS  T2b 6 concurrent clients x5 rounds  -- 0 contaminated scenes
PASS  T3 new connection has empty scene  -- []
PASS  T4 2nd initialize does not disturb live session  -- ["KeepMe"]
PASS  T5a bogus session id -> 404  -- status 404
PASS  T5b no session id (non-initialize) -> 400  -- status 400
PASS  T5c server alive after bad requests
PASS  T6 DELETE ok then reuse -> 404  -- delete 200, reuse 404
PASS  T7a idle session evicted by TTL -> 404  -- status 404
PASS  T8 active session count returns to 0  -- {"status":"ok","activeSessions":0}
PASS  T7b session cap: 4th initialize rejected (503)  -- Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32000,"message":"Too many active ses
PASS  T7c active sessions == cap  -- {"status":"ok","activeSessions":3}
PASS  T8b all idle sessions cleaned after TTL  -- {"status":"ok","activeSessions":0}

15/15 passed
TEST_EXIT=0
```

(The T7b note line is truncated exactly as the harness printed it.)

## 3. Builds (Step 2) and lint (Step 4)

All 4 builds PASSED (each run in the specified order; last lines shown):

- `npm run build -w @map-renderer/shared` — PASS
  ```
  > @map-renderer/shared@0.1.0 build
  > tsc -p tsconfig.json
  EXIT_shared=0
  ```
- `npm run build -w @map-renderer/server` — PASS
  ```
  > @map-renderer/server@0.1.0 build
  > tsc -p tsconfig.json
  EXIT_server=0
  ```
- `npm run build -w @map-renderer/ai-server` — PASS
  ```
  > @map-renderer/ai-server@0.1.0 build
  > tsc -p tsconfig.json
  EXIT_ai_server=0
  ```
- `npm run build -w @map-renderer/web` — PASS
  ```
  > @map-renderer/web@0.1.0 build
  > tsc -p tsconfig.json && vite build
  dist/index.html  1,060.83 kB │ gzip: 290.38 kB
  ✓ built in 4.91s
  EXIT_web=0
  ```

Lint (Step 4): PASS — `npx eslint packages/server/src/index.ts packages/server/src/server.ts packages/server/test` produced no output.

```
LINT_EXIT=0
```

## 4. Git output

`git status --short`:

```
M packages/ai-server/src/index.ts
 M packages/server/src/index.ts
 M packages/server/src/server.ts
?? packages/server/test/
```

`git diff --stat`:

```
 packages/ai-server/src/index.ts |   2 +-
 packages/server/src/index.ts    | 268 ++++++++++++++++++++++++++++------------
 packages/server/src/server.ts   |  18 ++-
 3 files changed, 196 insertions(+), 92 deletions(-)
```

## 5. Deviations

1. Test harness portability fix (Windows): the first run of Step 3 failed before any test executed with `HARNESS ERROR ... ERR_UNSUPPORTED_ESM_URL_SCHEME ... On Windows, absolute paths must be valid file:// URLs` (exit 2), because the harness passes an absolute Windows path to `node --import`. Two lines were changed in `packages/server/test/e2e-sessions.mjs` only: `import { fileURLToPath } from "node:url"` became `import { fileURLToPath, pathToFileURL } from "node:url"` and `["--import", STUB, SERVER_JS]` became `["--import", pathToFileURL(STUB).href, SERVER_JS]`. No test logic or assertions were changed. After this fix, all 15 tests pass unmodified.
2. `packages/ai-server/src/index.ts` appears modified in `git status`: this is a pre-existing uncommitted working-tree change (a prompt-text edit adding "Dont at all repeat same tool call , just dont do it" to rule 10). It was NOT made by me; I did not edit any file outside `packages/server/src/server.ts`, `packages/server/src/index.ts`, and `packages/server/test/`.
3. The 4 source/test files were written in chunks by the editor due to a per-call size limit; the content is identical to the provided code (editor wrote CRLF line endings, consistent with the files on disk). No other content deviations.
4. The 4 builds were executed in the specified order; for the final per-build exit-code capture in section 3 they were re-run (idempotent) as separate commands.
