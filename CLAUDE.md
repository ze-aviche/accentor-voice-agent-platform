# CLAUDE.md

Guidance for working in this repository.

## What this is

**PhoneFlow** — an open-source voice agent platform. Build voice agents as a graph of
nodes/edges on a canvas, deploy them to handle inbound/outbound phone calls, and monitor
calls and cost. Voice pipeline (STT/LLM/TTS) runs on **LiveKit Agents** using LiveKit's
**inference gateway** — LiveKit Cloud proxies to the underlying providers and bills through
your LiveKit account, so no separate OpenAI/Deepgram/Cartesia/etc. API keys are required.

## Monorepo layout

pnpm workspace (`pnpm-workspace.yaml`), package versions pinned via the `catalog:` field.

| Path | Name | Purpose |
|------|------|---------|
| `apps/api` | `api` | Hono backend (auth, REST routes, LiveKit dispatch). Dev port `3000`. |
| `apps/app` | `app` | React 19 + Vite + TanStack Router frontend. Dev port `5173`. |
| `apps/voice-agent` | `voice-agent` | LiveKit Agents worker that runs the call flow. |
| `packages/db` | `@workspace/db` | Drizzle ORM schema + migrations (Postgres). |
| `packages/email` | `@workspace/email` | react-email templates + nodemailer transport. |
| `packages/shared` | `@workspace/shared` | Shared types/schemas (zod). |
| `packages/ui` | `@workspace/ui` | shadcn/base-ui component library. |

Tooling: **Biome** for lint/format (`biome.json`), **TypeScript 5.9**, **Node 22**.

## Commands

Run from the repo root unless noted. Package manager is **pnpm** (v10).

```bash
pnpm install                          # install all workspace deps

# Database (run inside packages/db, or: pnpm --filter @workspace/db <script>)
pnpm --filter @workspace/db push      # push schema to the database
pnpm --filter @workspace/db generate  # generate SQL migrations
pnpm --filter @workspace/db migrate   # apply migrations
pnpm --filter @workspace/db studio    # open Drizzle Studio

# Dev servers (run each in its own terminal)
pnpm --filter api dev                 # backend  -> http://localhost:3000
pnpm --filter app dev                 # frontend -> http://localhost:5173
pnpm --filter voice-agent dev         # LiveKit agent worker (dev mode)

# Quality
pnpm typecheck                        # tsc --noEmit (root)
pnpm lint                             # biome lint
pnpm format                           # biome check --write

# Voice agent deploy (LiveKit Cloud)
pnpm agent:deploy                     # lk agent deploy (uses apps/voice-agent/livekit.toml)
```

### First-run setup (in order)

```bash
pnpm install
pnpm approve-builds                   # approve native build scripts: esbuild, msw,
                                      #   onnxruntime-node, protobufjs, sharp (press a → Enter → y)

# set env vars (see below), then:
cp packages/db/.env.example packages/db/.env   # drizzle-kit reads DATABASE_URL from here
pnpm --filter @workspace/db push      # create the schema in Postgres

pnpm --filter voice-agent download-files   # one-time: fetch Silero VAD + turn-detector ONNX models

# then start the three dev servers, each in its own terminal:
pnpm --filter api dev
pnpm --filter app dev
pnpm --filter voice-agent dev
```

### Windows native-binary gotcha (voice-agent)

The lockfile was generated on macOS/Linux, so pnpm skips the Windows-only native binaries on
a Windows machine. If the voice-agent fails with `Failed to load a native binding library`
(`@livekit/plugins-ai-coustics`), install the Windows binary explicitly:

```bash
pnpm --filter voice-agent add "@livekit/plugins-ai-coustics-x86_64-pc-windows-msvc@0.2.13"
```

(Match the version to the installed `@livekit/plugins-ai-coustics`.)

### Supabase / Postgres caveat (db push)

`packages/db/drizzle.config.ts` sets `schemaFilter: ["public"]`. This is required when
`DATABASE_URL` points at Supabase: Supabase ships managed schemas (`auth`, `storage`,
`realtime`, `vault`, `extensions`, …) and without the filter `drizzle-kit push` will try to
**drop them**. With the filter, push only creates/updates the app's tables in `public`.
If `push` ever asks "is X renamed from another table?", always choose **`+ create table`**.

## Environment / API keys

Each app reads its own `.env` (see `*/src/lib/env.ts`). Status of the keys currently in the
forked `.env` files:

**Already set (✓):** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in
`apps/api/.env` and `apps/voice-agent/.env`. These cover the whole voice pipeline via the
inference gateway.

**Still required before the app runs (✗ currently blank):**

- `apps/api/.env`
  - `DATABASE_URL` — Postgres connection string. **Required.**
  - `BETTER_AUTH_SECRET` — random secret for session signing. **Required** (e.g. `openssl rand -hex 32`).
  - `API_TOKEN` — shared secret the voice-agent uses to call the API. **Required**, and must
    match `API_TOKEN` in `apps/voice-agent/.env`.
- `apps/voice-agent/.env`
  - `API_TOKEN` — must equal the value in `apps/api/.env`. **Required.**
- `packages/db/.env` — copy from `.env.example` and set `DATABASE_URL` (used by drizzle-kit).

**Optional:**

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (api) — only for Google OAuth login. Email +
  password auth works without them.
- `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASS` (`@workspace/email`) — only for
  sending email (e.g. SMTP). Not set anywhere by default.

So: **the LiveKit keys are present and sufficient for voice/inference, but the app will not
start until `DATABASE_URL`, `BETTER_AUTH_SECRET`, and a matching `API_TOKEN` (api + voice-agent)
are filled in.**

> Note: the `.env` files contain real LiveKit credentials. Treat them as secrets — they are
> gitignored; do not commit them.
