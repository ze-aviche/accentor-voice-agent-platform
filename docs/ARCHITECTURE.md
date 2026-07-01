# Architecture

PhoneFlow is an open-source platform for building **voice AI agents** as visual
node-graphs and deploying them to handle real **inbound and outbound phone calls** (and
in-browser web calls), with full per-call cost tracking.

This document explains how the pieces fit together.

---

## 1. High-level component map

```
                       ┌──────────────────────────┐
                       │   React app (apps/app)    │  ← humans build & test agents
                       │  Vite · TanStack · Zustand│
                       └────────────┬─────────────┘
                                    │ REST + cookies (session auth)
                                    ▼
                       ┌──────────────────────────┐
                       │    API (apps/api)         │  ← Hono + better-auth + Drizzle
                       │  REST · auth · LiveKit ctl│
                       └───┬───────────────┬───────┘
            Bearer token   │               │  livekit-server-sdk
        (service-to-svc)   │               │  (dispatch, SIP, tokens)
                           ▼               ▼
        ┌──────────────────────────┐   ┌─────────────────────────────┐
        │ Voice agent              │   │   LiveKit Cloud             │
        │ (apps/voice-agent)       │◄──┤  WebRTC media · agent       │
        │ LiveKit Agents worker    │   │  dispatch · SIP trunks ·    │
        │ STT→LLM→TTS flow runtime │   │  inference gateway          │
        └──────────────────────────┘   └─────────────────────────────┘
                           │
                           ▼
                  ┌──────────────────┐        ┌──────────────────┐
                  │  PostgreSQL      │        │ Phone network    │
                  │  (Supabase)      │        │ (SIP providers)  │
                  └──────────────────┘        └──────────────────┘
```

There are **three deployable units** plus shared libraries:

1. **`apps/api`** — the control plane. A Hono REST API that owns auth, persistence, and all LiveKit orchestration.
2. **`apps/app`** — the React single-page app where users build, version, and test agents and view call logs.
3. **`apps/voice-agent`** — a long-running LiveKit Agents **worker** that actually runs a live conversation when a call connects.

Shared packages (`@workspace/shared`, `@workspace/db`, `@workspace/ui`, `@workspace/email`) keep types, schema, and constants consistent across all three.

---

## 2. The domain model

(See [`packages/db/src/schema`](../packages/db/src/schema) and [`packages/shared/src/api/agent-config`](../packages/shared/src/api/agent-config).)

- **organization** — the tenant boundary. Every agent, call, and phone number belongs to one. Users join orgs through **member**/**invitation** (better-auth organization plugin).
- **agent** — a voice agent. Holds a mutable working `config` (JSONB).
- **agent_version** — an **immutable snapshot** of an agent's config, with a per-agent incrementing `number`. Publishing copies the working config into a new version. Enables iteration, rollback, and A/B-style selection. Unique `(agentId, number)`.
- **phone_number** — an imported number with SIP credentials, optionally bound to an agent (and a specific version) to answer inbound calls.
- **call** — one conversation. Records channel (`web_call`/`phone_call`), direction (`inbound`/`outbound`), status, from/to numbers, timestamps, duration, the **exact STT/LLM/TTS models used**, and a **6-way cost breakdown** (stt, llm, tts, telephony, platform, total).

### AgentConfig — the heart of the system

A single JSON object (validated by Zod in `@workspace/shared`) that fully describes an agent:

```jsonc
{
  "stt": { "model": "deepgram/nova-3", "language": "en" },
  "llm": { "model": "openai/gpt-4.1-mini" },
  "tts": { "model": "cartesia/sonic-3", "voice": "..." },
  "turnDetection": { "model": "english" },
  "globalPrompt": "You are a helpful receptionist...",
  "nodes": [ /* conversation & end nodes, with canvas positions */ ],
  "edges": [ /* transitions with natural-language conditions */ ]
}
```

The same `AgentConfig` type is used by the **editor** (frontend), stored in the **DB**, returned by the **API**, and executed by the **voice agent** — one contract, three consumers.

### The flow graph

A conversation is a **directed graph**:
- **Conversation nodes** carry instructions (`prompt` = guidance for the LLM, or `say` = exact words). Exactly one is the **start node**; it can specify who speaks first.
- **End nodes** terminate the call.
- **Edges** carry a **natural-language condition** ("caller wants to book an appointment"). At runtime each outgoing edge becomes an **LLM tool**; when the model decides a condition is met, it "calls" that tool and the conversation transitions to the target node.

This is the key design idea: **graph edges are compiled into LLM tools**, so transitions are model-driven but bounded by the graph the user drew.

---

## 3. Request/auth model

Two distinct auth paths into the API:

1. **Session auth (humans).** The React app uses better-auth (email/password or Google OAuth). Sessions are cookie-based. A `requireOrganization` middleware resolves the session, reads `activeOrganizationId`, and scopes every query to that org — this enforces multi-tenancy.
2. **Service token (the voice agent).** The voice agent calls back into the API with `Authorization: Bearer ${API_TOKEN}` (`requireAuthToken` middleware). This is how a running call records its start/completion without a user session. `API_TOKEN` must match in `apps/api/.env` and `apps/voice-agent/.env`.

CORS is locked to `FRONTEND_URL` with credentials enabled.

---

## 4. Building & testing an agent (design-time flow)

1. User opens the agent editor. The React app loads the agent + config via TanStack Query **loaders**.
2. The editor state lives in a **Zustand store** — the canvas (React Flow) nodes/edges, the selected node/edge, and the side-panel mode. This is the *unsaved working copy*.
3. The user edits nodes (prompts), edges (conditions), models, voices, and the global prompt. Prices per minute are shown per model (from the shared model catalog).
4. **Dynamic variables**: prompts/conditions can contain `{{ variable }}` placeholders. The editor scans the whole config for variable names so they can be supplied during testing.
5. **In-editor testing**: the app requests a LiveKit token (`POST /api/token`), opens a **browser WebRTC session** via `livekit-client`, and passes `agentId`/variables as participant attributes. The same voice-agent worker handles this as a `web_call`, so you test the real runtime.
6. **Save** PATCHes the working config. **Publish** creates an immutable `agent_version`.

---

## 5. Placing/receiving a call (run-time flow)

The API never runs the conversation itself — it **orchestrates LiveKit**, and the **voice-agent worker** runs the conversation. Rooms are named with a `call-` prefix.

### Outbound
1. Client calls `POST /api/calls/outbound` with phone number, target, agent (+ optional version) and variables.
2. API uses `livekit-server-sdk`:
   - `AgentDispatchClient.createDispatch()` — dispatches the named agent into a fresh room, with metadata (`direction: outbound`, agentId, versionId, from/to numbers).
   - `SipClient.createSipParticipant()` — dials the destination number over the phone number's SIP trunk and joins it to the room.
3. The voice-agent worker is dispatched into the room (see §6).

### Inbound
1. When a phone number is created with SIP credentials, the API **provisions** a LiveKit SIP inbound trunk + a **dispatch rule** that routes incoming calls on that number to the named agent (metadata `direction: inbound`). Editing/deleting the number re-provisions/deprovisions.
2. A real incoming call hits the trunk, LiveKit creates a room and dispatches the agent.

### Web
- The in-browser test path; the agent joins the browser's room as a `web_call`.

---

## 6. Inside the voice agent (the conversation runtime)

(See [`apps/voice-agent/src/main.ts`](../apps/voice-agent/src/main.ts) and [`src/flow`](../apps/voice-agent/src/flow).)

1. **Prewarm**: the worker loads the Silero VAD model on startup.
2. **On connect**: it parses the dispatch metadata, waits for the participant, and calls back to the API (`/calls/start/{web|inbound|outbound}`) — which **creates the `call` row and returns the resolved `AgentConfig`** to run.
3. **Session assembly**: an `AgentSession` is built with:
   - `inference.STT/LLM/TTS` from the config (the inference gateway — no per-provider keys),
   - **Silero VAD** (is the caller speaking?),
   - **turn detection** model (has the caller finished their turn?),
   - **ai-coustics** noise cancellation on the input audio.
4. **Flow execution**: `buildFlowGraph(config)` turns the config into a runtime graph. A `FlowAgent` (extends `voice.Agent`):
   - composes each node's effective prompt = global prompt + flow rules + node instructions, with `{{variables}}` substituted (including computed `date`/`time` and the caller's phone number),
   - exposes each outgoing edge as an **LLM transition tool** named after the target node,
   - on a tool call, **transitions** the active node (swaps instructions + tools, optionally speaks), or **ends the call** at an end node.
5. **On disconnect / end**: the agent calls `/calls/complete`. The API computes the **cost breakdown** from duration × per-minute model prices (+ telephony for phone calls + a flat platform rate) and finalizes the call.

So the **division of labor** is: API = state + orchestration + billing; voice-agent = real-time media + LLM conversation loop; LiveKit = transport, dispatch, SIP, and model inference.

---

## 7. Why it's structured this way (design rationale)

- **Separate agent worker from the API** because a voice conversation is a stateful, long-lived, CPU/media-heavy process with a very different scaling profile than stateless HTTP. LiveKit dispatch lets many concurrent calls run as independent agent jobs.
- **Inference gateway instead of provider SDKs** removes per-provider key management and makes "mix and match STT/LLM/TTS with visible per-minute pricing" a first-class feature.
- **Immutable versions** give safe iteration and rollback for something that talks to real customers.
- **Config-as-data (`AgentConfig`)** means the visual editor, storage, and runtime all share one validated contract — no drift between what you draw and what runs.
- **Graph edges as LLM tools** balances control (you bound the paths) with flexibility (the model decides when a condition is met).
- **Monorepo + shared package** keeps the three runtimes type-safe against one source of truth.
- **Multi-tenant from the schema up** — every domain row is org-scoped and enforced in middleware.

---

## 8. Key files to know (for code walk-throughs)

| Concern | File |
|---------|------|
| API wiring / CORS / route mounting | [`apps/api/src/api.ts`](../apps/api/src/api.ts) |
| LiveKit orchestration (dispatch, SIP, outbound) | [`apps/api/src/lib/livekit.ts`](../apps/api/src/lib/livekit.ts) |
| Cost computation | [`apps/api/src/lib/call-cost.ts`](../apps/api/src/lib/call-cost.ts) |
| Auth + org/token middleware | [`apps/api/src/lib/auth`](../apps/api/src/lib/auth) |
| Agent config contract | [`packages/shared/src/api/agent-config`](../packages/shared/src/api/agent-config) |
| DB schema | [`packages/db/src/schema`](../packages/db/src/schema) |
| Agent runtime / session | [`apps/voice-agent/src/main.ts`](../apps/voice-agent/src/main.ts) |
| Flow runtime (nodes→tools) | [`apps/voice-agent/src/flow/agent.ts`](../apps/voice-agent/src/flow/agent.ts) |
| Editor state | [`apps/app/src/stores/agent.ts`](../apps/app/src/stores/agent.ts) |
| Visual canvas | [`apps/app/src/components/flow/canvas.tsx`](../apps/app/src/components/flow/canvas.tsx) |
| In-browser test client | [`apps/app/src/components/voice-agent-client.tsx`](../apps/app/src/components/voice-agent-client.tsx) |
