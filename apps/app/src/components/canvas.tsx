import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useCallback, useState } from "react"

const initialNodes = [
  {
    id: "n1",
    data: { label: "Node 1" },
    position: { x: 0, y: 0 },
    type: "input",
  },
  {
    id: "n2",
    data: { label: "Node 2" },
    position: { x: 100, y: 100 },
  },
]

const initialEdges = [
  {
    id: "n1-n2",
    source: "n1",
    target: "n2",
  },
]

export function Canvas() {
  const [nodes, setNodes] = useState(initialNodes)
  const [edges, setEdges] = useState(initialEdges)

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )

  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    []
  )

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
