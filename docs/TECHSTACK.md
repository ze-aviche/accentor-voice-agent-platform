# Tech Stack

A reference of every technology used in PhoneFlow and *why* it's there. Knowing the
"why" matters more in an interview than the name-dropping.

## Language & tooling

| Tool | Version | Role |
|------|---------|------|
| **TypeScript** | 5.9 | Single language across backend, frontend, agent, and shared packages. End-to-end type safety. |
| **Node.js** | 22 | Runtime for the API and the voice agent. |
| **pnpm** | 10/11 | Package manager. Chosen for a **monorepo workspace** with a shared dependency **catalog** (single source of truth for versions). |
| **Biome** | 2.3 | Linter + formatter (a faster, single-binary alternative to ESLint + Prettier). |
| **Zod** | 4.x | Runtime schema validation, shared between client and server. |

## Monorepo

- **pnpm workspaces** (`pnpm-workspace.yaml`) — `apps/*` and `packages/*`.
- **Catalog** pins versions once and every package references them with `catalog:`.
- Internal packages are imported by name: `@workspace/db`, `@workspace/shared`, `@workspace/ui`, `@workspace/email`.
- Why a monorepo: the **DB schema, API request/response types, and domain constants are shared** between the API, the React app, and the voice agent. One change to `AgentConfig` propagates everywhere with compile-time safety.

## Backend API (`apps/api`)

| Tech | Role |
|------|------|
| **Hono** | Lightweight, fast web framework (Express-like, edge-ready). Hosts all REST routes. |
| **@hono/node-server** | Adapter to run Hono on Node. |
| **@hono/zod-validator** | Request body/param validation against shared Zod schemas. |
| **better-auth** | Full auth stack — email/password, Google OAuth, sessions, and a multi-tenant **organization** plugin. |
| **Drizzle ORM** | Type-safe SQL query builder + schema-as-code. |
| **drizzle-kit** | Migrations / schema push / Drizzle Studio. |
| **PostgreSQL** (Supabase) | Primary datastore. |
| **livekit-server-sdk** | Server-side LiveKit control: mint access tokens, dispatch agents, provision SIP trunks, place outbound calls. |
| **rolldown** | Bundler for the production build. |

## Voice agent (`apps/voice-agent`)

This is a **separate long-running worker process**, not part of the HTTP API.

| Tech | Role |
|------|------|
| **@livekit/agents** | The agent framework — `AgentSession`, the STT→LLM→TTS voice pipeline, and the **inference gateway** (`inference.STT/LLM/TTS`) that proxies to model providers through LiveKit Cloud. |
| **@livekit/agents-plugin-silero** | **Silero VAD** — voice activity detection (knows when the caller is speaking vs. silent). |
| **@livekit/agents-plugin-livekit** | **Turn detector** — an ONNX model that decides when the user has finished their turn (end-of-utterance), in English or multilingual variants. |
| **@livekit/plugins-ai-coustics** | Real-time **noise cancellation / audio enhancement** (native binary, model `quailVfS`). |
| **livekit-server-sdk** | Used to forcibly end a call (remove participant + shut down the job). |

### The inference gateway (important talking point)

STT, LLM and TTS are **not** called with individual provider SDKs/keys. They go through
LiveKit's inference gateway: you pass a string like `deepgram/nova-3`, `openai/gpt-4.1-mini`,
or `cartesia/sonic-3`, and LiveKit Cloud routes to that provider and bills through your
LiveKit account. This is why the platform can offer **mix-and-match providers** with a
single set of credentials and no key management per provider.

## Frontend (`apps/app`)

| Tech | Role |
|------|------|
| **React 19** | UI library. |
| **Vite 7** | Dev server + build tool. |
| **TanStack Router** | File-based, type-safe routing with loaders and route context. |
| **TanStack Query (React Query)** | Server-state: fetching, caching, invalidation. The server is the source of truth. |
| **Zustand** | Client-only state for the flow editor (the in-progress, unsaved canvas). |
| **@xyflow/react** (React Flow) | The node/edge **canvas** for the visual flow builder. |
| **livekit-client** + **@livekit/components-react** | In-browser voice testing of an agent before publishing. |
| **react-hook-form** + **@hookform/resolvers** + **Zod** | Forms with schema validation. |
| **@tanstack/react-table** | Data tables for agents, calls, phone numbers. |

## Shared packages

| Package | Contents |
|---------|----------|
| **@workspace/shared** | The `AgentConfig` type + Zod schemas, all API request/response types, and domain constants: the model catalog (STT/LLM/TTS providers, models, per-minute prices), voice catalog, and cost rates. |
| **@workspace/db** | Drizzle schema (agents, agent_versions, calls, phone_numbers + better-auth tables), client, migrations. |
| **@workspace/ui** | Design system: shadcn / **base-ui** components, Tailwind CSS v4, Lucide icons, `sonner` toasts, `next-themes`, `motion`. |
| **@workspace/email** | react-email templates + nodemailer transport (transactional email). |

## UI layer

- **Tailwind CSS v4** (via `@tailwindcss/vite`).
- **shadcn** + **@base-ui/react** for accessible primitives.
- **lucide-react** icons, **sonner** toasts, **next-themes** dark mode, **motion** animations.

## Infrastructure & deployment

- **Docker** — multi-stage `Dockerfile` builds the voice agent, prunes to prod deps, runs as a non-root user, and pre-downloads model files at build time.
- **LiveKit Cloud** — WebRTC media server, agent dispatch, SIP trunking, and the inference gateway. Agent deployed via `lk agent deploy` (`apps/voice-agent/livekit.toml`).
- **Supabase** — managed PostgreSQL.
- **SIP** — phone numbers from any provider (Twilio, Telnyx, Zadarma…) connected via SIP trunk credentials.
