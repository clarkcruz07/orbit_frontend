import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, FileX, Upload } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { PageTitle } from '@/pages/PageTitle'
import { learningApi, type Certificate, type Enrolment } from './api'
import { useLearnConfig, useLoad, type LearnConfigState } from './hooks'
import { BackLink, ConfirmationPill, Counter, ErrorBlock, FieldError, LoadingCard, Pill, ProgressBar, StatusPill } from './parts'
import {
  addDays,
  assignedByText,
  certHint,
  clampProgress,
  deliveryLabel,
  downloadName,
  dueText,
  durationLabel,
  enrolmentCan,
  formatBytes,
  formatDateTime,
  isIsoDate,
  parseServerError,
  personName,
  typeLabel,
  uploadErrorText,
  validateNote,
} from './logic'
import { todayIso } from '@/lib/dates'
import { ReviewActions } from './lists'
import './learning.css'

type Banner = { tone: 'info' | 'danger'; text: string } | null

export function EnrolmentDetail() {
  const { id = '' } = useParams()
  const cfg = useLearnConfig()
  const load = useLoad(() => learningApi.enrolment(id).then((r) => r.data), [id], 'This enrolment could not be loaded.')
  const e = load.data
  const [banner, setBanner] = useState<Banner>(null)

  if (load.error && !e) {
    return (
      <div className="page ln-page" data-testid="enrolment-detail-error">
        <BackLink to="/learning?tab=mine">Back to my learning</BackLink>
        {load.error.status === 404 ? (
          <EmptyState icon={<FileX size={28} />} title="Enrolment not found" body="This enrolment does not exist, or you do not have access to it." />
        ) : (
          <ErrorBlock message={load.error.detail} onRetry={load.reload} />
        )}
      </div>
    )
  }
  if (!e) {
    return (
      <div className="page ln-page" data-testid="enrolment-detail-loading">
        <BackLink to="/learning?tab=mine">Back to my learning</BackLink>
        <LoadingCard rows={4} />
      </div>
    )
  }

  const own = enrolmentCan(e, 'start') || enrolmentCan(e, 'update_progress') || enrolmentCan(e, 'complete') || enrolmentCan(e, 'upload_certificate')
  const reviewing = enrolmentCan(e, 'confirm') || enrolmentCan(e, 'return')
  const back = own ? '/learning?tab=mine' : reviewing ? '/learning?tab=team' : '/learning?tab=mine'
  const due = dueText(e, (d) => formatDate(d))

  const apply = (next: Enrolment, text: string) => {
    load.setData(next)
    setBanner({ tone: 'info', text })
  }
  const conflict = (message: string) => {
    setBanner({ tone: 'danger', text: `${message} The latest version has been loaded; please check and try again.` })
    load.reload()
  }

  return (
    <div className="page ln-page" data-testid="enrolment-detail" data-id={e.enrolment_id} data-status={e.status}>
      <BackLink to={back}>Back</BackLink>
      <PageTitle title={e.course.title} subtitle={own ? 'Your learning' : `${personName(e.employee)}'s learning`} />
      {banner ? (
        <div className="ln-flash-block" data-testid="enrolment-banner">
          <Alert tone={banner.tone}>{banner.text}</Alert>
        </div>
      ) : null}

      <div className="ln-detail-grid">
        <div className="ln-col">
          <section className="card card-pad" aria-labelledby="enrol-summary-title">
            <div className="ln-card-head">
              <h2 id="enrol-summary-title">Summary</h2>
              <div className="ln-row-pills">
                <StatusPill status={e.status} />
                {e.mandatory ? <Pill tone="violet" testId="mandatory-pill">Mandatory</Pill> : null}
                {e.overdue ? <Pill tone="red" testId="overdue-pill">Overdue</Pill> : null}
                {!e.overdue && e.due_soon ? <Pill tone="amber" testId="due-soon-pill">Due soon</Pill> : null}
                <ConfirmationPill e={e} />
              </div>
            </div>
            <dl className="ln-facts">
              <div>
                <dt>Person</dt>
                <dd data-testid="enrolment-person">
                  {personName(e.employee)}
                  {e.employee.department ? ` - ${e.employee.department}` : ''}
                </dd>
              </div>
              <div>
                <dt>Course</dt>
                <dd>{[e.course.category, deliveryLabel(e.course.delivery), durationLabel(e.course.duration_hours)].filter((x) => x && x !== '-').join(' - ') || '-'}</dd>
              </div>
              <div>
                <dt>How it started</dt>
                <dd data-testid="enrolment-source">
                  {assignedByText(e)}
                  {e.assigned_at ? ` on ${formatDateTime(e.assigned_at)}` : ''}
                </dd>
              </div>
              <div>
                <dt>Due date</dt>
                <dd data-testid="enrolment-due" className={e.overdue ? 'ln-overdue' : undefined}>
                  {due ?? 'No due date'}
                </dd>
              </div>
              <div className="ln-fact-wide">
                <dt>Progress</dt>
                <dd>
                  <div className="ln-row-progress">
                    <ProgressBar value={e.progress} label="Course progress" />
                    <span className="ln-progress-num" data-testid="enrolment-progress">
                      {e.progress}%
                    </span>
                  </div>
                </dd>
              </div>
              {e.status === 'completed' ? (
                <div>
                  <dt>Completed</dt>
                  <dd data-testid="enrolment-completed-at">{formatDateTime(e.completed_at)}</dd>
                </div>
              ) : null}
              {e.confirmation_status === 'confirmed' ? (
                <div>
                  <dt>Confirmed</dt>
                  <dd data-testid="enrolment-confirmed">
                    {formatDateTime(e.confirmed_at)}
                    {e.confirmed_by ? ` by ${personName(e.confirmed_by)}` : ''}
                  </dd>
                </div>
              ) : null}
            </dl>
            {e.completion_note ? (
              <>
                <h3 className="ln-subhead">Completion note</h3>
                <p className="ln-text" data-testid="completion-note">
                  {e.completion_note}
                </p>
              </>
            ) : null}
          </section>

          <CertificatesCard e={e} cfg={cfg} onUploaded={(n) => apply(n, 'Certificate uploaded.')} onConflict={conflict} />
        </div>

        <div className="ln-col">
          {reviewing ? (
            <section className="card card-pad" aria-labelledby="confirm-title" data-testid="confirm-card">
              <h2 id="confirm-title">Confirm this completion</h2>
              <p className="ln-help">Check the note and any certificate, then confirm it. Sending it back lets the employee complete it again.</p>
              <ReviewActions
                e={e}
                onChanged={() => {
                  load.reload()
                  setBanner({ tone: 'info', text: 'Updated. The employee has been notified.' })
                }}
              />
            </section>
          ) : null}
          <OwnerActions e={e} cfg={cfg} onUpdated={apply} onConflict={conflict} />
          <ManagerActions e={e} onUpdated={apply} onConflict={conflict} />
          {!own && !reviewing && !enrolmentCan(e, 'update_due_date') && !enrolmentCan(e, 'cancel') ? (
            <section className="card card-pad" data-testid="enrolment-readonly">
              <h2>Read-only</h2>
              <p className="ln-help">There is nothing for you to do on this enrolment.</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ owner actions
function OwnerActions({ e, cfg, onUpdated, onConflict }: { e: Enrolment; cfg: LearnConfigState; onUpdated: (e: Enrolment, text: string) => void; onConflict: (m: string) => void }) {
  const [progress, setProgress] = useState(e.progress)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'start' | 'progress' | 'complete'>(null)
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState(e.version)
  if (seen !== e.version) {
    setSeen(e.version)
    setProgress(e.progress)
  }

  const start = enrolmentCan(e, 'start')
  const prog = enrolmentCan(e, 'update_progress')
  const complete = enrolmentCan(e, 'complete')
  if (!start && !prog && !complete) return null

  async function run(kind: 'start' | 'progress' | 'complete', fn: () => Promise<{ data: Enrolment }>, text: (n: Enrolment) => string) {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      const res = await fn()
      onUpdated(res.data, text(res.data))
    } catch (err) {
      const info = parseServerError(err, 'That could not be done.')
      if (info.status === 409) onConflict(info.detail)
      else setError(info.detail)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card card-pad" aria-labelledby="owner-actions-title" data-testid="owner-actions">
      <h2 id="owner-actions-title">Your progress</h2>
      {start ? (
        <div className="ln-block">
          <p className="ln-help">You have not started this course yet.</p>
          <div className="ln-actions ln-actions-left">
            <button type="button" className="btn btn-primary" onClick={() => run('start', () => learningApi.start(e.enrolment_id), () => 'Course started.')} disabled={busy !== null} data-testid="start-course">
              {busy === 'start' ? 'Starting...' : 'Start course'}
            </button>
          </div>
        </div>
      ) : null}

      {prog ? (
        <div className="ln-block" data-testid="progress-block">
          <label className="ln-label" htmlFor="progress-slider">
            Progress
          </label>
          <div className="ln-slider-row">
            <input
              id="progress-slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              disabled={busy !== null}
              onChange={(ev) => setProgress(clampProgress(Number(ev.target.value)))}
              aria-valuetext={`${progress} percent`}
              className="ln-slider"
              data-testid="progress-slider"
            />
            <output className="ln-slider-value" data-testid="progress-value">
              {progress}%
            </output>
          </div>
          <p className="ln-help">Reaching 100% does not complete the course: use "Mark complete" below.</p>
          <div className="ln-actions ln-actions-left">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => run('progress', () => learningApi.patchEnrolment(e.enrolment_id, { progress, version: e.version }), (n) => `Progress saved: ${n.progress}%.`)}
              disabled={busy !== null || progress === e.progress}
              data-testid="progress-save"
            >
              {busy === 'progress' ? 'Saving...' : 'Save progress'}
            </button>
          </div>
        </div>
      ) : null}

      {complete ? (
        <div className="ln-block" data-testid="complete-block">
          <label className="ln-label" htmlFor="completion-note">
            Completion note <span className="ln-opt">(optional)</span>
          </label>
          <textarea
            id="completion-note"
            className="ln-input ln-textarea"
            rows={3}
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? 'completion-note-error' : undefined}
            data-testid="completion-note-input"
          />
          <div className="ln-help-row">
            <FieldError id="completion-note-error" message={noteError} />
            <Counter value={note} max={cfg.limits.completion_note_max} />
          </div>
          <p className="ln-help" data-testid="complete-hint">
            {e.requires_confirmation ? 'This course needs confirmation: your reviewer is asked to confirm it after you mark it complete.' : 'This course is self-attested: it counts as complete as soon as you mark it complete.'}
          </p>
          <div className="ln-actions ln-actions-left">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const problem = validateNote(note, cfg.limits.completion_note_max)
                setNoteError(problem)
                if (problem) return
                void run('complete', () => learningApi.complete(e.enrolment_id, note), () => (e.requires_confirmation ? 'Marked complete. It is now waiting for confirmation.' : 'Marked complete.'))
              }}
              disabled={busy !== null}
              data-testid="complete-course"
            >
              {busy === 'complete' ? 'Saving...' : 'Mark complete'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div data-testid="owner-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ assigner / manager actions
function ManagerActions({ e, onUpdated, onConflict }: { e: Enrolment; onUpdated: (e: Enrolment, text: string) => void; onConflict: (m: string) => void }) {
  const [due, setDue] = useState(e.due_date ?? '')
  const [dueError, setDueError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'due' | 'cancel'>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [seen, setSeen] = useState(e.version)
  if (seen !== e.version) {
    setSeen(e.version)
    setDue(e.due_date ?? '')
  }
  const mayDue = enrolmentCan(e, 'update_due_date')
  const mayCancel = enrolmentCan(e, 'cancel')
  if (!mayDue && !mayCancel) return null

  async function saveDue(value: string | null) {
    if (busy) return
    if (value !== null) {
      if (!isIsoDate(value)) {
        setDueError('Enter a valid date.')
        return
      }
      if (value < addDays(todayIso(new Date()), -1)) {
        setDueError('The due date cannot be in the past.')
        return
      }
    }
    setDueError(null)
    setBusy('due')
    setError(null)
    try {
      const res = await learningApi.patchEnrolment(e.enrolment_id, { due_date: value, version: e.version })
      onUpdated(res.data, value ? `Due date saved: ${formatDate(value)}.` : 'Due date cleared.')
    } catch (err) {
      const info = parseServerError(err, 'The due date could not be saved.')
      if (info.status === 409) onConflict(info.detail)
      else setError(info.detail)
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    if (busy) return
    setBusy('cancel')
    setError(null)
    try {
      const res = await learningApi.cancel(e.enrolment_id)
      onUpdated(res.data, 'Enrolment cancelled.')
    } catch (err) {
      const info = parseServerError(err, 'The enrolment could not be cancelled.')
      if (info.status === 409) onConflict(info.detail)
      else setError(info.detail)
      setConfirmCancel(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card card-pad" aria-labelledby="manage-title" data-testid="manage-card">
      <h2 id="manage-title">Manage</h2>
      {mayDue ? (
        <div className="ln-block">
          <label className="ln-label" htmlFor="due-input">
            Due date
          </label>
          <input
            id="due-input"
            type="date"
            className="ln-input ln-input-date"
            value={due}
            min="2000-01-01"
            max="2100-12-31"
            onChange={(ev) => setDue(ev.target.value)}
            aria-invalid={dueError ? true : undefined}
            aria-describedby={dueError ? 'due-input-error' : undefined}
            disabled={busy !== null}
            data-testid="due-input"
          />
          <FieldError id="due-input-error" message={dueError} />
          <div className="ln-actions ln-actions-left">
            <button type="button" className="btn btn-secondary" onClick={() => saveDue(due.trim() || null)} disabled={busy !== null || due === (e.due_date ?? '')} data-testid="due-save">
              {busy === 'due' ? 'Saving...' : 'Save due date'}
            </button>
          </div>
        </div>
      ) : null}
      {mayCancel ? (
        <div className="ln-block">
          {confirmCancel ? (
            <div className="ln-confirm" data-testid="cancel-confirm-box">
              <p className="ln-help">Cancel this enrolment? The employee is told. This cannot be undone, but they can be enrolled again.</p>
              <div className="ln-actions ln-actions-left">
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmCancel(false)} disabled={busy !== null} data-testid="cancel-keep">
                  Keep it
                </button>
                <button type="button" className="btn ln-btn-danger" onClick={cancel} disabled={busy !== null} data-testid="cancel-confirm">
                  {busy === 'cancel' ? 'Cancelling...' : 'Yes, cancel it'}
                </button>
              </div>
            </div>
          ) : (
            <div className="ln-actions ln-actions-left">
              <button type="button" className="btn ln-btn-danger-outline" onClick={() => setConfirmCancel(true)} disabled={busy !== null} data-testid="cancel-enrolment">
                Cancel enrolment
              </button>
            </div>
          )}
        </div>
      ) : null}
      {error ? (
        <div data-testid="manage-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ certificates
function CertificatesCard({ e, cfg, onUploaded, onConflict }: { e: Enrolment; cfg: LearnConfigState; onUploaded: (e: Enrolment) => void; onConflict: (m: string) => void }) {
  const mayUpload = enrolmentCan(e, 'upload_certificate')
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fraction, setFraction] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dlBusy, setDlBusy] = useState<string | null>(null)
  const [dlError, setDlError] = useState<string | null>(null)

  async function upload() {
    if (!file || uploading) return
    setUploading(true)
    setError(null)
    setFraction(0)
    try {
      const res = await learningApi.uploadCertificate(e.enrolment_id, file, setFraction)
      setFile(null)
      if (input.current) input.current.value = ''
      onUploaded(res.data)
    } catch (err) {
      const info = parseServerError(err, 'The certificate could not be uploaded.')
      if (info.status === 409) onConflict(info.detail)
      setError(uploadErrorText(info, cfg.limits.max_certificate_mb))
    } finally {
      setUploading(false)
    }
  }

  async function download(c: Certificate) {
    if (dlBusy) return
    setDlBusy(c.certificate_id)
    setDlError(null)
    try {
      const res = await learningApi.certificateBlob(e.enrolment_id, c.certificate_id)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = downloadName(res.headers?.['content-disposition'] as string | undefined, `certificate.${c.content_type === 'application/pdf' ? 'pdf' : c.content_type === 'image/png' ? 'png' : 'jpg'}`)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err) {
      const info = parseServerError(err, 'The certificate could not be downloaded.')
      setDlError(info.status === 404 ? 'The file is not available.' : info.detail)
    } finally {
      setDlBusy(null)
    }
  }

  return (
    <section className="card card-pad" aria-labelledby="certs-title" data-testid="certificates">
      <h2 id="certs-title">Certificates</h2>
      {e.certificates.length === 0 ? (
        <p className="ln-muted" data-testid="no-certificates">
          No certificate has been uploaded.
        </p>
      ) : (
        <ul className="ln-certs" data-testid="certificate-list">
          {e.certificates.map((c) => (
            <li key={c.certificate_id} className="ln-cert" data-testid="certificate-row" data-id={c.certificate_id}>
              <div className="ln-cert-main">
                <span className="ln-cert-name" data-testid="certificate-name">
                  {c.filename}
                </span>
                <span className="ln-sub">
                  {typeLabel(c.content_type)} - {formatBytes(c.size_bytes)} - uploaded {formatDateTime(c.uploaded_at)}
                  {c.is_current ? ' - current' : ''}
                </span>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => download(c)} disabled={dlBusy !== null} data-testid="certificate-download">
                <Download size={16} aria-hidden="true" /> {dlBusy === c.certificate_id ? 'Downloading...' : 'Download'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dlError ? (
        <div data-testid="certificate-download-error">
          <Alert tone="danger">{dlError}</Alert>
        </div>
      ) : null}

      {mayUpload ? (
        <div className="ln-block" data-testid="certificate-upload">
          <label className="ln-label" htmlFor="certificate-file">
            Upload a certificate <span className="ln-opt">(optional)</span>
          </label>
          <input
            id="certificate-file"
            ref={input}
            type="file"
            className="ln-input ln-file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            onChange={(ev) => {
              setFile(ev.target.files?.[0] ?? null)
              setError(null)
            }}
            disabled={uploading}
            data-testid="certificate-input"
          />
          <p className="ln-help" data-testid="certificate-hint">
            {certHint(cfg.certTypes, cfg.limits.max_certificate_mb, cfg.limits.max_certificates_per_enrolment)}
          </p>
          {file ? (
            <p className="ln-help" data-testid="certificate-chosen">
              Selected: {file.name} ({formatBytes(file.size)})
            </p>
          ) : null}
          {uploading ? <ProgressBar value={Math.round(fraction * 100)} label="Upload progress" /> : null}
          {error ? (
            <div data-testid="certificate-error">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
          <div className="ln-actions ln-actions-left">
            <button type="button" className="btn btn-primary" onClick={upload} disabled={!file || uploading} data-testid="certificate-upload-btn">
              <Upload size={16} aria-hidden="true" /> {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
