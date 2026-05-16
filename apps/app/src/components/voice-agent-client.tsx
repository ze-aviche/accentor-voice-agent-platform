import {
  RoomAudioRenderer,
  SessionProvider,
  useSession,
  useVoiceAssistant,
} from "@livekit/components-react"
import { ConnectionState, TokenSource } from "livekit-client"
import { AgentAudioVisualizerRadial } from "@workspace/ui/components/agents-ui/agent-audio-visualizer-radial"
import {
  AgentControlBar,
  type AgentControlBarControls,
} from "@workspace/ui/components/agents-ui/agent-control-bar"
import { Button } from "@workspace/ui/components/button"
import { env } from "@/lib/env"

const tokenSource = TokenSource.endpoint(`${env.API_URL}/token`)

function AgentAudioVisualizer() {
  const { state, audioTrack } = useVoiceAssistant()
  return (
    <AgentAudioVisualizerRadial
      size="lg"
      state={state}
      audioTrack={audioTrack}
    />
  )
}

export function VoiceAgentClient() {
  const session = useSession(tokenSource)

  async function handleConnect() {
    await session.start()
  }

  async function handleDisconnect() {
    await session.end()
  }

  const isConnected = session.isConnected
  const isConnecting = session.connectionState === ConnectionState.Connecting

  const controls: AgentControlBarControls = {
    leave: true,
    microphone: true,
    chat: false,
    camera: false,
    screenShare: false,
  }

  return (
    <SessionProvider session={session}>
      <div className="flex flex-col gap-8">
        {isConnected ? (
          <>
            <RoomAudioRenderer />
            <AgentAudioVisualizer />
            <AgentControlBar
              controls={controls}
              isConnected={isConnected}
              onDisconnect={handleDisconnect}
            />
          </>
        ) : (
          <>
            <AgentAudioVisualizerRadial
              size="lg"
              state={isConnecting ? "connecting" : "disconnected"}
            />
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="my-3"
            >
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          </>
        )}
      </div>
    </SessionProvider>
  )
}
