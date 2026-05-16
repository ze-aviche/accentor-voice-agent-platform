import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useShallow } from "zustand/react/shallow"
import { useFlowStore } from "@/stores/flow"

const selector = (state) => ({
  nodes: state.nodes,
  edges: state.edges,
  onNodesChange: state.onNodesChange,
  onEdgesChange: state.onEdgesChange,
  onConnect: state.onConnect,
})

export function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } =
    useFlowStore(useShallow(selector))

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#d4d4d4" />
      <Controls position="bottom-left" />
      <MiniMap zoomable pannable />
    </ReactFlow>
  )
}
