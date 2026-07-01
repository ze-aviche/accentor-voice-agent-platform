# Telephony — Inbound & Outbound Call Flow

How a real phone call travels between **Twilio**, **LiveKit**, the **API**, and the
**voice agent** in PhoneFlow. This documents the actual code paths, not a generic diagram.

> **Terminology:** a Twilio **Elastic SIP Trunk** has two independent sides:
> - **Termination** — Twilio *receives* SIP from us and dials out to the PSTN → used for **outbound**. Authenticated with a **Credential List** (username/password).
> - **Origination** — Twilio *forwards* incoming PSTN calls to a SIP URI → used for **inbound**. Points at our **LiveKit SIP URI**.

---

## Cast of components

| Component | Role |
|-----------|------|
| **Twilio** | Owns the PSTN phone number; bridges phone network ↔ SIP via the Elastic SIP Trunk. |
| **LiveKit Cloud** | WebRTC/SIP media server. Runs SIP trunks + dispatch rules, hosts the room, dispatches the agent, and proxies STT/LLM/TTS via the inference gateway. |
| **API** (`apps/api`) | Control plane. Provisions LiveKit SIP resources, places outbound calls, and records call rows + cost. |
| **Voice agent** (`apps/voice-agent`) | LiveKit Agents worker. Joins the room, runs the STT→LLM→TTS conversation, and calls the API to start/complete the call. |
| **Postgres** | Stores phone numbers (with SIP creds + bound agent) and call records. |

Two auth paths into the API:
- **Session cookie** — the human triggering an outbound call from the UI (`requireOrganization`).
- **Bearer `API_TOKEN`** — the voice agent calling back to start/complete a call (`requireAuthToken`). Must match in `apps/api/.env` and `apps/voice-agent/.env`.

---

## Configuration prerequisites (one-time)

### Twilio trunk
- **Termination SIP URI**: `your-trunk.pstn.twilio.com` → stored as the phone number's **`sipAddress`**.
- **Credential List** (username/password) attached to Termination → stored as **`sipUsername`** / **`sipPassword`**.
- **Origination URI**: `sip:<project>.sip.livekit.cloud` (e.g. `sip:2tm08p5mus4.sip.livekit.cloud`) → routes inbound calls to LiveKit.
- A purchased **phone number** attached to the trunk → stored as **`number`** (E.164).

### In the app
Adding a phone number (`POST /api/phone-numbers`) stores `number`, `sipAddress`,
`sipUsername`, `sipPassword`, and (optionally) the bound `agentId` / `agentVersionId`.
If `sipUsername` is present, the API immediately **provisions LiveKit inbound resources**
(see below). Editing re-provisions; deleting deprovisions.

---

## INBOUND — someone calls your number

Direction of setup: Twilio **Origination** → LiveKit SIP URI.

### Provisioning (happens when the number is saved)
[`apps/api/src/lib/livekit.ts` → `provisionInbound()`](../apps/api/src/lib/livekit.ts#L36-L60)

1. Gate: only proceeds if the number has a `sipUsername`.
2. `sip.createSipInboundTrunk(number, [number])` — creates a LiveKit **inbound SIP trunk** keyed to that exact E.164 number.
3. `sip.createSipDispatchRule(...)` — creates a **dispatch rule** that, for calls on that trunk, spins up an individual room (prefix `call-`) and **dispatches the named agent** (`LIVEKIT_AGENT_NAME`) with metadata `{ direction: "inbound" }`.

### Live call flow

```
 Caller's phone
     │  dials +1... (PSTN)
     ▼
 ┌─────────┐   Origination URI
 │ Twilio  │  ───────────────────►  sip:2tm08p5mus4.sip.livekit.cloud
 │ trunk   │                         │
 └─────────┘                         ▼
                              ┌───────────────┐
                              │ LiveKit Cloud │
                              │ inbound trunk │  matches call to the trunk for that number
                              │ dispatch rule │  creates room "call-…" + dispatches agent
                              └───────┬───────┘
                                      │ (metadata: direction=inbound)
                                      ▼
                            ┌────────────────────┐
                            │ Voice agent worker │  joins the room
                            └─────────┬──────────┘
                                      │ POST /calls/start/inbound  (Bearer API_TOKEN)
                                      │   toNumber = sip.trunkPhoneNumber (the dialed number)
                                      │   fromNumber = sip.phoneNumber   (the caller)
                                      ▼
                            ┌────────────────────┐
                            │        API         │
                            │ • look up phone#   │  find the number → its bound agentId/versionId
                            │ • resolveAgentConfig│  load the AgentConfig to run
                            │ • INSERT call row   │  channel=phone_call, direction=inbound, in_progress
                            └─────────┬──────────┘
                                      │ returns { callId, config }
                                      ▼
                            ┌────────────────────┐
                            │ Voice agent        │  builds AgentSession (STT/LLM/TTS via
                            │                    │  inference gateway) + flow graph, talks
                            └─────────┬──────────┘
                                      │ on hangup/disconnect
                                      │ POST /calls/complete → API computes cost, marks completed
                                      ▼
                                   Postgres
```

### Key code
- Agent resolution: [`routes/calls.ts` `/start/inbound`](../apps/api/src/routes/calls.ts#L129-L192) — matches `payload.toNumber` to a phone number row, requires it has a bound `agentId`, else 404.
- The dialed number arrives as the LiveKit attribute `sip.trunkPhoneNumber`; the caller as `sip.phoneNumber` ([`voice-agent/src/lib/calls.ts`](../apps/voice-agent/src/lib/calls.ts#L47-L64)).

### Inbound gotchas
- The **`number` in the app must exactly match** the E.164 form of the Twilio number, or LiveKit can't match the incoming call to a trunk.
- The number must be **bound to an agent** in the app, or `/start/inbound` returns 404 and the call fails.
- LiveKit project must have **SIP enabled** (it is — you have a SIP URI).

---

## OUTBOUND — the agent calls a number

Direction of setup: LiveKit → Twilio **Termination** (authenticated with the Credential List).

### Trigger
[`routes/calls.ts` `/outbound`](../apps/api/src/routes/calls.ts#L339-L419) (session-authenticated, from the UI):
1. Looks up the phone number by `phoneNumberId` (scoped to the org) and reads its `number` + SIP creds.
2. Rejects with 400 if the number has no `sipAddress`/`sipUsername`/`sipPassword` ("no SIP connection").
3. Validates the target agent (+ optional version) exists.
4. Calls `placeOutboundCall(...)`.

### Placement
[`lib/livekit.ts` → `placeOutboundCall()`](../apps/api/src/lib/livekit.ts#L91-L123)
1. Generates a room name `call-<uuid>`.
2. `AgentDispatchClient.createDispatch()` — dispatches the named agent into that room with metadata `{ direction: "outbound", agentId, agentVersionId, fromNumber, toNumber }`.
3. `SipClient.createSipParticipant(...)` with `SIPOutboundConfig({ hostname: sipAddress, authUsername: sipUsername, authPassword: sipPassword })` — tells LiveKit to place a SIP call **to Twilio Termination**, which dials the destination over the PSTN. The caller ID is `fromNumber`; call variables ride along as participant attributes.

### Live call flow

```
  UI  ──POST /api/calls/outbound──►  API  (session auth)
                                      │ placeOutboundCall()
                                      ▼
                            ┌───────────────┐
                            │ LiveKit Cloud │  1) dispatch agent into room "call-…"
                            │               │  2) create SIP participant →
                            └──────┬────────┘     dials Twilio Termination
                                   │ SIP INVITE + Credential List auth
                                   ▼
                            ┌─────────┐   Termination URI
                            │ Twilio  │   your-trunk.pstn.twilio.com
                            │ trunk   │ ─────────────► PSTN ─────► destination phone rings
                            └─────────┘
                                   │
   (meanwhile, in the room)        │
   ┌────────────────────┐          │
   │ Voice agent worker │◄─────────┘  (already dispatched, metadata=outbound)
   │                    │  POST /calls/start/outbound  (Bearer API_TOKEN)
   │                    │    agentId, fromNumber, toNumber from metadata
   └─────────┬──────────┘
             │  API: resolveAgentConfig → INSERT call (direction=outbound) → { callId, config }
             ▼
   Agent talks (STT/LLM/TTS via inference gateway); on hangup:
             │  POST /calls/complete → API computes cost, marks completed
             ▼
          Postgres
```

### Key difference from inbound
- Inbound resolves the agent **from the phone number's binding**; outbound is **told the agent** explicitly in the request (and passed through dispatch metadata).
- Outbound uses the Credential List (**Termination**); inbound uses the Origination URI. The four app fields (`sipAddress`/`sipUsername`/`sipPassword`/`number`) are the **Termination/outbound** side — the Origination URI lives only in Twilio.

---

## WEB calls (for contrast)

No Twilio, no SIP. The browser opens a WebRTC session to LiveKit with a token
(`POST /api/token`), passing `agent_id` as an attribute. The same worker handles it as
`channel: web_call`, calling `POST /calls/start/web`. This is why web-call testing works
with zero telephony configuration.

---

## Call lifecycle (shared by all channels)

1. **Dispatch/join** — agent enters the LiveKit room (dispatched for phone, or the browser joins for web).
2. **Start** — agent → `POST /calls/start/{inbound|outbound|web}` → API resolves the `AgentConfig`, inserts an `in_progress` call row, returns `{ callId, config }`.
3. **Converse** — agent builds an `AgentSession` (STT/LLM/TTS + Silero VAD + turn detection + ai-coustics noise cancellation) and runs the flow graph.
4. **Complete** — on disconnect, agent → `POST /calls/complete` → API sets `endedAt`, `durationMs`, computes the 6-way cost breakdown (STT/LLM/TTS/telephony/platform/total), marks `completed`.

---

## Field → source cheat sheet

| App field | Twilio source | Used for |
|-----------|---------------|----------|
| `number` | The purchased number attached to the trunk (E.164) | Inbound matching + outbound caller ID |
| `sipAddress` | Trunk **Termination SIP URI** (`*.pstn.twilio.com`) | Outbound (LiveKit → Twilio) |
| `sipUsername` | **Credential List** username | Outbound auth |
| `sipPassword` | **Credential List** password | Outbound auth |
| *(Twilio Origination URI)* | `sip:<project>.sip.livekit.cloud` — **set in Twilio, not the app** | Inbound (Twilio → LiveKit) |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Inbound call rings then drops | Number not bound to an agent (→ `/start/inbound` 404), or app `number` doesn't match Twilio number in E.164. |
| Inbound never reaches LiveKit | Origination URI missing/wrong on the Twilio trunk. |
| Outbound "no SIP connection" (400) | `sipAddress`/`sipUsername`/`sipPassword` blank on the phone number. |
| Outbound rejected by Twilio (SIP 403/407) | Credential List not attached to Termination, or wrong username/password. |
| Outbound to some countries blocked | Twilio **Voice Geographic Permissions** — enable the destination country. |
| Any SIP call fails immediately | LiveKit project SIP not enabled, or `API_TOKEN` mismatch so the agent can't start the call. |
