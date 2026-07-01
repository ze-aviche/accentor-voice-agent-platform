# Interview Prep — PhoneFlow Voice Agent Platform

Everything you need to talk confidently about this project. Pair this with
[ARCHITECTURE.md](ARCHITECTURE.md) and [TECHSTACK.md](TECHSTACK.md).

---

## 1. The 30-second pitch

> "PhoneFlow is an open-source platform for building voice AI agents. You design an agent
> visually as a graph of conversation nodes connected by natural-language conditions, pick
> your speech-to-text, LLM, and text-to-speech providers with live per-minute pricing, then
> deploy it to handle real inbound and outbound phone calls. Every call is monitored in real
> time with a full cost breakdown per model. It's a TypeScript monorepo: a Hono REST API, a
> React flow-builder UI, and a separate LiveKit Agents worker that runs the live
> conversation, all backed by Postgres and LiveKit Cloud."

## 2. The two-minute version

Walk the interviewer through the three runtimes:

1. **React app** — visual flow builder on a React Flow canvas; users edit nodes/edges, models, prompts, and **test the agent live in the browser** over WebRTC before publishing immutable versions.
2. **Hono API** — the control plane: auth (better-auth, multi-tenant orgs), persistence (Drizzle + Postgres), and all **LiveKit orchestration** (mint tokens, dispatch agents, provision SIP trunks, place outbound calls). It also computes per-call costs.
3. **LiveKit Agents worker** — when a call connects, this long-running process runs the actual STT→LLM→TTS conversation loop, executing the agent's flow graph.

Then the key insight: **the agent is just data** — one validated `AgentConfig` JSON object shared by the editor, the database, and the runtime. And **graph edges compile into LLM tools**, so transitions are model-driven but bounded by the graph the user drew.

---

## 3. Core concepts you must be able to explain

### a) The flow graph → LLM tools
A conversation is a directed graph of **conversation nodes** (with prompt/say instructions) and **end nodes**, linked by **edges that carry a natural-language condition**. At runtime, every outgoing edge of the current node is turned into an **LLM tool** named after its target. The model converses naturally; when it judges a condition satisfied, it invokes that tool and the runtime transitions — swapping the active node's instructions and tool set, optionally speaking, or ending the call.
> Why it's good: it combines **author control** (you bound the possible paths) with **LLM flexibility** (the model decides *when* to move), and it avoids brittle keyword/intent matching.

### b) The voice pipeline (STT → VAD/turn-detection → LLM → TTS)
- **STT** transcribes the caller.
- **Silero VAD** detects whether the caller is speaking vs. silent.
- A **turn-detection ONNX model** decides when the caller has actually *finished* their turn (end-of-utterance) — critical to not interrupt people.
- **ai-coustics** does real-time noise cancellation on input audio.
- **LLM** generates the response; **TTS** speaks it.
LiveKit's `AgentSession` wires these together.

### c) The inference gateway (a favorite talking point)
STT/LLM/TTS are **not** called with individual provider SDKs or keys. You pass a string like `deepgram/nova-3` or `openai/gpt-4.1-mini` and **LiveKit Cloud's inference gateway** routes to that provider and bills through your LiveKit account.
> Why it matters: it's what makes "mix and match any provider with visible per-minute pricing" a feature, with **zero per-provider key management**.

### d) Immutable versioning
An agent has a mutable working `config`; **publishing** snapshots it into an immutable `agent_version` with an incrementing number. Phone numbers and calls can pin a specific version.
> Why: agents talk to real customers — you need safe iteration, rollback, and the ability to know exactly which behavior handled a given call.

### e) Multi-tenancy
`organization` is the tenant boundary (better-auth organization plugin). Every domain row (agents, calls, phone numbers) is org-scoped, and a `requireOrganization` middleware enforces it on every request using the session's `activeOrganizationId`.

### f) Two auth paths
- **Humans**: session cookies (email/password or Google OAuth).
- **The voice agent → API**: a shared **bearer `API_TOKEN`** (service-to-service), so a running call can record start/completion without a user session.

### g) Config-as-data
One `AgentConfig` type (Zod-validated in `@workspace/shared`) is the contract for the editor, the DB column, the API payloads, and the runtime. No drift between "what you drew" and "what runs."

### h) Inbound vs outbound vs web calls
- **Outbound**: API dispatches the agent into a room *and* creates a SIP participant that dials the target over the number's trunk.
- **Inbound**: creating a phone number provisions a LiveKit SIP trunk + dispatch rule that routes incoming calls to the agent.
- **Web**: the in-browser test path, same runtime, channel = `web_call`.

---

## 4. Architecture decisions & trade-offs (the "why" questions)

| Decision | Why | Trade-off / alternative |
|----------|-----|-------------------------|
| Separate voice-agent worker from the API | Voice calls are stateful, long-lived, media/CPU-heavy — a totally different scaling profile than stateless HTTP. LiveKit dispatch runs each call as an isolated job. | More moving parts; service-to-service auth needed. Alternative: run it in-process (doesn't scale, blocks the API). |
| Inference gateway vs. direct provider SDKs | No key management, uniform pricing model, easy provider swapping. | Vendor coupling to LiveKit; less control over provider-specific features. |
| Edges as LLM tools | Bounded but flexible transitions; no brittle intent matching. | Costs a tool-call decision each turn; depends on model judgement. |
| Monorepo + shared package | One source of truth for types/schema/constants across 3 runtimes. | Build/tooling complexity. |
| Config-as-JSON `AgentConfig` | Editor, storage, runtime share one validated contract. | Schema migrations of a JSONB blob need care. |
| Immutable versions | Safe rollback/iteration for customer-facing behavior. | Storage duplication; must resolve "which version" everywhere. |
| Postgres JSONB for config | Flexible nested structure without dozens of tables. | Less relational queryability of inner fields. |
| better-auth | Email/OAuth/sessions/orgs out of the box. | Less control than hand-rolled auth. |

---

## 5. Likely interview questions & crisp answers

**Q: How does a transition between conversation steps actually work?**
Each outgoing edge becomes an LLM tool whose description is the edge's condition. The LLM calls it when satisfied; the runtime swaps the active node's instructions/tools and optionally speaks. End nodes call `endCall()`, which removes the participant and shuts the job down.

**Q: How do you keep the visual editor and the runtime in sync?**
They share the exact `AgentConfig` type from `@workspace/shared`, validated by the same Zod schema. The editor produces it, the API stores/returns it, the agent executes it.

**Q: How is cost computed?**
On call completion the API takes duration in minutes × each model's per-minute price (STT, LLM, TTS from the shared model catalog), adds a telephony rate (phone calls only) and a flat platform rate, and stores a 6-way breakdown as `numeric(12,6)`.

**Q: How do inbound calls reach the right agent?**
When a phone number with SIP credentials is created, the API provisions a LiveKit SIP inbound trunk and a dispatch rule pointing at the named agent with `direction: inbound` metadata. Incoming calls hit the trunk → LiveKit creates a room → dispatches the agent.

**Q: How does in-browser testing work without a phone?**
The app requests a LiveKit token, opens a WebRTC session in the browser via `livekit-client`, and passes the agentId + variable values as participant attributes. The same worker handles it as a `web_call`.

**Q: What are dynamic variables?**
`{{ name }}` placeholders in prompts/conditions, substituted at call time — including computed `date`/`time` and the caller's phone number, plus per-call values passed in (e.g. for an outbound campaign).

**Q: How is state managed on the frontend?**
**TanStack Query** for server state (fetch/cache/invalidate; server is source of truth). **Zustand** for the local, unsaved editor working copy (canvas nodes/edges, selection, side panel). Saving PATCHes the config and invalidates the relevant queries.

**Q: How do you enforce tenant isolation?**
Every domain table has `organizationId`; a Hono middleware reads the session's active org and scopes all queries. Cross-org access is impossible because the org id comes from the trusted session, not the request body.

**Q: Why a monorepo?**
The DB schema, API contracts, and domain constants are shared by three runtimes. The monorepo + pnpm catalog gives one version source and compile-time safety across all of them.

---

## 6. Things to be honest about (limitations / "what would you improve")

- **Password-reset & some emails are stubbed** to console logs — would wire up the email package fully.
- **Cost model is duration-based**, not true token/character metering — an approximation; real usage metering per provider would be more accurate.
- **JSONB config** isn't independently migratable like relational columns — schema evolution of `AgentConfig` needs versioning discipline.
- **Tightly coupled to LiveKit** (inference + dispatch + SIP) — a deliberate trade for speed, but it's a single-vendor dependency.
- **No automated test suite present** — I'd add contract tests around `AgentConfig` validation and the flow-graph builder first, since they're the highest-leverage invariants.
- **Secrets were committed in `.env`** in the fork — in production these belong in a secrets manager and should be rotated.

Showing you know the weak spots is often worth more than the feature list.

---

## 7. Real engineering story (setup/debugging — great for "tell me about a problem you solved")

Getting this fork running surfaced several real issues worth narrating:

1. **Missing Windows native binary.** The voice agent crashed with `Failed to load a native binding library` for `@livekit/plugins-ai-coustics`. Root cause: the lockfile was generated on macOS/Linux, so pnpm skipped the Windows-only optional binary. Fix: explicitly install `@livekit/plugins-ai-coustics-x86_64-pc-windows-msvc`. *Lesson: optional platform deps + a foreign lockfile.*
2. **Model files not cached.** Agent failed on the turn-detector ONNX model. The framework ships a `download-files` step that must run before first start. *Lesson: ML model assets are a separate provisioning step from npm deps.*
3. **drizzle-kit tried to drop Supabase's schemas.** `db push` wanted to delete `auth`, `storage`, `realtime`, `vault` — Supabase's managed schemas — because the app only declares `public` tables and Drizzle introspected the whole DB. Fix: `schemaFilter: ["public"]` in the Drizzle config. *Lesson: ORM schema sync on a managed Postgres needs scoping or it's destructive.*
4. **Shared service token.** The voice agent talks back to the API with a bearer `API_TOKEN` that must match on both sides — a clean example of service-to-service auth distinct from user sessions.

These are concrete, specific, and show debugging methodology — exactly what "walk me through a hard bug" wants.

---

## 8. One-line glossary

- **STT / LLM / TTS** — speech-to-text / large language model / text-to-speech.
- **VAD** — voice activity detection (is someone speaking).
- **Turn detection** — deciding the caller finished their turn (end-of-utterance).
- **SIP** — the telephony protocol used to connect phone numbers to LiveKit rooms.
- **Dispatch** — LiveKit placing an agent worker into a call room.
- **Inference gateway** — LiveKit Cloud proxying model calls to providers.
- **Flow graph** — the node/edge conversation design.
