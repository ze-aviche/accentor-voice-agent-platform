import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import { create } from "zustand"

type FlowState = {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: (changes: NodeChange<Node>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void
  onConnect: (connection: Connection) => void
  setNodes: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
}

const initialNodes: Node[] = [
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

const initialEdges: Edge[] = [
  {
    id: "n1-n2",
    source: "n1",
    target: "n2",
  },
]

export const useFlowStore = create<FlowState>((set, get) => ({
  nodes: initialNodes,
  edges: initialEdges,
  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    })
  },
  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    })
  },
  onConnect: (connection) => {
    set({
      edges: addEdge(connection, get().edges),
    })
  },
  setNodes: (nodes) => {
    set({ nodes })
  },
  setEdges: (edges) => {
    set({ edges })
  },
}))
