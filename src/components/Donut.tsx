import { useId, type ReactNode } from 'react'

interface DonutProps {
  /** 0..100 */
  pct: number
  size: number
  stroke: number
  /** Gradient stops for the progress arc (top-right to bottom-left). */
  from?: string
  to?: string
  /** Track (unfilled) colours. */
  trackFrom?: string
  trackTo?: string
  label: string
  children?: ReactNode
}

/** SVG gradient ring with a centred label slot. */
export function Donut({ pct, size, stroke, from = '#1d9bf0', to = '#8b5cf6', trackFrom = '#e4dcff', trackTo = '#cbb9fb', label, children }: DonutProps) {
  const uid = useId().replace(/:/g, '')
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const dash = (clamped / 100) * c
  return (
    <div className="donut" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`p-${uid}`} x1="0.85" y1="0.1" x2="0.15" y2="0.95">
            <stop offset="0" stopColor={from} />
            <stop offset="0.55" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
          <linearGradient id={`t-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={trackFrom} />
            <stop offset="1" stopColor={trackTo} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#t-${uid})`} strokeWidth={stroke} />
        {clamped > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#p-${uid})`}
            strokeWidth={stroke}
            strokeLinecap={clamped >= 100 ? 'butt' : 'round'}
            strokeDasharray={`${dash} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </svg>
      <div className="donut-center">{children}</div>
    </div>
  )
}
