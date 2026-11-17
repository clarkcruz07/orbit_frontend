import type { ReactNode } from 'react'
import './ui.css'

interface EmptyStateProps {
  title: string
  body: string
  icon?: ReactNode
  /** Only pass an action that does something. Placeholders pass none. */
  action?: ReactNode
  badge?: string
  /** No dashed frame: for use inside a card. */
  plain?: boolean
}

/** The single shared "nothing here (yet)" panel. Never renders a button unless an action is passed. */
export function EmptyState({ title, body, icon, action, badge, plain }: EmptyStateProps) {
  return (
    <div className={`empty-state${plain ? ' empty-state-plain' : ''}`} data-testid="empty-state">
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      {badge ? <span className="empty-state-badge">{badge}</span> : null}
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-body">{body}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}
