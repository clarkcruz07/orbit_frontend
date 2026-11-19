import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { formatInt, trendAxis } from '@/lib/dashboardFormat'

interface Point {
  month: string
  value: number
}

interface DotProps {
  cx?: number
  cy?: number
  index?: number
  value?: number
  payload?: { value?: number }
}

export function HeadcountChart({ data }: { data: Point[] }) {
  const axis = trendAxis(data.map((d) => d.value))
  const last = data.length - 1

  const renderDot = (props: DotProps) => {
    const { cx, cy, index, payload } = props
    const value = payload?.value
    if (cx === undefined || cy === undefined || index === undefined) return <g key={`d-${index}`} />
    if (index === last) {
      const label = formatInt(value)
      const w = 8 + label.length * 8.6
      return (
        <g key={`d-${index}`}>
          <rect x={cx - w + 14} y={cy - 36} width={w} height={22} rx={6} fill="#6a45e0" />
          <path d={`M${cx - 4} ${cy - 15} L${cx + 4} ${cy - 15} L${cx} ${cy - 9} Z`} fill="#6a45e0" />
          <text x={cx - w / 2 + 14} y={cy - 20.5} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="700">
            {label}
          </text>
          <circle cx={cx} cy={cy} r={6} fill="#6a45e0" stroke="#fff" strokeWidth={2} />
        </g>
      )
    }
    return <circle key={`d-${index}`} cx={cx} cy={cy} r={4.5} fill="#fff" stroke="#1d6fe0" strokeWidth={2} />
  }

  return (
    <div className="trend-chart" role="img" aria-label={`Headcount from ${formatInt(data[0]?.value)} to ${formatInt(data[last]?.value)} over ${data.length} periods`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 28, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6d5ae6" stopOpacity="0.28" />
              <stop offset="1" stopColor="#6d5ae6" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e4e9f5" />
          <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#d6ddf0' }} padding={{ left: 22, right: 22 }} tick={{ fill: '#1c2f5e', fontSize: 13 }} interval={0} />
          <YAxis
            domain={[axis.min, axis.max]}
            ticks={axis.ticks}
            tickLine={false}
            axisLine={false}
            width={50}
            tick={{ fill: '#1c2f5e', fontSize: 13 }}
            tickFormatter={(v: number) => formatInt(v)}
          />
          <Area
            type="linear"
            dataKey="value"
            stroke="#1d6fe0"
            strokeWidth={2.5}
            fill="url(#trend-fill)"
            dot={renderDot}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
