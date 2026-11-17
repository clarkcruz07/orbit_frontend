import { useState, type FormEvent } from 'react'
import { UploadCloud } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { documentsApi, type DocumentType, type EmployeeDocument } from './api'
import { FieldError, FileField, Spinner } from './parts'
import { parseServerError, uploadErrorText, validateUpload, type FieldErrors } from './logic'

interface Props {
  types: DocumentType[]
  /** HR uploading for someone else. Omitted = for yourself. */
  employee?: { employee_id: string; name: string } | null
  onCreated: (doc: EmployeeDocument) => void
  onCancel: () => void
}

/** New document (version 1). Client checks are friendly pre-checks; the server validates everything for real. */
export function UploadForm({ types, employee, onCreated, onCancel }: Props) {
  const active = types.filter((t) => t.active)
  const [typeId, setTypeId] = useState('')
  const [title, setTitle] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const type = active.find((t) => t.type_id === typeId) ?? null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = validateUpload({ typeId, title, expiresOn, expiryRequired: Boolean(type?.expiry_required), file })
    setErrors(found)
    if (Object.keys(found).length || !file) return
    setBusy(true)
    setProgress(0)
    try {
      const res = await documentsApi.create(
        { type_id: typeId, title: title.trim(), file, expires_on: expiresOn || undefined, employee_id: employee?.employee_id },
        setProgress,
      )
      onCreated(res.data)
    } catch (err) {
      const info = parseServerError(err)
      const mapped: FieldErrors = {}
      if (info.fieldErrors.title) mapped.title = info.fieldErrors.title
      if (info.fieldErrors.expires_on) mapped.expires_on = info.fieldErrors.expires_on
      if (info.fieldErrors.type_id) mapped.type = info.fieldErrors.type_id
      setErrors(mapped)
      setServerError(uploadErrorText(err))
      setBusy(false)
    }
  }

  return (
    <form className="card card-pad dc-form" onSubmit={submit} noValidate data-testid="upload-form" aria-labelledby="dc-upload-h">
      <h2 id="dc-upload-h">{employee ? `Upload a document for ${employee.name}` : 'Upload a document'}</h2>
      {employee ? <p className="dc-fine">You are uploading on behalf of this person. They will see it unless its type is HR only.</p> : null}

      <div className="dc-grid-2">
        <div className="dc-field">
          <label className="dc-label" htmlFor="dc-up-type">
            Type
          </label>
          <select id="dc-up-type" className="dc-input" value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={busy} data-testid="upload-type">
            <option value="">Choose a type...</option>
            {active.map((t) => (
              <option key={t.type_id} value={t.type_id}>
                {t.name}
                {t.expiry_required ? ' (expiry required)' : ''}
                {t.hr_only ? ' (HR only)' : ''}
              </option>
            ))}
          </select>
          <FieldError text={errors.type} />
          {type ? (
            <p className="dc-fine" data-testid="upload-type-help">
              {type.description || 'No description.'}
            </p>
          ) : null}
        </div>

        <div className="dc-field">
          <label className="dc-label" htmlFor="dc-up-title">
            Title
          </label>
          <input
            id="dc-up-title"
            className="dc-input"
            type="text"
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            autoComplete="off"
            data-testid="upload-title"
          />
          <FieldError text={errors.title} />
        </div>
      </div>

      <div className="dc-field dc-field-narrow">
        <label className="dc-label" htmlFor="dc-up-expiry">
          Expiry date {type?.expiry_required ? <strong className="dc-req">(required for this type)</strong> : <span className="dc-opt">(optional)</span>}
        </label>
        <input
          id="dc-up-expiry"
          className="dc-input"
          type="date"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
          disabled={busy}
          data-testid="upload-expiry"
        />
        <FieldError text={errors.expires_on} />
      </div>

      <FileField id="dc-up-file" file={file} onFile={setFile} error={errors.file} disabled={busy} />

      {busy ? (
        <div data-testid="upload-status">
          <Spinner label={`Uploading... ${Math.round(progress * 100)}%`} />
        </div>
      ) : null}
      {serverError ? (
        <div data-testid="upload-error">
          <Alert tone="danger">{serverError}</Alert>
        </div>
      ) : null}

      <div className="dc-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="upload-submit">
          <UploadCloud size={16} aria-hidden="true" /> Upload
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="upload-cancel">
          Cancel
        </button>
      </div>
    </form>
  )
}
