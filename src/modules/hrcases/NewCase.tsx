import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Send } from 'lucide-react'
import { PageTitle } from '@/pages/PageTitle'
import { Alert } from '@/ui/Feedback'
import { useLoad } from '@/modules/documents/hooks'
import { casesApi, type CasePriority } from './api'
import { ErrorBlock, FieldError, FileField, LoadingCard, Notice, Spinner } from './parts'
import {
  DESCRIPTION_MAX,
  PRIORITIES,
  PRIVACY_NOTE,
  SUBJECT_MAX,
  counter,
  isPriority,
  parseServerError,
  priorityLabel,
  typeHelp,
  uploadErrorText,
  validateNewCase,
} from './logic'
import './hrcases.css'

/** Raise a request: type from the HR catalog, subject, description, optional single attachment. */
export function NewCase() {
  const navigate = useNavigate()
  const types = useLoad(() => casesApi.types().then((r) => r.data.items), [], 'The request types could not be loaded.')
  const [typeId, setTypeId] = useState('')
  const [priority, setPriority] = useState<CasePriority | ''>('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const catalog = (types.data ?? []).filter((t) => t.active)
  const type = catalog.find((t) => t.type_id === typeId) ?? null

  // The priority box follows the chosen type's default until the person picks a priority; a choice is then kept.
  function chooseType(id: string) {
    setTypeId(id)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = validateNewCase({ typeId, subject, description })
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setProgress(0)
    try {
      const res = await casesApi.create({ type_id: typeId, subject: subject.trim(), description: description.trim(), priority: priority || undefined, file }, setProgress)
      navigate(`/hr-requests/cases/${encodeURIComponent(res.data.case_id)}`)
    } catch (err) {
      const info = parseServerError(err)
      const mapped: Record<string, string> = {}
      if (info.fieldErrors.subject) mapped.subject = info.fieldErrors.subject
      if (info.fieldErrors.description) mapped.description = info.fieldErrors.description
      if (info.fieldErrors.type_id) mapped.type = info.fieldErrors.type_id
      setErrors(mapped)
      setServerError(uploadErrorText(err))
      setBusy(false)
    }
  }

  return (
    <div className="page dc-page" data-testid="new-case-page">
      <PageTitle title="New HR request" subtitle="Ask HR for something. You will see their replies on the request." />
      <p className="hc-back">
        <Link to="/hr-requests" className="hc-back-link" data-testid="back-to-requests">
          <ArrowLeft size={16} aria-hidden="true" /> Back to HR Requests
        </Link>
      </p>
      <Notice testId="privacy-note">{PRIVACY_NOTE}</Notice>

      {types.error ? (
        <ErrorBlock message={types.error.detail} onRetry={types.reload} testId="types-error" />
      ) : types.loading && !types.data ? (
        <LoadingCard testId="types-loading" />
      ) : catalog.length === 0 ? (
        <Alert tone="warning">No request types are available right now. Ask HR to set up the request types.</Alert>
      ) : (
        <form className="card card-pad dc-form" onSubmit={submit} noValidate data-testid="new-case-form" aria-label="New HR request">
          <div className="dc-grid-2">
            <div className="dc-field">
              <label className="dc-label" htmlFor="hc-type">
                Request type
              </label>
              <select id="hc-type" className="dc-input" value={typeId} onChange={(e) => chooseType(e.target.value)} disabled={busy} data-testid="case-type-select">
                <option value="">Choose a type...</option>
                {catalog.map((t) => (
                  <option key={t.type_id} value={t.type_id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <FieldError text={errors.type} />
              {type ? (
                <p className="dc-fine" data-testid="case-type-help">
                  {typeHelp(type)}
                </p>
              ) : null}
            </div>
            <div className="dc-field">
              <label className="dc-label" htmlFor="hc-priority">
                Priority <span className="dc-opt">(optional)</span>
              </label>
              <select
                id="hc-priority"
                className="dc-input"
                value={priority || type?.default_priority || 'low'}
                onChange={(e) => isPriority(e.target.value) && setPriority(e.target.value)}
                disabled={busy}
                data-testid="case-priority-select"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </select>
              <p className="dc-fine">The type suggests a default. After you send the request only HR changes the priority.</p>
            </div>
          </div>

          <div className="dc-field">
            <label className="dc-label" htmlFor="hc-subject">
              Subject
            </label>
            <input id="hc-subject" className="dc-input" type="text" maxLength={SUBJECT_MAX} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} autoComplete="off" data-testid="case-subject" />
            <div className="hc-counter">{counter(subject, SUBJECT_MAX)}</div>
            <FieldError text={errors.subject} />
          </div>

          <div className="dc-field">
            <label className="dc-label" htmlFor="hc-description">
              Description
            </label>
            <textarea id="hc-description" className="dc-input dc-textarea" rows={6} maxLength={DESCRIPTION_MAX} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} data-testid="case-description" />
            <div className="hc-counter">{counter(description, DESCRIPTION_MAX)}</div>
            <FieldError text={errors.description} />
          </div>

          <FileField id="hc-file" file={file} onFile={setFile} disabled={busy} label="Attachment (optional, one file)" testId="case-file" />

          {busy ? <Spinner label={file ? `Sending... ${Math.round(progress * 100)}%` : 'Sending...'} /> : null}
          {serverError ? (
            <div data-testid="case-error">
              <Alert tone="danger">{serverError}</Alert>
            </div>
          ) : null}

          <div className="dc-actions">
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="case-submit">
              <Send size={16} aria-hidden="true" /> Send request
            </button>
            <Link to="/hr-requests" className="btn btn-secondary" aria-disabled={busy} data-testid="case-cancel">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  )
}
