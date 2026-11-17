import { useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Paperclip, Send } from 'lucide-react'
import { PageTitle } from '@/pages/PageTitle'
import { EmptyState } from '@/ui/EmptyState'
import { Alert } from '@/ui/Feedback'
import { useAuthStore } from '@/stores/authStore'
import { saveBlob, useLoad } from '@/modules/documents/hooks'
import { casesApi, type CaseDetail as CaseDetailT, type CaseMessage, type CaseStatus } from './api'
import { CaseControls } from './CaseControls'
import { ErrorBlock, FieldError, FileField, LoadingCard, Notice, PriorityPill, Spinner, StatusPill } from './parts'
import {
  PRIVACY_NOTE,
  REPLY_MAX,
  assigneeText,
  counter,
  formatBytes,
  formatDateTime,
  hasAction,
  parseServerError,
  replyNote,
  roleLabel,
  speakerLabel,
  statusLabel,
  typeLabel,
  uploadErrorText,
  validateReply,
} from './logic'
import './hrcases.css'

export function CaseDetail() {
  const { id = '' } = useParams()
  const me = useAuthStore((s) => s.user)
  const detail = useLoad(() => casesApi.get(id).then((r) => r.data), [id], 'The request could not be loaded.')
  const [notice, setNotice] = useState<string | null>(null)
  const c = detail.data

  if (detail.error && (detail.error.status === 404 || detail.error.status === 403)) {
    return (
      <div className="page dc-page" data-testid="case-missing">
        <PageTitle title="HR request" />
        <EmptyState
          title="Request not found"
          body="This request does not exist, or you do not have access to it. Only the person who raised a request and HR can open it."
          action={
            <Link to="/hr-requests" className="btn btn-primary">
              Back to HR Requests
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="page dc-page" data-testid="case-detail" data-status={c?.status ?? ''}>
      <PageTitle title={c ? c.subject : 'HR request'} subtitle={c ? `${c.type.name}${c.employee?.name ? ` - ${c.employee.name}` : ''}` : undefined} />
      <p className="hc-back">
        <Link to="/hr-requests" className="hc-back-link" data-testid="back-to-requests">
          <ArrowLeft size={16} aria-hidden="true" /> Back to HR Requests
        </Link>
      </p>
      <Notice testId="privacy-note">{PRIVACY_NOTE}</Notice>

      {detail.error ? (
        <ErrorBlock message={detail.error.detail} onRetry={detail.reload} testId="case-error" />
      ) : detail.loading && !c ? (
        <LoadingCard testId="case-loading" />
      ) : c ? (
        <div className="hc-grid">
          <div className="hc-main">
            <section className="card card-pad" aria-labelledby="hc-thread-h">
              <h2 id="hc-thread-h">Conversation</h2>
              <ol className="hc-thread" data-testid="thread">
                {c.messages.map((m) => (
                  <Message key={m.message_id} caseId={c.case_id} m={m} meUserId={me?.user_id ?? null} />
                ))}
              </ol>
            </section>

            {notice ? (
              <div data-testid="case-notice">
                <Alert tone="warning">{notice}</Alert>
              </div>
            ) : null}

            {hasAction(c.allowed_actions, 'reply') ? (
              <ReplyForm
                c={c}
                isOwner={Boolean(me?.employee_id && c.employee?.employee_id === me.employee_id)}
                onSent={(next) => {
                  setNotice(null)
                  detail.setData(next)
                }}
                onRefused={(message) => {
                  setNotice(message)
                  detail.reload()
                }}
              />
            ) : c.status === 'closed' ? (
              <div data-testid="closed-note">
                <Alert tone="info">This request is closed. Nobody can reply to it or change it any more.</Alert>
              </div>
            ) : null}
          </div>

          <aside className="hc-side" aria-label="Request details">
            <section className="card card-pad" data-testid="case-summary">
              <h2>Details</h2>
              <dl className="hc-facts">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <StatusPill status={c.status} />
                  </dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>
                    <PriorityPill priority={c.priority} />
                  </dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{c.type.name}</dd>
                </div>
                {c.employee ? (
                  <div>
                    <dt>Raised by</dt>
                    <dd data-testid="case-employee">
                      {c.employee.name ?? c.employee.employee_id}
                      {c.employee.department ? ` (${c.employee.department})` : ''}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>Handled by</dt>
                  <dd data-testid="case-assignee">{assigneeText(c.assignee, me?.user_id)}</dd>
                </div>
                <div>
                  <dt>Opened</dt>
                  <dd>{formatDateTime(c.created_at)}</dd>
                </div>
                {c.resolved_at ? (
                  <div>
                    <dt>Resolved</dt>
                    <dd>{formatDateTime(c.resolved_at)}</dd>
                  </div>
                ) : null}
                {c.closed_at ? (
                  <div>
                    <dt>Closed</dt>
                    <dd>{formatDateTime(c.closed_at)}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
            <CaseControls c={c} onChanged={(next) => detail.setData(next)} onStale={detail.reload} />
          </aside>
        </div>
      ) : null}
    </div>
  )
}

function Message({ caseId, m, meUserId }: { caseId: string; m: CaseMessage; meUserId: string | null }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const att = m.attachment

  async function download() {
    if (!att) return
    setBusy(true)
    setError(null)
    try {
      const res = await casesApi.attachmentBlob(caseId, m.message_id)
      saveBlob(res.data, att.filename)
    } catch (err) {
      setError(parseServerError(err, 'The attachment could not be downloaded.').detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`hc-msg hc-msg-${m.by.role}`} data-testid="message" data-role={m.by.role} data-description={m.is_description ? 'yes' : 'no'}>
      <div className="hc-msg-head">
        <strong className="hc-msg-who">{speakerLabel(m.by, meUserId)}</strong>
        <span className={`hc-role hc-role-${m.by.role}`}>{roleLabel(m.by.role)}</span>
        {m.is_description ? <span className="hc-role hc-role-original">Original request</span> : null}
        <span className="dc-sub hc-msg-time">{formatDateTime(m.at)}</span>
      </div>
      <p className="hc-msg-text" data-testid="message-text">
        {m.text}
      </p>
      {att ? (
        <div className="hc-attach">
          <button type="button" className="btn btn-secondary" onClick={() => void download()} disabled={busy} data-testid="attachment-download">
            <Paperclip size={16} aria-hidden="true" /> <span className="hc-attach-name">{att.filename}</span>
          </button>
          <span className="dc-sub">
            {typeLabel(att.content_type)} - {formatBytes(att.size_bytes)}
          </span>
        </div>
      ) : null}
      {error ? (
        <div data-testid="attachment-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </li>
  )
}

function ReplyForm({ c, isOwner, onSent, onRefused }: { c: CaseDetailT; isOwner: boolean; onSent: (next: CaseDetailT) => void; onRefused: (message: string) => void }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [textError, setTextError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const canPickStatus = hasAction(c.allowed_actions, 'set_status') && c.allowed_statuses.length > 0
  const note = replyNote(c.status, isOwner)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const problem = validateReply(text)
    setTextError(problem)
    if (problem) return
    setBusy(true)
    try {
      const res = await casesApi.reply(c.case_id, { text: text.trim(), status: status ? (status as CaseStatus) : undefined, file })
      setText('')
      setStatus('')
      setFile(null)
      setFileKey((k) => k + 1)
      onSent(res.data)
    } catch (err) {
      const info = parseServerError(err)
      if (info.status === 409) {
        // The form may disappear with the reload (a closed case has no reply box), so the notice lives on the page.
        onRefused('The request changed (it may be closed, or that status is no longer possible). The latest state has been loaded; your reply was not sent.')
      } else setServerError(uploadErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card card-pad dc-form" onSubmit={submit} noValidate data-testid="reply-form" aria-label="Reply">
      <h2>Reply</h2>
      {note ? (
        <p className="dc-fine" data-testid="reply-note">
          {note}
        </p>
      ) : null}
      <div className="dc-field">
        <label className="dc-label" htmlFor="hc-reply">
          Your message
        </label>
        <textarea ref={box} id="hc-reply" className="dc-input dc-textarea" rows={4} maxLength={REPLY_MAX} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} data-testid="reply-text" />
        <div className="hc-counter">{counter(text, REPLY_MAX)}</div>
        <FieldError text={textError ?? undefined} />
      </div>
      <FileField key={fileKey} id="hc-reply-file" file={file} onFile={setFile} disabled={busy} label="Attachment (optional, one file)" testId="reply-file" />
      {canPickStatus ? (
        <div className="dc-field dc-field-narrow">
          <label className="dc-label" htmlFor="hc-reply-status">
            Also change the status <span className="dc-opt">(optional)</span>
          </label>
          <select id="hc-reply-status" className="dc-input" value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy} data-testid="reply-status">
            <option value="">Keep the current status ({statusLabel(c.status)})</option>
            {c.allowed_statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {busy ? <Spinner label="Sending..." /> : null}
      {serverError ? (
        <div data-testid="reply-error">
          <Alert tone="danger">{serverError}</Alert>
        </div>
      ) : null}
      <div className="dc-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="reply-submit">
          <Send size={16} aria-hidden="true" /> Send reply
        </button>
      </div>
    </form>
  )
}
