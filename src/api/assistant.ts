/**
 * Assistant ("Bluedge Orbit") API: chat with sources, confirm-before-act actions, and the HR knowledge-base articles.
 * Typed against the contract; unknown fields are ignored and every value is normalised, so a half-built server never breaks the page.
 */
import { api } from './client'

export interface AssistantConfig {
  enabled: boolean
  name: string
  greeting: string
  suggestions: string[]
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSource {
  /** 'policy' (a published policy document) or 'kb' (a Knowledge Base item). The older kind 'article' is read as 'kb' without a file. */
  kind: 'policy' | 'kb'
  id: string
  title: string
  version: number | null
  snippet: string
  /** A Knowledge Base item uploaded as a file: its original can be previewed. Text items show the snippet. */
  has_file: boolean
}

export interface FileLeaveSummary {
  leave_type_id: string
  leave_type_name: string
  start_date: string
  end_date: string
  days: number | null
  balance_after: number | null
  reason: string
}

export interface ChatAction {
  action_id: string
  /** 'file_leave' today; the UI keeps a registry keyed by kind, so unknown kinds are shown generically. */
  kind: string
  summary: Record<string, unknown>
  expires_at: string | null
}

export interface ChatReply {
  reply: string
  sources: ChatSource[]
  action: ChatAction | null
}

/** A file Orbit made for the person (for example the Certificate of Employment PDF). Fetched with the signed-in client, never by a bare link. */
export interface AssistantFile {
  file_id: string
  filename: string
  content_type: string
  size: number | null
}

export interface ConfirmResult {
  ok: boolean
  kind: string
  message: string
  request_id: string | null
  status: string | null
  file: AssistantFile | null
}

export interface CoeSummary {
  name: string
  position: string
  employed_since: string
  reason: string
  issue_date: string
}

export interface KbItem {
  item_id: string
  kind: 'text' | 'file'
  title: string
  /** Text items only: the restricted Markdown subset (paragraphs, **bold**, "- " bullets, "1. " numbering). */
  body: string
  /** File items only. */
  filename: string | null
  content_type: string | null
  size: number | null
  status: 'indexed' | 'unreadable'
  reason: string | null
  active: boolean
  updated_at: string | null
  updated_by_name: string | null
}

export interface KbStatus {
  items_total: number
  items_indexed: number
  items_unreadable: number
  policies_indexed: number
  policies_unreadable: { policy_id: string; title: string; reason: string }[]
  articles: number
}

export interface AssistFailure {
  status: number | null
  code: string | null
  detail: string | null
  retryAfter: number | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const text = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseFailure(err: unknown): AssistFailure {
  const e = err as { response?: { status?: number; data?: unknown; headers?: Record<string, unknown> } } | null
  const status = typeof e?.response?.status === 'number' ? e.response.status : null
  const data = (e?.response?.data ?? {}) as Record<string, unknown>
  const detail = str(data.detail) ?? str(data.message)
  const ra = Number(e?.response?.headers?.['retry-after'])
  return { status, code: str(data.code), detail, retryAfter: Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : null }
}

export function normaliseConfig(raw: unknown): AssistantConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const suggestions = Array.isArray(r.suggestions) ? r.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 6) : []
  return {
    enabled: r.enabled !== false,
    name: str(r.name) ?? 'Bluedge Orbit',
    greeting: str(r.greeting) ?? "Hi, I'm Bluedge Orbit. Ask me about company policies, or ask me to file a leave request for you.",
    suggestions,
  }
}

export function normaliseSource(raw: unknown): ChatSource | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = str(r.id)
  if (!id) return null
  const kb = r.kind === 'kb' || r.kind === 'article'
  return {
    kind: kb ? 'kb' : 'policy',
    id,
    title: str(r.title) ?? 'Untitled',
    version: !kb && typeof r.version === 'number' && Number.isInteger(r.version) && r.version > 0 ? r.version : null,
    snippet: text(r.snippet),
    has_file: r.kind === 'kb' && r.has_file === true,
  }
}

export function normaliseAction(raw: unknown): ChatAction | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = str(r.action_id)
  if (!id) return null
  const summary = r.summary && typeof r.summary === 'object' && !Array.isArray(r.summary) ? (r.summary as Record<string, unknown>) : {}
  return { action_id: id, kind: str(r.kind) ?? 'unknown', summary, expires_at: str(r.expires_at) }
}

export function leaveSummary(a: ChatAction): FileLeaveSummary {
  const s = a.summary
  return {
    leave_type_id: text(s.leave_type_id),
    leave_type_name: str(s.leave_type_name) ?? 'Leave',
    start_date: text(s.start_date),
    end_date: text(s.end_date),
    days: numOrNull(s.days),
    balance_after: numOrNull(s.balance_after),
    reason: text(s.reason),
  }
}

export function coeSummary(a: ChatAction): CoeSummary {
  const s = a.summary
  return { name: text(s.name), position: text(s.position), employed_since: text(s.employed_since), reason: text(s.reason), issue_date: text(s.issue_date) }
}

export function normaliseFile(raw: unknown): AssistantFile | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = str(r.file_id)
  if (!id) return null
  return { file_id: id, filename: str(r.filename) ?? 'document.pdf', content_type: str(r.content_type) ?? 'application/pdf', size: numOrNull(r.size) }
}

export function normaliseReply(raw: unknown): ChatReply {
  const r = (raw ?? {}) as Record<string, unknown>
  const sources = Array.isArray(r.sources) ? r.sources.map(normaliseSource).filter((s): s is ChatSource => s !== null) : []
  return { reply: text(r.reply), sources, action: r.action ? normaliseAction(r.action) : null }
}

export function normaliseItem(raw: unknown): KbItem | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = str(r.item_id)
  if (!id) return null
  const kind = r.kind === 'file' ? 'file' : 'text'
  return {
    item_id: id,
    kind,
    title: text(r.title),
    body: kind === 'text' ? text(r.body) : '',
    filename: kind === 'file' ? str(r.filename) : null,
    content_type: kind === 'file' ? str(r.content_type) : null,
    size: kind === 'file' ? numOrNull(r.size) : null,
    status: r.status === 'unreadable' ? 'unreadable' : 'indexed',
    reason: str(r.reason),
    active: r.active !== false,
    updated_at: str(r.updated_at),
    updated_by_name: str(r.updated_by_name),
  }
}

export function normaliseStatus(raw: unknown): KbStatus {
  const r = (raw ?? {}) as Record<string, unknown>
  const un = Array.isArray(r.policies_unreadable) ? r.policies_unreadable : []
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    items_total: n(r.items_total),
    items_indexed: n(r.items_indexed),
    items_unreadable: n(r.items_unreadable),
    policies_indexed: n(r.policies_indexed),
    policies_unreadable: un
      .map((u) => {
        const x = (u ?? {}) as Record<string, unknown>
        return { policy_id: text(x.policy_id), title: str(x.title) ?? 'Untitled policy', reason: str(x.reason) ?? 'The text could not be read.' }
      })
      .filter((u) => u.policy_id),
    articles: n(r.articles),
  }
}

export const assistantApi = {
  config: () => api.get<unknown>('/assistant/config').then((r) => normaliseConfig(r.data)),
  chat: (messages: ChatTurn[], signal?: AbortSignal) =>
    api.post<unknown>('/assistant/chat', { messages }, { signal, timeout: 60000 }).then((r) => normaliseReply(r.data)),
  confirm: (actionId: string) =>
    api.post<unknown>(`/assistant/actions/${encodeURIComponent(actionId)}/confirm`).then((r): ConfirmResult => {
      const d = (r.data ?? {}) as Record<string, unknown>
      return { ok: d.ok !== false, kind: text(d.kind), message: text(d.message), request_id: str(d.request_id), status: str(d.status), file: d.file ? normaliseFile(d.file) : null }
    }),
  cancel: (actionId: string) => api.post<unknown>(`/assistant/actions/${encodeURIComponent(actionId)}/cancel`).then(() => undefined),
  /** The policy file (a given version, or the current one) as a blob, through the same authenticated client. */
  file: (path: string) => api.get<Blob>(path, { responseType: 'blob', timeout: 30000 }),
  /** A file Orbit generated (needs the bearer token, so it is always fetched as a blob through the client). */
  generatedFile: (fileId: string) => api.get<Blob>(`/assistant/files/${encodeURIComponent(fileId)}`, { responseType: 'blob', timeout: 30000 }),
  kb: {
    items: () =>
      api.get<unknown>('/assistant/kb/items').then((r) => {
        const items = Array.isArray((r.data as { items?: unknown })?.items) ? (r.data as { items: unknown[] }).items : []
        return items.map(normaliseItem).filter((i): i is KbItem => i !== null)
      }),
    createText: (body: { title: string; body: string }) => api.post<unknown>('/assistant/kb/items', body).then((r) => normaliseItem(r.data)),
    /** Multipart upload (the field is `file`, plus an optional `title`). `onProgress` gets 0..100 while the bytes go up. */
    upload: (file: File, title: string, onProgress?: (pct: number) => void) => {
      const form = new FormData()
      form.append('file', file)
      if (title.trim()) form.append('title', title.trim())
      return api
        .post<unknown>('/assistant/kb/items/upload', form, {
          timeout: 120000,
          onUploadProgress: (e) => {
            if (onProgress && e.total) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)))
          },
        })
        .then((r) => normaliseItem(r.data))
    },
    update: (id: string, body: { title?: string; body?: string; active?: boolean }) =>
      api.patch<unknown>(`/assistant/kb/items/${encodeURIComponent(id)}`, body).then((r) => normaliseItem(r.data)),
    remove: (id: string) => api.delete(`/assistant/kb/items/${encodeURIComponent(id)}`).then(() => undefined),
    status: () => api.get<unknown>('/assistant/kb/status').then((r) => normaliseStatus(r.data)),
  },
}
