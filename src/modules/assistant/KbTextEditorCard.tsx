import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Bold, List, ListOrdered } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { assistantApi, parseFailure, type KbItem } from '@/api/assistant'
import { Field, Modal } from '@/modules/peoplemgmt/parts'
import { RichText } from './RichTextView'
import { handleEnter, toggleBold, toggleList, type EditState } from './editor'
import { KB_BODY_MAX, KB_TITLE_MAX, kbFailureText, validateKbText, type KbTextErrors } from './logic'

/**
 * Write (or edit) a text item. A plain textarea with a small toolbar that inserts the restricted Markdown subset around the selection
 * (**bold**, "- " bullets, "1. " numbering), keyboard shortcut Ctrl/Cmd+B, Enter continues a list and Enter on an empty item ends it.
 * The Preview tab draws the same subset as React elements (never HTML). What is stored is that plain text.
 */
export function KbTextEditorCard({ item, onSaved, onCancel }: { item: KbItem | null; onSaved: (message: string) => void; onCancel: () => void }) {
  const uid = useId().replace(/:/g, '')
  const initial = useRef({ title: item?.title ?? '', body: item?.body ?? '' })
  const [title, setTitle] = useState(initial.current.title)
  const [body, setBody] = useState(initial.current.body)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [errors, setErrors] = useState<KbTextErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<EditState | null>(null)

  const dirty = title !== initial.current.title || body !== initial.current.body

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // After a formatting change the new text is in place: restore the selection the helper asked for.
  useLayoutEffect(() => {
    const el = area.current
    const want = pending.current
    if (el && want) {
      el.focus()
      el.setSelectionRange(want.start, want.end)
      pending.current = null
    }
  }, [body])

  function current(): EditState {
    const el = area.current
    return { text: body, start: el?.selectionStart ?? body.length, end: el?.selectionEnd ?? body.length }
  }
  function apply(next: EditState) {
    pending.current = next
    setBody(next.text)
    // identical text would not re-render: put the selection back right away
    if (next.text === body && area.current) {
      area.current.focus()
      area.current.setSelectionRange(next.start, next.end)
      pending.current = null
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      apply(toggleBold(current()))
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing) {
      const next = handleEnter(current())
      if (next) {
        e.preventDefault()
        apply(next)
      }
    }
  }

  function close() {
    if (busy) return
    if (dirty) setDiscard(true)
    else onCancel()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const local = validateKbText({ title, body })
    if (Object.keys(local).length) {
      setErrors(local)
      setBanner('Please fix the highlighted fields.')
      if (local.body && !local.title) setTab('write')
      return
    }
    setBusy(true)
    setErrors({})
    setBanner(null)
    try {
      if (item) {
        const patch: { title?: string; body?: string } = {}
        if (title.trim() !== item.title) patch.title = title.trim()
        if (body.trim() !== item.body) patch.body = body.trim()
        if (Object.keys(patch).length === 0) {
          onCancel()
          return
        }
        await assistantApi.kb.update(item.item_id, patch)
        onSaved('Saved. Orbit uses the new text straight away.')
      } else {
        await assistantApi.kb.createText({ title: title.trim(), body: body.trim() })
        onSaved('Added. Orbit can answer from it straight away.')
      }
    } catch (err) {
      const f = parseFailure(err)
      setBanner(kbFailureText(f, item ? 'The text could not be saved.' : 'The text could not be added.'))
      setBusy(false) // what was typed stays exactly as it is
    }
  }

  const tools = [
    { key: 'bold', label: 'Bold', hint: 'Bold (Ctrl+B)', Icon: Bold, run: () => apply(toggleBold(current())) },
    { key: 'bullets', label: 'Bulleted list', hint: 'Bulleted list', Icon: List, run: () => apply(toggleList(current(), 'ul')) },
    { key: 'numbers', label: 'Numbered list', hint: 'Numbered list', Icon: ListOrdered, run: () => apply(toggleList(current(), 'ol')) },
  ]

  return (
    <>
      <form className="card card-pad or-kb-form" onSubmit={submit} noValidate aria-label={item ? 'Edit text' : 'Write text'} data-testid="text-editor">
        <h2 className="or-kb-form-title">{item ? 'Edit text' : 'Write text'}</h2>
        {banner ? (
          <div className="pm-dialog-error" data-testid="editor-banner">
            <Alert tone="danger">{banner}</Alert>
          </div>
        ) : null}
        <Field id={`${uid}-title`} label="Title" required error={errors.title} testId="field-title">
          {(a) => <input {...a} className="pm-input" type="text" maxLength={KB_TITLE_MAX} value={title} disabled={busy} autoComplete="off" onChange={(e) => setTitle(e.target.value)} data-testid="editor-title" />}
        </Field>

        <div className="or-md-tabs" role="tablist" aria-label="Text editor">
          <button type="button" role="tab" id={`${uid}-tab-write`} aria-selected={tab === 'write'} aria-controls={`${uid}-panel`} className={`or-md-tab${tab === 'write' ? ' or-md-tab-on' : ''}`} onClick={() => setTab('write')} data-testid="tab-write">
            Write
          </button>
          <button type="button" role="tab" id={`${uid}-tab-preview`} aria-selected={tab === 'preview'} aria-controls={`${uid}-panel`} className={`or-md-tab${tab === 'preview' ? ' or-md-tab-on' : ''}`} onClick={() => setTab('preview')} data-testid="tab-preview">
            Preview
          </button>
        </div>

        <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`}>
          {tab === 'write' ? (
            <>
              <div className="or-md-toolbar" role="toolbar" aria-label="Formatting" data-testid="editor-toolbar">
                {tools.map(({ key, label, hint, Icon, run }) => (
                  <button
                    key={key}
                    type="button"
                    className="or-md-tool"
                    aria-label={label}
                    title={hint}
                    disabled={busy}
                    onMouseDown={(e) => e.preventDefault() /* keep the selection in the text box */}
                    onClick={run}
                    data-testid={`tool-${key}`}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <Field id={`${uid}-body`} label="Text" required error={errors.body} help="Plain text with **bold**, - bullets and 1. numbering. Switch to Preview to see how it will look." testId="field-body">
                {(a) => (
                  <textarea
                    {...a}
                    ref={area}
                    className="pm-input or-kb-textarea"
                    rows={10}
                    maxLength={KB_BODY_MAX}
                    value={body}
                    disabled={busy}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={onKeyDown}
                    data-testid="editor-body"
                  />
                )}
              </Field>
              {body.length > KB_BODY_MAX - 1000 ? (
                <p className="pm-help" role="status" data-testid="editor-count">
                  {body.length.toLocaleString('en-US')} / {KB_BODY_MAX.toLocaleString('en-US')}
                </p>
              ) : null}
            </>
          ) : (
            <div className="or-md-preview" data-testid="editor-preview">
              {body.trim() ? <RichText text={body} /> : <p className="pm-muted">Nothing to preview yet. Write some text first.</p>}
              {errors.body ? (
                <p className="pm-field-error" role="alert">
                  {errors.body}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="pm-actions">
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="editor-save">
            {busy ? 'Saving...' : item ? 'Save changes' : 'Add to Knowledge Base'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={close} disabled={busy} data-testid="editor-cancel">
            Cancel
          </button>
        </div>
      </form>

      {discard ? (
        <Modal title="Discard your changes?" onClose={() => setDiscard(false)} testId="discard-dialog">
          <p className="or-dialog-text">You have changes that are not saved. If you close the editor now they are lost.</p>
          <div className="pm-dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDiscard(false)} data-autofocus data-testid="discard-keep">
              Keep editing
            </button>
            <button type="button" className="btn pm-btn-danger" onClick={onCancel} data-testid="discard-confirm">
              Discard changes
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
