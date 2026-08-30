import {
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useState } from 'react'
import {
  type CanvasNodeId,
  type InspectorNode,
  useProjectStore,
} from '../../store/useProjectStore'
import './FlowCanvas.css'
import { AnalysisNode } from './nodes/AnalysisNode'
import { AudioImportNode } from './nodes/AudioImportNode'
import { PitchFixNode } from './nodes/PitchFixNode'

const NODE_LABELS: Record<CanvasNodeId, string> = {
  'audio-import': '\u5bfc\u5165',
  analysis: '\u5206\u6790',
  'pitch-fix': '\u4fee\u97f3',
}

const nodeTypes = {
  audioImport: AudioImportNode,
  analysis: AnalysisNode,
  pitchFix: PitchFixNode,
}

const edges: Edge[] = [
  {
    id: 'audio-import-analysis',
    source: 'audio-import',
    target: 'analysis',
    type: 'smoothstep',
    animated: false,
  },
  {
    id: 'analysis-pitch-fix',
    source: 'analysis',
    target: 'pitch-fix',
    type: 'smoothstep',
    animated: false,
  },
]

function createNodes(
  positions: ReturnType<typeof useProjectStore.getState>['nodePositions'],
): Node[] {
  return [
    {
      id: 'audio-import',
      type: 'audioImport',
      position: positions['audio-import'],
      data: {},
    },
    {
      id: 'analysis',
      type: 'analysis',
      position: positions.analysis,
      data: {},
    },
    {
      id: 'pitch-fix',
      type: 'pitchFix',
      position: positions['pitch-fix'],
      data: {},
    },
  ]
}

function createInspectorNode(id: CanvasNodeId): InspectorNode {
  const state = useProjectStore.getState()

  return {
    id,
    label: NODE_LABELS[id],
    metadata: {
      id,
      label: NODE_LABELS[id],
      position: state.nodePositions[id],
      status: state.status,
      selectedBarIndex: state.selectedBarIndex,
      error: state.error,
      data:
        id === 'audio-import'
          ? {
              track: state.track,
            }
          : id === 'analysis'
            ? {
                analysis: state.analysis,
                barsCount: state.analysis?.bars.length ?? 0,
                pitchCount: state.analysis?.pitch.length ?? 0,
              }
            : {
                plan: state.plan,
                render: state.render,
                playbackSource: state.playbackSource,
              },
    },
  }
}

export function FlowCanvas() {
  const positions = useProjectStore((state) => state.nodePositions)
  const inspectorNodeId = useProjectStore((state) => state.inspectorNode?.id)
  const setNodePosition = useProjectStore((state) => state.setNodePosition)
  const selectInspectorNode = useProjectStore(
    (state) => state.selectInspectorNode,
  )
  const track = useProjectStore((state) => state.track)
  const analysis = useProjectStore((state) => state.analysis)
  const plan = useProjectStore((state) => state.plan)
  const render = useProjectStore((state) => state.render)
  const status = useProjectStore((state) => state.status)
  const error = useProjectStore((state) => state.error)
  const selectedBarIndex = useProjectStore((state) => state.selectedBarIndex)
  const [nodes, setNodes] = useState<Node[]>(() => createNodes(positions))

  const flowNodes = useMemo(() => createNodes(positions), [positions])

  useEffect(() => {
    setNodes(flowNodes)
  }, [flowNodes])

  useEffect(() => {
    if (!inspectorNodeId) {
      return
    }

    selectInspectorNode(createInspectorNode(inspectorNodeId))
  }, [
    analysis,
    error,
    inspectorNodeId,
    plan,
    positions,
    render,
    selectedBarIndex,
    selectInspectorNode,
    status,
    track,
  ])

  const handleNodesChange = (changes: NodeChange[]) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
  }

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    selectInspectorNode(createInspectorNode(node.id as CanvasNodeId))
  }

  const handleNodeDragStop: OnNodeDrag = (_event, node) => {
    setNodePosition(node.id as CanvasNodeId, node.position)
  }

  return (
    <div className="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        fitView
        minZoom={0.65}
        maxZoom={1.2}
      >
        <Background color="#2a3040" gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
