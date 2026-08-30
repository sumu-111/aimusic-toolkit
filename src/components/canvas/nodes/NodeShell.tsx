import { Handle, Position } from '@xyflow/react'
import type { ReactNode } from 'react'

type NodeTone = 'todo' | 'busy' | 'done' | 'failed'

type NodeShellProps = {
  title: string
  tone: NodeTone
  children: ReactNode
  target?: boolean
  source?: boolean
}

export function NodeShell({
  title,
  tone,
  children,
  target = true,
  source = true,
}: NodeShellProps) {
  return (
    <section className={`flow-node ${tone}`}>
      {target && (
        <Handle
          className="flow-handle"
          type="target"
          position={Position.Top}
          isConnectable={false}
        />
      )}
      <header>
        <span>{title}</span>
      </header>
      <div className="flow-node-body">{children}</div>
      {source && (
        <Handle
          className="flow-handle"
          type="source"
          position={Position.Bottom}
          isConnectable={false}
        />
      )}
    </section>
  )
}
