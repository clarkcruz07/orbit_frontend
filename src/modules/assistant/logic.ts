/**
 * Pure logic for the Bluedge Orbit chat (no DOM, no network) so it can be unit tested with node --test.
 * The server is the only authority: it decides what Orbit may say, which documents may be previewed and whether a leave request is accepted.
 * Nothing here decides access by role name.
 */
import { formatDate } from '@/lib/dates'
import type { AssistFailure, AssistantFile, ChatAction, ChatSource, ChatTurn } from '@/api/assistant'

export const MAX_MESSAGE_CHARS = 2000
export const HISTORY_CAP = 12
/** The mascot "talks" for this long when the chat opens, and for a shorter burst when a reply arrives. */
export const OPEN_TALK_MS = 2500
export const REPLY_TALK_MS = 1800

export const NOT_CONFIGURED_TEXT = "The assistant isn't switched on yet. Ask your administrator."
export const NETWORK_TEXT = "I can't reach the Bluedge People service right now. Check your connection and try again."
export const GENERIC_ERROR_TEXT = 'Something went wrong on our side. Please try again.'
export const NO_PREVIEW_TEXT = 'This file cannot be previewed here. Use Download to open it.'

// ------------------------------------------------------------------------------------------------ thread + history
export interface ThreadItem {
  id: string
  role: 'user' | 'assistant'
  /** 'text' goes to the model as history; 'error' and 'notice' are local only. */
  kind: 'text' | 'error' | 'notice'
  content: string
  sources?: ChatSource[]
  action?: ChatAction | null
  link?: { to: string; label: string } | null
  /** A file Orbit made (for example the COE PDF): the bubble keeps Download and Preview for the session. */
  file?: AssistantFile | null
  /** Error bubbles only: whether a Retry button makes sense. */
  retryable?: boolean
}

/** Trim and cap one message to the longest the server accepts. */
export function capText(text: string): string {
  return text.trim().slice(0, MAX_MESSAGE_CHARS)
}

export function canSend(text: string, loading: boolean): boolean {
  return !loading && text.trim().length > 0
}

/** What goes to the server: only real conversation turns (never errors or local notices), the last 12, each within the limit. */
export function toHistory(items: readonly ThreadItem[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const it of items) {
    if (it.kind !== 'text') continue
    const content = capText(it.content)
    if (content) turns.push({ role: it.role, content })
  }
  let out = turns.slice(-HISTORY_CAP)
  while (out.length > 0 && out[0].role !== 'user') out = out.slice(1) // a conversation always starts with the person's own message
  return out
}

// ------------------------------------------------------------------------------------------------ mascot
export interface SpriteState {
  /** 0 = closed mouth (chat off), 1 = open mouth (chat on). */
  frame: 0 | 1
  /** True only while the talk animation should flap between the two frames. */
  animate: boolean
}

/** Closed chat: frame 0, never animated. Open chat: frame 1, flapping only while talking and only if motion is allowed. */
export function spriteState(i: { open: boolean; talking: boolean; reducedMotion: boolean }): SpriteState {
  if (!i.open) return { frame: 0, animate: false }
  return { frame: 1, animate: i.talking && !i.reducedMotion }
}

// ------------------------------------------------------------------------------------------------ errors
export function chatErrorText(f: AssistFailure): string {
  if (f.status === null) return NETWORK_TEXT
  if (f.status === 503 && f.code === 'llm_not_configured') return NOT_CONFIGURED_TEXT
  if (f.status === 429) return f.retryAfter ? `Orbit is busy right now. Please wait ${f.retryAfter} seconds and try again.` : 'Orbit is busy right now. Please wait a moment and try again.'
  if (f.status === 401) return 'Your session has ended. Please sign in again.'
  if (f.detail && f.detail.length <= 300) return f.detail
  return GENERIC_ERROR_TEXT
}

/** Submitting a card: network trouble and rate limits use the chat wording, server errors a plain sentence, refusals the service's own reason. */
export function confirmErrorText(f: AssistFailure): string {
  if (f.status === null || f.status === 429 || f.status === 401) return chatErrorText(f)
  if (f.status >= 500) return GENERIC_ERROR_TEXT
  return f.detail && f.detail.length <= 300 ? f.detail : 'This request could not be submitted.'
}

/** A retry makes sense for network trouble, rate limits and server-side AI problems; not for a missing switch-on. */
export function isRetryable(f: AssistFailure): boolean {
  if (f.status === 503 && f.code === 'llm_not_configured') return false
  return f.status === null || f.status === 429 || f.status >= 500
}

// ------------------------------------------------------------------------------------------------ sources + preview
export function sourceLabel(s: Pick<ChatSource, 'title' | 'version'>): string {
  return s.version ? `${s.title} v${s.version}` : s.title
}

/**
 * The file route for a source: a policy (a given version, or the current one) or a Knowledge Base item that has a file.
 * A Knowledge Base item written as text has no file (its snippet is shown instead).
 */
export function sourceFilePath(s: Pick<ChatSource, 'kind' | 'id' | 'version' | 'has_file'>): string | null {
  const id = encodeURIComponent(s.id)
  if (s.kind === 'policy') return s.version ? `/documents/policies/${id}/versions/${s.version}/file` : `/documents/policies/${id}/file`
  return s.has_file ? `/assistant/kb/items/${id}/file` : null
}

export type PreviewKind = 'pdf' | 'text' | 'image' | 'none'

export function previewKind(mime: string | null | undefined): PreviewKind {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim()
  if (m === 'application/pdf') return 'pdf'
  if (m === 'text/plain' || m === 'text/markdown') return 'text'
  if (m === 'image/png' || m === 'image/jpeg' || m === 'image/gif' || m === 'image/webp') return 'image'
  return 'none'
}

/** A safe download name from the Content-Disposition header, else the source title. */
export function downloadName(disposition: string | null | undefined, title: string, mime: string | null | undefined): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '')
  let name = ''
  if (m) {
    try {
      name = decodeURIComponent(m[1])
    } catch {
      name = m[1]
    }
  }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  if (name) return name.slice(0, 120)
  const ext = previewKind(mime) === 'pdf' ? '.pdf' : previewKind(mime) === 'text' ? '.txt' : ''
  return `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || 'document'}${ext}`
}

// ------------------------------------------------------------------------------------------------ generated files
export const FILE_GONE_TEXT = 'This file is no longer available. Ask Orbit to generate it again.'
export const FILE_FAILED_TEXT = 'The file could not be downloaded. Please try again.'

/** A safe name to save under: no path or control characters, never empty, always with an extension (PDF when none was given). */
export function safeFileName(name: string | null | undefined, fallback = 'document.pdf'): string {
  const cleaned = (name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+/, '')
    .trim()
    .slice(0, 120)
  if (!cleaned) return fallback
  return /\.[A-Za-z0-9]{1,5}$/.test(cleaned) ? cleaned : `${cleaned}.pdf`
}

export function fileErrorText(f: AssistFailure): string {
  if (f.status === 404 || f.status === 410) return FILE_GONE_TEXT
  if (f.status === null) return NETWORK_TEXT
  if (f.status === 401) return 'Your session has ended. Please sign in again.'
  if (f.status === 403) return 'You cannot open this file.'
  return FILE_FAILED_TEXT
}

/** Trying again helps for network trouble, rate limits and server errors; not when the file is gone or not allowed. */
export function isFileRetryable(f: AssistFailure): boolean {
  return f.status === null || f.status === 429 || f.status >= 500
}

export function fileSizeText(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ------------------------------------------------------------------------------------------------ action cards
export type ActionPhase = 'pending' | 'confirming' | 'cancelling' | 'done' | 'cancelled' | 'failed'

export interface ActionState {
  phase: ActionPhase
  /** Success text, or the reason the server gave. */
  message: string | null
  requestId: string | null
  /** A retryable problem shown above the buttons while the card is still usable. */
  warning: string | null
}

export const INITIAL_ACTION: ActionState = { phase: 'pending', message: null, requestId: null, warning: null }

export type ActionEvent =
  | { type: 'confirm' }
  | { type: 'confirmed'; message: string; requestId: string | null }
  | { type: 'confirmFailed'; message: string; retryable: boolean }
  | { type: 'cancel' }
  | { type: 'cancelled' }
  | { type: 'cancelFailed'; message: string }

/**
 * One card, one decision. Once submitted, cancelled or refused for good, the card is read-only. A transient problem (no network, server
 * error, rate limit) puts the card back so the person can press the button again; a refusal (balance, dates, expired) does not.
 */
export function actionReducer(s: ActionState, e: ActionEvent): ActionState {
  switch (e.type) {
    case 'confirm':
      return s.phase === 'pending' ? { ...s, phase: 'confirming', warning: null } : s
    case 'confirmed':
      return s.phase === 'confirming' ? { phase: 'done', message: e.message, requestId: e.requestId, warning: null } : s
    case 'confirmFailed':
      if (s.phase !== 'confirming') return s
      return e.retryable ? { ...s, phase: 'pending', warning: e.message } : { phase: 'failed', message: e.message, requestId: null, warning: null }
    case 'cancel':
      return s.phase === 'pending' ? { ...s, phase: 'cancelling', warning: null } : s
    case 'cancelled':
      return s.phase === 'cancelling' ? { phase: 'cancelled', message: null, requestId: null, warning: null } : s
    case 'cancelFailed':
      return s.phase === 'cancelling' ? { ...s, phase: 'pending', warning: e.message } : s
    default:
      return s
  }
}

export function actionStatusText(s: ActionState): string | null {
  if (s.phase === 'done') return s.message || 'Submitted.'
  if (s.phase === 'cancelled') return 'Cancelled. Nothing was submitted.'
  if (s.phase === 'failed') return s.message || 'This request could not be submitted.'
  return null
}

export function isActionOpen(s: ActionState): boolean {
  return s.phase === 'pending'
}

export function daysText(days: number | null): string {
  if (days === null) return '-'
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

export function balanceText(after: number | null): string {
  if (after === null) return '-'
  return `${after} ${after === 1 || after === -1 ? 'day' : 'days'} left`
}

export function dateRangeText(start: string, end: string): string {
  if (!start) return '-'
  return !end || end === start ? formatDate(start) : `${formatDate(start)} to ${formatDate(end)}`
}

// The restricted Markdown subset renderer lives in richtext.ts (shared with the Knowledge Base editor preview).
export { inlines, richBlocks } from './richtext'
export type { Block, Inline } from './richtext'

// ------------------------------------------------------------------------------------------------ Knowledge Base
export const KB_TITLE_MAX = 160
export const KB_BODY_MAX = 20000
export const KB_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const KB_UPLOAD_EXTENSIONS = ['pdf', 'docx', 'txt', 'md'] as const
export const KB_ACCEPT = KB_UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(',')

export interface KbTextForm {
  title: string
  body: string
}
export type KbTextErrors = Partial<Record<keyof KbTextForm, string>>

export function validateKbText(f: KbTextForm): KbTextErrors {
  const errors: KbTextErrors = {}
  const title = f.title.trim()
  const body = f.body.trim()
  if (!title) errors.title = 'Enter a title.'
  else if (title.length > KB_TITLE_MAX) errors.title = `Use at most ${KB_TITLE_MAX} characters.`
  if (!body) errors.body = 'Write the text Orbit should know.'
  else if (body.length > KB_BODY_MAX) errors.body = `Use at most ${KB_BODY_MAX.toLocaleString('en-US')} characters.`
  return errors
}

export function fileExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

/** Friendly checks BEFORE anything is uploaded: type by extension, size, and not empty. Null means fine. */
export function validateUpload(f: { name: string; size: number }): string | null {
  const ext = fileExtension(f.name)
  if (ext === 'doc') return 'Old Word files (.doc) are not supported. Save it as .docx and try again.'
  if (!(KB_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) return 'That file type is not supported. Use PDF, Word (.docx), .txt or .md.'
  if (f.size <= 0) return 'That file is empty.'
  if (f.size > KB_UPLOAD_MAX_BYTES) return `That file is ${(f.size / (1024 * 1024)).toFixed(1)} MB. The limit is 10 MB.`
  return null
}

/** A title offered for an uploaded file: its name without the extension. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, KB_TITLE_MAX)
}

export type PillTone = 'green' | 'amber' | 'blue' | 'violet' | 'neutral'
export interface KbItemLike {
  kind: 'text' | 'file'
  filename: string | null
  content_type: string | null
  status: 'indexed' | 'unreadable'
  reason: string | null
}

/** "PDF", "Word" or "Text" (from the content type, then the file name). */
export function kindPill(i: Pick<KbItemLike, 'kind' | 'filename' | 'content_type'>): { label: string; tone: PillTone } {
  if (i.kind === 'text') return { label: 'Text', tone: 'violet' }
  const type = (i.content_type ?? '').toLowerCase().split(';')[0].trim()
  const ext = fileExtension(i.filename ?? '')
  if (type === 'application/pdf' || ext === 'pdf') return { label: 'PDF', tone: 'blue' }
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return { label: 'Word', tone: 'blue' }
  if (type === 'text/plain' || type === 'text/markdown' || ext === 'txt' || ext === 'md') return { label: 'Text', tone: 'violet' }
  return { label: 'File', tone: 'neutral' }
}

export function statusPill(i: Pick<KbItemLike, 'status' | 'reason'>): { label: string; tone: PillTone; title: string } {
  if (i.status === 'indexed') return { label: 'Indexed', tone: 'green', title: 'Orbit can answer from this.' }
  return { label: "Can't be read", tone: 'amber', title: i.reason || 'Orbit could not read any text in this file.' }
}

export function kbFailureText(f: AssistFailure, what: string): string {
  if (f.status === null) return `${what} Can't reach the Bluedge People service. Check your connection and try again.`
  if (f.status === 401) return 'Your session has ended. Please sign in again.'
  if (f.status === 403) return `${what} Only HR administrators can manage the Knowledge Base.`
  if (f.status === 404) return f.detail ?? `${what} It could not be found. Reload the list and try again.`
  if (f.status === 413) return 'That file is larger than 10 MB. Use a smaller file.'
  if (f.status === 429) return `${what} Too many requests. Wait a moment and try again.`
  if (f.status >= 500) return `${what} Something went wrong on our side. Please try again.`
  return f.detail && f.detail.length <= 300 ? f.detail : `${what} Please check the details and try again.`
}

export function excerpt(body: string, max = 160): string {
  const flat = body.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 3).trimEnd()}...`
}
