/** Pure formatting/mapping helpers for the HR Administration dashboard (contract: SPEC section 7). */

export function formatInt(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-'
  return Math.round(n).toLocaleString('en-US')
}

function trimNumber(n: number, digits = 1): string {
  return String(Number(n.toFixed(digits)))
}

export type DeltaDirection = 'up' | 'down' | 'flat'

export interface Delta {
  text: string
  direction: DeltaDirection
}

/** "+3.2%" with up arrow, "-18%" with down arrow. */
export function formatDelta(value: number | null | undefined, unit: '%' | 'pp'): Delta {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { text: '-', direction: 'flat' }
  const direction: DeltaDirection = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = trimNumber(Math.abs(value))
  return { text: unit === '%' ? `${sign}${abs}%` : `${sign}${abs} pp`, direction }
}

/** "last_month" / "month" / "vs. last month" -> "vs. last month". */
export function periodLabel(period: string | null | undefined): string {
  const raw = (period ?? '').toString().replace(/[_-]+/g, ' ').trim()
  if (!raw) return 'vs. last month'
  if (/^vs\.?\s/i.test(raw)) return raw.replace(/^vs\.?\s/i, 'vs. ')
  if (/^(last|previous|prior)\b/i.test(raw)) return `vs. ${raw.toLowerCase()}`
  if (/^(month|week|quarter|year)$/i.test(raw)) return `vs. last ${raw.toLowerCase()}`
  return `vs. ${raw}`
}

/** "in_progress" -> "In Progress". */
export function statusLabel(status: string | null | undefined): string {
  const raw = (status ?? '').toString().replace(/[_-]+/g, ' ').trim()
  if (!raw) return ''
  return raw.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function expiringLabel(windowDays: number | null | undefined): string {
  return typeof windowDays === 'number' ? `Next ${windowDays} Days` : 'Upcoming'
}

export function clampPct(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthIndex(month: unknown): number | null {
  if (typeof month === 'number' && month >= 1 && month <= 12) return month - 1
  if (typeof month === 'string') {
    const trimmed = month.trim()
    if (/^\d{1,2}$/.test(trimmed)) {
      const n = Number(trimmed)
      return n >= 1 && n <= 12 ? n - 1 : null
    }
    const idx = MONTHS_SHORT.findIndex((m) => trimmed.toLowerCase().startsWith(m.toLowerCase()))
    return idx >= 0 ? idx : null
  }
  return null
}

export interface HolidayBlock {
  month: string // "FEB"
  day: string // "10"
  name: string
  type: string
}

export function holidayBlock(h: { month: string | number; day: number; name: string; type?: string }): HolidayBlock {
  const idx = monthIndex(h.month)
  const type = (h.type ?? '').toString()
  return {
    month: idx === null ? String(h.month).slice(0, 3).toUpperCase() : MONTHS_SHORT[idx].toUpperCase(),
    day: String(h.day),
    name: h.name,
    type: type ? (/\s/.test(type) ? type : statusLabel(type)) : 'Holiday',
  }
}

/** Birthday date as a chip ("Jan 25"). Accepts "Jan 25", "01-25", "--01-25" or "2026-01-25". */
export function birthdayChip(date: string | null | undefined): string {
  const raw = (date ?? '').toString().trim()
  const iso = raw.match(/^(?:\d{4}-|--)?(\d{2})-(\d{2})$/)
  if (iso) {
    const idx = Number(iso[1]) - 1
    if (idx >= 0 && idx < 12) return `${MONTHS_SHORT[idx]} ${Number(iso[2])}`
  }
  return raw || '-'
}

/**
 * Headcount chart: nice y-axis bounds. Large head counts (>= 300, the demo data) floor/ceil to 50 with headroom for the end
 * bubble, exactly as before. Small head counts (a live company of 14 people) start at 0 and use a step that keeps about four
 * intervals, so the axis never shows 50-person steps for a team of 19.
 */
export function trendAxis(values: number[]): { min: number; max: number; ticks: number[] } {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { min: 0, max: 100, ticks: [0, 50, 100] }
  const top = Math.max(...finite)
  if (top < 300) {
    const step = niceStep(top / 4)
    const hi = (Math.ceil(top / step) + 1) * step
    const ticks: number[] = []
    for (let t = 0; t <= hi; t += step) ticks.push(t)
    return { min: 0, max: hi, ticks }
  }
  const lo = Math.floor(Math.min(...finite) / 50) * 50
  const hi = Math.ceil(top / 50) * 50 + 50
  const ticks: number[] = []
  for (let t = lo; t <= hi; t += 50) ticks.push(t)
  return { min: lo, max: hi, ticks }
}

function niceStep(raw: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50]) if (raw <= s) return s
  return 50
}

export interface Row {
  label: string
  value: number
}

export function lifecycleRows(d: { completed: number; in_progress: number; not_started: number }): Row[] {
  return [
    { label: 'Completed', value: d.completed },
    { label: 'In Progress', value: d.in_progress },
    { label: 'Not Started', value: d.not_started },
  ]
}

export function directoryRows(d: { full_time: number; part_time: number; contractor: number; intern: number }) {
  return [
    { key: 'full_time', label: 'Full-time', value: d.full_time },
    { key: 'part_time', label: 'Part-time', value: d.part_time },
    { key: 'contractor', label: 'Contractor', value: d.contractor },
    { key: 'intern', label: 'Intern', value: d.intern },
  ] as const
}

export function resolutionDays(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${trimNumber(n)} days` : '-'
}

/** One decimal at most, no trailing zero: 96 -> "96", 33.3 -> "33.3", null -> "-". */
export function formatPct(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-'
  return Number(n.toFixed(1)).toLocaleString('en-US')
}

/* ------------------------------------------------------------------------------------------------------------------
 * Live-aware dashboard model (docs/api/livedash.md). The demo and live responses have the same shape; in live mode
 * numbers can be null and a block can carry `available:false` + `reason`. The normaliser turns either response into one
 * model where every block says whether it is available, so the page never has to guess.
 * ---------------------------------------------------------------------------------------------------------------- */

export interface BlockState {
  /** false => render the honest "Not tracked yet" / "Temporarily unavailable" card instead of numbers. */
  available: boolean
  reason: string | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function blockState(raw: Record<string, unknown>): BlockState {
  return { available: raw.available !== false, reason: raw.available === false ? str(raw.reason) : null }
}

export interface LifecycleModel extends BlockState {
  total: number | null
  completed: number | null
  in_progress: number | null
  not_started: number | null
  pct: number | null
}

function lifecycle(raw: unknown): LifecycleModel {
  const r = rec(raw)
  return { ...blockState(r), total: num(r.total), completed: num(r.completed), in_progress: num(r.in_progress), not_started: num(r.not_started), pct: num(r.pct) }
}

export interface DashboardModel {
  summary: {
    headcount: BlockState & { value: number | null; delta_pct: number | null; period: string }
    onboarding: BlockState & { value: number | null; status: string | null }
    offboarding: BlockState & { value: number | null; status: string | null }
    expiring_documents: BlockState & { value: number | null; window_days: number | null }
    policy_acknowledgement: BlockState & { pct: number | null; delta_pp: number | null }
  }
  headcount_trend: { month: string; value: number }[]
  onboarding: LifecycleModel
  offboarding: LifecycleModel
  directory: BlockState & { total: number | null; full_time: number | null; part_time: number | null; contractor: number | null; intern: number | null }
  hr_cases: BlockState & { active: number | null; high: number | null; medium: number | null; low: number | null; avg_resolution_days: number | null; delta_pct: number | null }
  birthdays: { name: string; team: string; date: string; avatar_initials: string }[]
  holidays: { month: string | number; day: number; name: string; type: string }[]
  unavailable_blocks: string[]
}

export function normaliseDashboard(raw: unknown): DashboardModel {
  const r = rec(raw)
  const s = rec(r.summary)
  const head = rec(s.headcount)
  const onb = rec(s.onboarding)
  const off = rec(s.offboarding)
  const exp = rec(s.expiring_documents)
  const pol = rec(s.policy_acknowledgement)
  const dir = rec(r.directory)
  const cases = rec(r.hr_cases)
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
  return {
    summary: {
      headcount: { ...blockState(head), value: num(head.value), delta_pct: num(head.delta_pct), period: str(head.period) ?? 'last_month' },
      onboarding: { ...blockState(onb), value: num(onb.value), status: str(onb.status) },
      offboarding: { ...blockState(off), value: num(off.value), status: str(off.status) },
      expiring_documents: { ...blockState(exp), value: num(exp.value), window_days: num(exp.window_days) },
      policy_acknowledgement: { ...blockState(pol), pct: num(pol.pct), delta_pp: num(pol.delta_pp) },
    },
    headcount_trend: list(r.headcount_trend)
      .map((p) => ({ month: String(rec(p).month ?? ''), value: num(rec(p).value) }))
      .filter((p): p is { month: string; value: number } => p.value !== null),
    onboarding: lifecycle(r.onboarding),
    offboarding: lifecycle(r.offboarding),
    directory: { ...blockState(dir), total: num(dir.total), full_time: num(dir.full_time), part_time: num(dir.part_time), contractor: num(dir.contractor), intern: num(dir.intern) },
    hr_cases: { ...blockState(cases), active: num(cases.active), high: num(cases.high), medium: num(cases.medium), low: num(cases.low), avg_resolution_days: num(cases.avg_resolution_days), delta_pct: num(cases.delta_pct) },
    birthdays: list(r.birthdays).map((b) => {
      const x = rec(b)
      return { name: String(x.name ?? ''), team: String(x.team ?? ''), date: String(x.date ?? ''), avatar_initials: String(x.avatar_initials ?? '') }
    }),
    holidays: list(r.holidays).map((h) => {
      const x = rec(h)
      return { month: typeof x.month === 'number' ? x.month : String(x.month ?? ''), day: num(x.day) ?? 0, name: String(x.name ?? ''), type: String(x.type ?? '') }
    }),
    unavailable_blocks: Array.isArray(r.unavailable_blocks) ? r.unavailable_blocks.filter((x): x is string => typeof x === 'string') : [],
  }
}

/** Heading for a block that has no numbers: "Not tracked yet" unless the server says it failed ("Temporarily unavailable"). */
export function unavailableTitle(reason: string | null | undefined): string {
  return /temporar|unavailable/i.test(reason ?? '') ? 'Temporarily unavailable' : 'Not tracked yet'
}

/** The reason to show under that heading (the server's own words; a neutral line if it sent none). */
export function unavailableReason(reason: string | null | undefined): string {
  return (reason ?? '').trim() || 'No data is available for this block yet.'
}

/** Names of blocks the server reported as failed, as readable text ("head count, directory"). */
export function degradedNames(blocks: readonly string[]): string {
  const label: Record<string, string> = {
    headcount: 'head count',
    headcount_trend: 'head count trend',
    directory: 'employee directory',
    hr_cases: 'HR cases',
    expiring_documents: 'expiring documents',
    policy_acknowledgement: 'policy acknowledgement',
    birthdays: 'birthdays',
    holidays: 'holidays',
  }
  return blocks.map((b) => label[b] ?? b.replace(/_/g, ' ')).join(', ')
}
