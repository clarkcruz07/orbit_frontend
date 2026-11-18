/**
 * Microsoft directory sync (HR only): the status shape, tolerant readers, and the plain-language wording the People page shows.
 * Pure functions with no DOM and no network, so the rules (which message for which error, when to keep polling, what the
 * last-sync line says) are testable. The server is the authority: nothing here decides who may sync or what a run does.
 */
import { formatDate, isoDate } from '@/lib/dates'

export type SyncState = 'idle' | 'running'

export interface SyncCounts {
  fetched: number
  created: number
  updated: number
  deactivated: number
  reactivated: number
  skipped: number
}

export interface SyncLast {
  started_at: string | null
  finished_at: string | null
  ok: boolean
  error_code: string | null
  counts: SyncCounts
}

export interface SyncStatus {
  configured: boolean
  enabled: boolean
  state: SyncState
  interval_hours: number | null
  last: SyncLast | null
  next_run_at: string | null
  setup_hint: string | null
}

export type SyncView = 'not_configured' | 'running' | 'failed' | 'synced' | 'never'

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export function normaliseCounts(raw: unknown): SyncCounts {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    fetched: num(r.fetched),
    created: num(r.created),
    updated: num(r.updated),
    deactivated: num(r.deactivated),
    reactivated: num(r.reactivated),
    skipped: num(r.skipped),
  }
}

export function normaliseLast(raw: unknown): SyncLast | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    started_at: text(r.started_at),
    finished_at: text(r.finished_at),
    ok: r.ok === true,
    error_code: text(r.error_code),
    counts: normaliseCounts(r.counts),
  }
}

/** Anything missing or odd reads as "idle, not configured, never ran": the safe, quiet default. */
export function normaliseSyncStatus(raw: unknown): SyncStatus {
  const r = (raw ?? {}) as Record<string, unknown>
  const hours = typeof r.interval_hours === 'number' && Number.isFinite(r.interval_hours) && r.interval_hours > 0 ? r.interval_hours : null
  return {
    configured: r.configured === true,
    enabled: r.enabled === true,
    state: r.state === 'running' ? 'running' : 'idle',
    interval_hours: hours,
    last: normaliseLast(r.last),
    next_run_at: text(r.next_run_at),
    setup_hint: text(r.setup_hint),
  }
}

// ------------------------------------------------------------------------------------------------ wording
export const SYNC_ERROR_TEXT: Record<string, string> = {
  not_configured: 'Microsoft directory sync is not connected yet.',
  graph_auth_failed: 'Microsoft rejected the sync credentials.',
  graph_forbidden: 'The app is not allowed to read the user list yet. An administrator must grant User.Read.All.',
  graph_unavailable: 'Microsoft could not be reached. It will retry automatically.',
  graph_invalid: 'Microsoft sent an answer the app could not read.',
  partial_directory: 'Microsoft returned far fewer people than before, so nobody was marked as left. Check the sync settings.',
}
export const SYNC_ERROR_FALLBACK = 'The last sync did not finish. Try again in a moment.'

export function syncErrorMessage(code: string | null | undefined): string {
  return (code && SYNC_ERROR_TEXT[code]) || SYNC_ERROR_FALLBACK
}

export const NOT_CONNECTED_ASK = 'Ask your administrator to connect Microsoft directory sync.'
export const SYNC_TITLE = 'Microsoft directory'
export const MICROSOFT_PILL_TITLE = 'Synced from Microsoft Entra'
export const LEFT_DIRECTORY_HINT = 'Left Microsoft directory'

export function syncView(s: SyncStatus): SyncView {
  if (!s.configured) return 'not_configured'
  if (s.state === 'running') return 'running'
  if (s.last && !s.last.ok) return 'failed'
  if (s.last) return 'synced'
  return 'never'
}

/** A run can be started when the server says it is connected and nothing is running. */
export function canSync(s: SyncStatus, busy: boolean): boolean {
  return s.configured && s.state !== 'running' && !busy
}

/** "5 minutes ago", "in 3 hours", "yesterday", or a date. `now` is injectable so tests are deterministic. */
export function whenText(iso: string | null | undefined, now: Date): string {
  const then = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(then)) return ''
  const diffSec = Math.round((then - now.getTime()) / 1000)
  const future = diffSec > 0
  const sec = Math.abs(diffSec)
  // Rounded, not cut off: 2 h 59 min away reads "in 3 hours", like a person would say it.
  const min = Math.round(sec / 60)
  const hours = Math.round(min / 60)
  const days = Math.round(hours / 24)
  const ago = (n: string) => (future ? `in ${n}` : `${n} ago`)
  if (sec < 45) return future ? 'in a moment' : 'just now'
  if (min < 60) return ago(min <= 1 ? '1 minute' : `${min} minutes`)
  if (hours < 24) return ago(hours === 1 ? '1 hour' : `${hours} hours`)
  if (days < 7) return days === 1 ? (future ? 'tomorrow' : 'yesterday') : ago(`${days} days`)
  const d = new Date(then)
  return formatDate(isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate()))
}

export function lastSyncSummary(last: SyncLast | null, now: Date): string {
  if (!last) return 'Not synced yet. Press Sync now to bring in everyone from Microsoft.'
  const when = whenText(last.finished_at ?? last.started_at, now)
  const c = last.counts
  return `Last synced ${when || 'recently'}: ${c.created} added, ${c.updated} updated, ${c.deactivated} left.`
}

export function lastAttemptText(last: SyncLast | null, now: Date): string {
  const when = whenText(last?.finished_at ?? last?.started_at, now)
  return when ? `Last attempt ${when}.` : ''
}

export function nextSyncText(s: SyncStatus, now: Date): string {
  if (!s.configured || !s.enabled || !s.next_run_at) return ''
  const when = whenText(s.next_run_at, now)
  return when ? `Next sync ${when}.` : ''
}

// ------------------------------------------------------------------------------------------------ polling
export const POLL_MS = 3000
/** After this long without the run finishing the card stops asking and offers a manual "Check again". */
export const POLL_LIMIT_MS = 120000

export function shouldPoll(state: SyncState, elapsedMs: number): boolean {
  return state === 'running' && elapsedMs < POLL_LIMIT_MS
}

// ------------------------------------------------------------------------------------------------ people who came from Entra
export function isEntraSource(source: string | null | undefined): boolean {
  return source === 'entra'
}

/** The hint under the "Left" status of a person the sync marked as gone. */
export function leftDirectoryHint(e: { status?: string | null; left_reason?: string | null }): string | null {
  return e.status === 'left' && e.left_reason === 'entra_sync' ? LEFT_DIRECTORY_HINT : null
}
