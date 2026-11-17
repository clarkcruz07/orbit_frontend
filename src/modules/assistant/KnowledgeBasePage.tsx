import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Download, FileText, FileUp, PenLine, ShieldOff, Trash2, Type } from 'lucide-react'
import { PageTitle } from '@/pages/PageTitle'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { formatDate } from '@/lib/dates'
import { assistantApi, parseFailure, type ChatSource, type KbItem, type KbStatus } from '@/api/assistant'
import { ErrorBlock, LoadingCard, Modal, Notice, Pill } from '@/modules/peoplemgmt/parts'
import { downloadKbFile } from './download'
import { KbTextEditorCard } from './KbTextEditorCard'
import { KbUploadCard } from './KbUploadCard'
import { SourcePreview } from './SourcePreview'
import { excerpt, fileSizeText, kbFailureText, kindPill, statusPill } from './logic'
import '@/pages/pages.css'
import '@/modules/peoplemgmt/peoplemgmt.css'
import './assistant.css'

type Load = { kind: 'loading' } | { kind: 'ready'; items: KbItem[]; status: KbStatus | null } | { kind: 'error'; message: string } | { kind: 'denied' }
type Editor = null | { mode: 'upload' } | { mode: 'text'; item: KbItem | null }

/**
 * The Knowledge Base (HR): everything Bluedge Orbit knows besides the published policy documents. Files (PDF, Word, text) and written text.
 * This is the source of truth for the assistant's answers.
 */
export function KnowledgeBasePage() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [editor, setEditor] = useState<Editor>(null)
  const [confirm, setConfirm] = useState<KbItem | null>(null)
  const [preview, setPreview] = useState<ChatSource | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }))
    Promise.all([assistantApi.kb.items(), assistantApi.kb.status().catch(() => null)])
      .then(([items, status]) => live && setLoad({ kind: 'ready', items, status }))
      .catch((err) => {
        if (!live) return
        const f = parseFailure(err)
        setLoad(f.status === 403 ? { kind: 'denied' } : { kind: 'error', message: kbFailureText(f, 'The Knowledge Base could not be loaded.') })
      })
    return () => {
      live = false
    }
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  if (load.kind === 'denied') {
    return (
      <div className="page pm-page" data-testid="kb-denied">
        <EmptyState icon={<ShieldOff size={28} />} title="The Knowledge Base is not available" body="Only HR administrators can manage what Bluedge Orbit knows. Everyone can still ask it questions." />
      </div>
    )
  }

  const startEditor = (e: Editor) => {
    setNotice(null)
    setRowError(null)
    setEditor(e)
  }

  async function toggle(i: KbItem) {
    setBusyId(i.item_id)
    setRowError(null)
    try {
      await assistantApi.kb.update(i.item_id, { active: !i.active })
      setNotice(i.active ? `${i.title} is switched off. Orbit no longer uses it.` : `${i.title} is switched on.`)
      reload()
    } catch (err) {
      setRowError(kbFailureText(parseFailure(err), 'The item could not be changed.'))
    } finally {
      setBusyId(null)
    }
  }

  async function download(i: KbItem) {
    setBusyId(i.item_id)
    setRowError(null)
    try {
      await downloadKbFile(i.item_id, i.filename ?? i.title)
    } catch (err) {
      const f = parseFailure(err)
      setRowError(f.status === 404 ? 'That file is no longer available. Reload the list.' : kbFailureText(f, 'The file could not be downloaded.'))
    } finally {
      setBusyId(null)
    }
  }

  const ready = load.kind === 'ready' ? load : null
  const adding = editor !== null
  const addButtons = (
    <>
      <button type="button" className="btn btn-primary" onClick={() => startEditor({ mode: 'upload' })} data-testid="add-upload">
        <FileUp size={16} aria-hidden="true" /> Upload file
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => startEditor({ mode: 'text', item: null })} data-testid="add-text">
        <PenLine size={16} aria-hidden="true" /> Write text
      </button>
    </>
  )

  return (
    <div className="page pm-page" data-testid="kb-page">
      <PageTitle title="Knowledge Base" subtitle="What Bluedge Orbit knows. Everything here is the source of truth for its answers." />

      {ready?.status ? <StatusCard status={ready.status} /> : null}

      {!adding && ready && ready.items.length > 0 ? <div className="or-kb-bar" data-testid="kb-add-bar">{addButtons}</div> : null}

      {notice ? (
        <div className="pm-notice-row" data-testid="kb-notice">
          <Alert tone="info">{notice}</Alert>
        </div>
      ) : null}
      {rowError ? (
        <div className="pm-notice-row" data-testid="kb-row-error">
          <Alert tone="danger">{rowError}</Alert>
        </div>
      ) : null}

      {editor?.mode === 'upload' ? (
        <KbUploadCard
          onCancel={() => setEditor(null)}
          onUploaded={(message) => {
            setEditor(null)
            setNotice(message)
            reload()
          }}
        />
      ) : null}
      {editor?.mode === 'text' ? (
        <KbTextEditorCard
          key={editor.item?.item_id ?? 'new'}
          item={editor.item}
          onCancel={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null)
            setNotice(message)
            reload()
          }}
        />
      ) : null}

      {load.kind === 'loading' ? <LoadingCard testId="kb-loading" label="Loading the Knowledge Base" /> : null}
      {load.kind === 'error' ? <ErrorBlock message={load.message} onRetry={reload} testId="kb-error" /> : null}

      {ready && ready.items.length === 0 && !adding ? (
        <EmptyState
          icon={<BookOpen size={28} />}
          title="Nothing in the Knowledge Base yet"
          body="Upload a file or write some text. Orbit answers from what you add here, and shows the source with every answer."
          action={<div className="or-kb-empty-actions" data-testid="kb-empty">{addButtons}</div>}
        />
      ) : null}

      {ready && ready.items.length > 0 ? (
        <ul className="or-kb-list" data-testid="kb-list">
          {ready.items.map((i) => {
            const kind = kindPill(i)
            const st = statusPill(i)
            const busy = busyId === i.item_id
            return (
              <li key={i.item_id} className="card card-pad or-kb-item" data-testid="kb-item" data-id={i.item_id} data-kind={i.kind} data-status={i.status} data-active={i.active ? 'true' : 'false'}>
                <div className="or-kb-head">
                  <span className="or-kb-icon" aria-hidden="true">
                    {i.kind === 'file' ? <FileText size={20} /> : <Type size={20} />}
                  </span>
                  <strong className="pm-wrap or-kb-title" data-testid="kb-item-title">
                    {i.title}
                  </strong>
                  <Pill tone={kind.tone} testId="kb-item-kind">
                    {kind.label}
                  </Pill>
                  <Pill tone={st.tone} title={st.title} testId="kb-item-status">
                    {st.label}
                  </Pill>
                  {!i.active ? <Pill tone="neutral" testId="kb-item-off">Off</Pill> : null}
                </div>
                {i.status === 'unreadable' ? (
                  <p className="or-kb-reason" data-testid="kb-item-reason">
                    Orbit cannot read this: {i.reason || 'no text could be found in it.'}
                  </p>
                ) : null}
                {i.kind === 'text' ? (
                  <p className="or-kb-excerpt">{excerpt(i.body)}</p>
                ) : (
                  <p className="or-kb-excerpt pm-muted" data-testid="kb-item-file">
                    {i.filename}
                    {fileSizeText(i.size) ? ` (${fileSizeText(i.size)})` : ''}
                  </p>
                )}
                <p className="pm-muted or-kb-date" data-testid="kb-item-updated">
                  Updated {formatDate(i.updated_at)}
                  {i.updated_by_name ? ` by ${i.updated_by_name}` : ''}
                </p>
                <div className="or-kb-actions">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={i.active}
                    aria-label={`Active: ${i.title}`}
                    className={`or-switch${i.active ? ' or-switch-on' : ''}`}
                    onClick={() => void toggle(i)}
                    disabled={busy}
                    data-testid="kb-toggle"
                  >
                    <span className="or-switch-track" aria-hidden="true">
                      <span className="or-switch-thumb" />
                    </span>
                    <span>{i.active ? 'Active' : 'Off'}</span>
                  </button>
                  {i.kind === 'text' ? (
                    <button type="button" className="btn btn-secondary" onClick={() => startEditor({ mode: 'text', item: i })} disabled={adding} aria-label={`Edit ${i.title}`} data-testid="kb-edit">
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setPreview({ kind: 'kb', id: i.item_id, title: i.title, version: null, snippet: '', has_file: true })}
                        aria-label={`Preview ${i.title}`}
                        data-testid="kb-preview"
                      >
                        Preview
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => void download(i)} disabled={busy} aria-label={`Download ${i.title}`} data-testid="kb-download">
                        <Download size={16} aria-hidden="true" /> Download
                      </button>
                    </>
                  )}
                  <button type="button" className="btn pm-btn-danger" onClick={() => setConfirm(i)} aria-label={`Delete ${i.title}`} data-testid="kb-delete">
                    <Trash2 size={16} aria-hidden="true" /> Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {preview ? <SourcePreview key={preview.id} source={preview} onClose={() => setPreview(null)} /> : null}
      {confirm ? (
        <DeleteDialog
          item={confirm}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setNotice(`${confirm.title} was deleted.`)
            setConfirm(null)
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

function StatusCard({ status }: { status: KbStatus }) {
  return (
    <section className="card card-pad or-kb-status" aria-label="What Orbit reads" data-testid="kb-status">
      <p data-testid="kb-status-items">
        <strong>{status.items_total}</strong> {status.items_total === 1 ? 'item' : 'items'} in the Knowledge Base: <strong>{status.items_indexed}</strong> indexed
        {status.items_unreadable > 0 ? (
          <>
            , <strong>{status.items_unreadable}</strong> can't be read
          </>
        ) : null}
        .
      </p>
      <p data-testid="kb-status-policies">
        <strong>{status.policies_indexed}</strong> published {status.policies_indexed === 1 ? 'policy document is' : 'policy documents are'} also ready for Orbit to read.
      </p>
      {status.policies_unreadable.length > 0 ? (
        <div data-testid="kb-unreadable">
          <Notice tone="warning">These policy documents have no text Orbit can read (for example a scanned image). Upload a text-based PDF to include them.</Notice>
          <ul className="or-kb-unreadable">
            {status.policies_unreadable.map((u) => (
              <li key={u.policy_id} data-testid="kb-unreadable-item">
                <strong className="pm-wrap">{u.title}</strong> <span className="pm-muted">{u.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function DeleteDialog({ item, onClose, onDone }: { item: KbItem; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await assistantApi.kb.remove(item.item_id)
      onDone()
    } catch (err) {
      setError(kbFailureText(parseFailure(err), 'The item could not be deleted.'))
      setBusy(false)
    }
  }

  return (
    <Modal title={`Delete ${item.title}?`} onClose={onClose} busy={busy} testId="delete-dialog">
      <ul className="pm-consequences">
        <li>{item.kind === 'file' ? 'The file is' : 'The text is'} removed for good and Orbit can no longer answer from it.</li>
        <li>If you only want Orbit to stop using it for now, switch it off instead.</li>
      </ul>
      {error ? (
        <div className="pm-dialog-error" data-testid="dialog-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="pm-dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-autofocus data-testid="dialog-cancel">
          Cancel
        </button>
        <button type="button" className="btn pm-btn-danger" onClick={run} disabled={busy} data-testid="delete-confirm">
          {busy ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </Modal>
  )
}
