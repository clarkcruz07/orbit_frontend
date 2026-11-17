import type { ReactNode } from 'react'
import './ui.css'

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={`ui-alert ui-alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`skeleton ${className}`} style={style} aria-hidden="true" />
}
