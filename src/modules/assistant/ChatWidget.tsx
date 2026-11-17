import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Download, Eye, FileText, Send, X } from 'lucide-react'
import { assistantApi, normaliseConfig, parseFailure, type AssistantConfig, type AssistantFile, type ChatAction, type ChatSource } from '@/api/assistant'
import { ActionCard } from './ActionCards'
import { RichText } from './RichTextView'
import { OrbitMascot } from './OrbitMascot'
import { downloadGeneratedFile } from './download'
import { FilePreview, SourcePreview } from './SourcePreview'
import {
  INITIAL_ACTION,
  MAX_MESSAGE_CHARS,
  NOT_CONFIGURED_TEXT,
  OPEN_TALK_MS,
  REPLY_TALK_MS,
  actionReducer,
  canSend,
  capText,
  chatErrorText,
  confirmErrorText,
  fileErrorText,
  fileSizeText,
  isFileRetryable,
  isRetryable,
  sourceLabel,
  toHistory,
  type ActionEvent,
  type ActionState,
  type ThreadItem,
} from './logic'
import './assistant.css'

const NAME = 'Bluedge Orbit'
const FALLBACK: AssistantConfig = normaliseConfig({})

function Sources({ sources, onOpen }: { sources: ChatSource[]; onOpen: (s: ChatSource) => void }) {
  if (sources.length === 0) return null
  return (
    <div className="or-sources" data-testid="sources" aria-label="Sources">
      <span className="or-sources-label">Sources</span>
      {sources.map((s) => (
        <button
          key={`${s.kind}-${s.id}-${s.version ?? 0}`}
          type="button"
          className={`or-chip${s.kind === 'kb' ? ' or-chip-kb' : ''}`}
          onClick={() => onOpen(s)}
          aria-label={`Open ${sourceLabel(s)}${s.kind === 'kb' ? ' (Knowledge Base)' : ''}`}
          data-testid="source-chip"
          data-kind={s.kind}
        >
          {s.kind === 'policy' ? <FileText size={14} aria-hidden="true" /> : <BookOpen size={14} aria-hidden="true" />}
          <span className="or-chip-text">{sourceLabel(s)}</span>
        </button>
      ))}
    </div>
  )
}

/** Download and Preview for a file Orbit made. Both fetch through the signed-in client; they stay on the bubble for the session. */
function FileActions({ file, onPreview }: { file: AssistantFile; onPreview: (f: AssistantFile) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null)
  const [gone, setGone] = useState(false)

  async function download() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await downloadGeneratedFile(file)
    } catch (err) {
      const f = parseFailure(err)
      setError({ text: fileErrorText(f), retry: isFileRetryable(f) })
      if (f.status === 404 || f.status === 410) setGone(true)
    } finally {
      setBusy(false)
    }
  }

  const size = fileSizeText(file.size)
  return (
    <div className="or-file" data-testid="orbit-file" data-file-id={file.file_id}>
      <span className="or-file-name" data-testid="orbit-file-name">
        <FileText size={14} aria-hidden="true" /> <span className="or-file-label">{file.filename}</span>
        {size ? <span className="or-file-size"> ({size})</span> : null}
      </span>
      <div className="or-file-actions">
        <button type="button" className="btn btn-primary" onClick={() => void download()} disabled={busy || gone} data-testid="orbit-file-download">
          <Download size={16} aria-hidden="true" /> {busy ? 'Downloading...' : error?.retry ? 'Try again' : 'Download PDF'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => onPreview(file)} disabled={busy || gone} data-testid="orbit-file-preview">
          <Eye size={16} aria-hidden="true" /> Preview
        </button>
      </div>
      {error ? (
        <p className="or-file-error" role="alert" data-testid="orbit-file-error">
          {error.text}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The floating chat: a launcher with the Bluedge Orbit mascot (mouth closed while the chat is off), and a panel (mouth open and talking
 * while it is on). It answers from the knowledge base with sources, and can prepare actions that only run after the person presses Submit.
 */
export function ChatWidget() {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<AssistantConfig | null>(null)
  const [items, setItems] = useState<ThreadItem[]>([])
  const [actions, setActions] = useState<Record<string, ActionState>>({})
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [burst, setBurst] = useState(false)
  const [preview, setPreview] = useState<ChatSource | null>(null)
  const [filePreview, setFilePreview] = useState<AssistantFile | null>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const abort = useRef<AbortController | null>(null)
  const configRequested = useRef(false)

  const nextId = () => `m${(seq.current += 1)}`

  const talk = useCallback((ms: number) => {
    setBurst(true)
    if (burstTimer.current) clearTimeout(burstTimer.current)
    burstTimer.current = setTimeout(() => setBurst(false), ms)
  }, [])

  useEffect(
    () => () => {
      if (burstTimer.current) clearTimeout(burstTimer.current)
      abort.current?.abort()
    },
    [],
  )

  // Opening: the mascot greets (talks for a moment), the settings load once, and focus goes to the message box.
  useEffect(() => {
    if (!open) return
    talk(OPEN_TALK_MS)
    inputRef.current?.focus()
    if (!configRequested.current) {
      configRequested.current = true
      assistantApi
        .config()
        .then(setConfig)
        .catch(() => setConfig(FALLBACK))
    }
  }, [open, talk])

  // Escape closes the chat (unless a preview is open: that closes first).
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !preview && !filePreview) close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, loading, config])

  function close() {
    setOpen(false)
    launcherRef.current?.focus()
  }

  async function ask(history: ThreadItem[]) {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setLoading(true)
    try {
      const reply = await assistantApi.chat(toHistory(history), ctl.signal)
      if (ctl.signal.aborted) return
      setItems((cur) => [
        ...cur,
        { id: nextId(), role: 'assistant', kind: 'text', content: reply.reply || 'I could not find an answer to that.', sources: reply.sources, action: reply.action },
      ])
      if (reply.action) setActions((a) => ({ ...a, [reply.action!.action_id]: INITIAL_ACTION }))
      talk(REPLY_TALK_MS)
    } catch (err) {
      if (ctl.signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return
      const f = parseFailure(err)
      setItems((cur) => [...cur, { id: nextId(), role: 'assistant', kind: 'error', content: chatErrorText(f), retryable: isRetryable(f) }])
    } finally {
      if (!ctl.signal.aborted) setLoading(false)
    }
  }

  function send(raw: string) {
    if (!canSend(raw, loading)) return
    const next: ThreadItem[] = [...items, { id: nextId(), role: 'user', kind: 'text', content: capText(raw) }]
    setItems(next)
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    void ask(next)
  }

  function retry(errorId: string) {
    if (loading) return
    const next = items.filter((i) => i.id !== errorId)
    setItems(next)
    void ask(next)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(input)
    }
  }

  function dispatchAction(id: string, ev: ActionEvent) {
    setActions((a) => ({ ...a, [id]: actionReducer(a[id] ?? INITIAL_ACTION, ev) }))
  }

  async function confirmAction(action: ChatAction) {
    dispatchAction(action.action_id, { type: 'confirm' })
    try {
      const r = await assistantApi.confirm(action.action_id)
      const message = r.message || 'Done.'
      dispatchAction(action.action_id, { type: 'confirmed', message, requestId: r.request_id })
      setItems((cur) => [
        ...cur,
        {
          id: nextId(),
          role: 'assistant',
          kind: 'notice',
          content: message,
          link: action.kind === 'file_leave' ? { to: '/leave', label: 'View my leave requests' } : null,
          file: r.file,
        },
      ])
      talk(REPLY_TALK_MS)
    } catch (err) {
      const f = parseFailure(err)
      // Network trouble, rate limits and server errors keep the card usable; a refusal (balance, dates, expired) closes it with the reason.
      dispatchAction(action.action_id, {
        type: 'confirmFailed',
        message: confirmErrorText(f),
        retryable: isRetryable(f),
      })
    }
  }

  async function cancelAction(action: ChatAction) {
    dispatchAction(action.action_id, { type: 'cancel' })
    try {
      await assistantApi.cancel(action.action_id)
      dispatchAction(action.action_id, { type: 'cancelled' })
    } catch (err) {
      const f = parseFailure(err)
      if (f.status === 404) dispatchAction(action.action_id, { type: 'cancelled' }) // already expired or used: nothing is left to cancel
      else dispatchAction(action.action_id, { type: 'cancelFailed', message: chatErrorText(f) })
    }
  }

  const cfg = config ?? FALLBACK
  const disabled = config !== null && !config.enabled
  const talking = burst || loading

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={`or-launcher${open ? ' or-launcher-open' : ''}`}
        aria-label={`Chat with ${NAME}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
        data-testid="orbit-launcher"
      >
        <OrbitMascot open={open} talking={talking} size={72} testId="orbit-mascot" />
      </button>

      {open ? (
        <section id={panelId} className="or-panel" role="dialog" aria-label={`Chat with ${NAME}`} data-testid="orbit-panel">
          <header className="or-head">
            <OrbitMascot open talking={talking} size={44} testId="orbit-mascot-header" />
            <div className="or-head-text">
              <strong>{cfg.name || NAME}</strong>
              <span>Policies, answers and leave requests</span>
            </div>
            <button type="button" className="or-close" onClick={close} aria-label="Close chat" data-testid="orbit-close">
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <div className="or-list-wrap">
            <div ref={listRef} className="or-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation" data-testid="orbit-messages">
              <div className="or-msg or-msg-bot" data-testid="orbit-greeting">
                <div className="or-bubble">
                  <RichText text={cfg.greeting} />
                </div>
              </div>
              {disabled ? (
                <div className="or-msg or-msg-bot">
                  <div className="or-bubble or-bubble-error" data-testid="orbit-disabled">
                    {NOT_CONFIGURED_TEXT}
                  </div>
                </div>
              ) : null}
              {items.length === 0 && !disabled && cfg.suggestions.length > 0 ? (
                <div className="or-suggestions" data-testid="orbit-suggestions">
                  {cfg.suggestions.map((s) => (
                    <button key={s} type="button" className="or-suggest" onClick={() => send(s)} disabled={loading} data-testid="orbit-suggestion">
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {items.map((it) => (
                <div key={it.id} className={`or-msg ${it.role === 'user' ? 'or-msg-user' : 'or-msg-bot'}`} data-testid="orbit-message" data-role={it.role} data-kind={it.kind}>
                  <div className={`or-bubble${it.kind === 'error' ? ' or-bubble-error' : ''}${it.kind === 'notice' ? ' or-bubble-ok' : ''}`}>
                    {it.role === 'user' ? <span className="or-user-text">{it.content}</span> : <RichText text={it.content} />}
                    {it.link ? (
                      <p className="or-p">
                        <Link to={it.link.to} className="or-link" data-testid="orbit-link">
                          {it.link.label}
                        </Link>
                      </p>
                    ) : null}
                    {it.file ? <FileActions file={it.file} onPreview={setFilePreview} /> : null}
                    {it.kind === 'error' && it.retryable ? (
                      <p className="or-p">
                        <button type="button" className="btn btn-secondary or-retry" onClick={() => retry(it.id)} disabled={loading} data-testid="orbit-retry">
                          Try again
                        </button>
                      </p>
                    ) : null}
                  </div>
                  {it.sources && it.sources.length > 0 ? <Sources sources={it.sources} onOpen={setPreview} /> : null}
                  {it.action ? (
                    <ActionCard
                      action={it.action}
                      state={actions[it.action.action_id] ?? INITIAL_ACTION}
                      onConfirm={() => void confirmAction(it.action!)}
                      onCancel={() => void cancelAction(it.action!)}
                    />
                  ) : null}
                </div>
              ))}
              {loading ? (
                <div className="or-msg or-msg-bot">
                  <div className="or-bubble or-typing" role="status" aria-label={`${NAME} is typing`} data-testid="orbit-typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <form className="or-composer" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor={`${panelId}-input`}>
              Your message
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              className="or-input"
              rows={1}
              maxLength={MAX_MESSAGE_CHARS}
              value={input}
              placeholder="Ask a question or request leave..."
              disabled={disabled}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`
              }}
              onKeyDown={onKeyDown}
              data-testid="orbit-input"
            />
            <button type="submit" className="or-send" disabled={disabled || !canSend(input, loading)} aria-label="Send message" data-testid="orbit-send">
              <Send size={18} aria-hidden="true" />
            </button>
            {input.length > MAX_MESSAGE_CHARS - 200 ? (
              <span className="or-count" role="status" data-testid="orbit-count">
                {input.length}/{MAX_MESSAGE_CHARS}
              </span>
            ) : null}
          </form>
        </section>
      ) : null}

      {filePreview ? <FilePreview key={filePreview.file_id} file={filePreview} onClose={() => setFilePreview(null)} /> : null}
      {preview ? <SourcePreview key={`${preview.kind}-${preview.id}-${preview.version ?? 0}`} source={preview} onClose={() => setPreview(null)} /> : null}
    </>
  )
}
