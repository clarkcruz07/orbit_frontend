import { useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, Download, FilePlus2, FileText, Pencil } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { documentsApi, type EmployeeDocument } from './api'
import { saveBlob, useLoad } from './hooks'
import { ErrorBlock, ExpiryBadge, FieldError, FileField, LoadingCard, Pill, Spinner } from './parts'
import {
  formatBytes,
  formatDate,
  formatDateTime,
  hasAction,
  isIsoDate,
  parseServerError,
  typeLabel,
  uploadErrorText,
  validateVersion,
  type FieldErrors,
} from './logic'

interface Props {
  doc: EmployeeDocument
  showEmployee: boolean
  /** Called with the fresh document after a new version or a metadata edit. */
  onChanged: (doc: EmployeeDocument) => void
}

export function DocumentRow({ doc, showEmployee, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function download(version?: number, filename?: string) {
    setDownloadError(null)
    setBusy(true)
    try {
      const res = await documentsApi.fileBlob(doc.doc_id, version)
      saveBlob(res.data, filename ?? doc.file.filename)
    } catch (err) {
      setDownloadError(parseServerError(err, 'The file could not be downloaded.').detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="dc-row card" data-testid="doc-row" data-doc-id={doc.doc_id} data-expiry={doc.expiry_state ?? 'none'}>
      <div className="dc-row-main">
        <div className="dc-row-icon" aria-hidden="true">
          <FileText size={22} />
        </div>
        <div className="dc-row-body">
          <div className="dc-row-title">
            <strong data-testid="doc-title">{doc.title}</strong>
            <Pill tone="blue" testId="doc-version">
              Version {doc.version}
            </Pill>
            {doc.type.hr_only ? (
              <Pill tone="violet" title="Visible to HR only">
                HR only
              </Pill>
            ) : null}
          </div>
          <div className="dc-sub" data-testid="doc-type">
            {doc.type.name}
            {showEmployee && doc.employee ? ` - ${doc.employee.name ?? doc.employee_id}${doc.employee.department ? ` (${doc.employee.department})` : ''}` : ''}
          </div>
          <div className="dc-sub">
            {typeLabel(doc.file.content_type)} - {formatBytes(doc.file.size_bytes)} - uploaded {formatDateTime(doc.uploaded_at)} by {doc.uploaded_by.name}
          </div>
          <div className="dc-row-expiry">
            <ExpiryBadge state={doc.expiry_state} daysLeft={doc.days_left} />
            {doc.expires_on ? <span className="dc-sub dc-expiry-date">Expires {formatDate(doc.expires_on)}</span> : null}
          </div>
        </div>
        <div className="dc-row-actions">
          {hasAction(doc.allowed_actions, 'download') ? (
            <button type="button" className="btn btn-secondary" onClick={() => void download()} disabled={busy} data-testid="doc-download">
              <Download size={16} aria-hidden="true" /> Download
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="doc-details">
            {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />} {open ? 'Hide details' : 'Details'}
          </button>
        </div>
      </div>
      {downloadError ? (
        <div className="dc-row-alert" data-testid="doc-download-error">
          <Alert tone="danger">{downloadError}</Alert>
        </div>
      ) : null}
      {open ? <DocumentDetail doc={doc} onChanged={onChanged} onDownloadVersion={(v, name) => void download(v, name)} /> : null}
    </li>
  )
}

function DocumentDetail({ doc, onChanged, onDownloadVersion }: { doc: EmployeeDocument; onChanged: (d: EmployeeDocument) => void; onDownloadVersion: (v: number, filename: string) => void }) {
  const detail = useLoad(() => documentsApi.get(doc.doc_id).then((r) => r.data), [doc.doc_id, doc.version, doc.updated_at], 'The version history could not be loaded.')
  const [mode, setMode] = useState<null | 'version' | 'edit'>(null)
  const current = detail.data ?? doc
  const canAdd = hasAction(current.allowed_actions, 'add_version')
  const canEdit = hasAction(current.allowed_actions, 'edit')

  function changed(next: EmployeeDocument) {
    detail.setData(next)
    onChanged(next)
    setMode(null)
  }

  /** A save was refused as stale (409): fetch the latest document so the list row and the forms agree with the server. */
  async function refresh() {
    try {
      const r = await documentsApi.get(doc.doc_id)
      detail.setData(r.data)
      onChanged(r.data)
    } catch {
      detail.reload()
    }
  }

  return (
    <div className="dc-detail" data-testid="doc-detail">
      {detail.loading && !detail.data ? <LoadingCard testId="detail-loading" /> : null}
      {detail.error ? <ErrorBlock message={detail.error.detail} onRetry={detail.reload} testId="detail-error" /> : null}

      {detail.data ? (
        <section aria-label="Version history">
          <h3 className="dc-h3">Version history</h3>
          <ol className="dc-versions" data-testid="version-list">
            {(detail.data.versions ?? []).map((v) => (
              <li key={v.version} className="dc-version" data-testid="version-row" data-version={v.version}>
                <div className="dc-version-main">
                  <strong>Version {v.version}</strong> <Pill tone={v.status === 'active' ? 'green' : 'neutral'}>{v.status === 'active' ? 'Current' : 'Superseded'}</Pill>
                  <div className="dc-sub">
                    {v.file.filename} - {typeLabel(v.file.content_type)} - {formatBytes(v.file.size_bytes)}
                  </div>
                  <div className="dc-sub">
                    Uploaded {formatDateTime(v.uploaded_at)} by {v.uploaded_by.name}
                    {v.expires_on ? ` - expires ${formatDate(v.expires_on)}` : ' - no expiry date'}
                  </div>
                </div>
                {hasAction(current.allowed_actions, 'download') ? (
                  <button type="button" className="btn btn-secondary" onClick={() => onDownloadVersion(v.version, v.file.filename)} data-testid={`version-download-${v.version}`}>
                    <Download size={16} aria-hidden="true" /> Download v{v.version}
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="dc-fine">Replacing a document adds a new version. Earlier files are kept and never overwritten.</p>
        </section>
      ) : null}

      {canAdd || canEdit ? (
        <div className="dc-actions">
          {canAdd ? (
            <button type="button" className="btn btn-secondary" onClick={() => setMode(mode === 'version' ? null : 'version')} aria-expanded={mode === 'version'} data-testid="doc-new-version">
              <FilePlus2 size={16} aria-hidden="true" /> Upload new version
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className="btn btn-secondary" onClick={() => setMode(mode === 'edit' ? null : 'edit')} aria-expanded={mode === 'edit'} data-testid="doc-edit">
              <Pencil size={16} aria-hidden="true" /> Edit title or expiry
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'version' && canAdd ? <NewVersionForm doc={current} onDone={changed} onStale={() => void refresh()} onCancel={() => setMode(null)} /> : null}
      {mode === 'edit' && canEdit ? <EditForm doc={current} onDone={changed} onStale={() => void refresh()} onCancel={() => setMode(null)} /> : null}
    </div>
  )
}

function NewVersionForm({ doc, onDone, onStale, onCancel }: { doc: EmployeeDocument; onDone: (d: EmployeeDocument) => void; onStale: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [expiresOn, setExpiresOn] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = validateVersion({ expiresOn, expiryRequired: doc.type.expiry_required, file })
    setErrors(found)
    if (Object.keys(found).length || !file) return
    setBusy(true)
    try {
      const res = await documentsApi.addVersion(doc.doc_id, { file, expires_on: expiresOn || undefined, expected_version: doc.version })
      onDone(res.data)
    } catch (err) {
      const info = parseServerError(err)
      if (info.status === 409) {
        setServerError('This document was changed by someone else. The latest version has been reloaded; please try again.')
        onStale()
      } else setServerError(uploadErrorText(err))
      setBusy(false)
    }
  }

  return (
    <form className="dc-subform" onSubmit={submit} noValidate data-testid="version-form" aria-label="Upload a new version">
      <h3 className="dc-h3">New version (version {doc.version + 1})</h3>
      <p className="dc-fine">The new version does not inherit the old expiry date. The earlier file stays available in the history.</p>
      <div className="dc-field dc-field-narrow">
        <label className="dc-label" htmlFor={`dc-ver-exp-${doc.doc_id}`}>
          Expiry date {doc.type.expiry_required ? <strong className="dc-req">(required for this type)</strong> : <span className="dc-opt">(optional)</span>}
        </label>
        <input id={`dc-ver-exp-${doc.doc_id}`} className="dc-input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} disabled={busy} data-testid="version-expiry" />
        <FieldError text={errors.expires_on} />
      </div>
      <FileField id={`dc-ver-file-${doc.doc_id}`} file={file} onFile={setFile} error={errors.file} disabled={busy} label="New file" testId="version-file" />
      {busy ? <Spinner label="Uploading..." /> : null}
      {serverError ? (
        <div data-testid="version-error">
          <Alert tone="danger">{serverError}</Alert>
        </div>
      ) : null}
      <div className="dc-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="version-submit">
          Upload version
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function EditForm({ doc, onDone, onStale, onCancel }: { doc: EmployeeDocument; onDone: (d: EmployeeDocument) => void; onStale: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(doc.title)
  const [expiresOn, setExpiresOn] = useState(doc.expires_on ?? '')
  const [clear, setClear] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found: FieldErrors = {}
    const t = title.trim()
    if (!t) found.title = 'Enter a title.'
    else if (t.length > 120) found.title = 'The title can be at most 120 characters.'
    if (!clear && expiresOn && !isIsoDate(expiresOn)) found.expires_on = 'Enter a valid expiry date.'
    setErrors(found)
    if (Object.keys(found).length) return
    const body: { title?: string; expires_on?: string; clear_expiry?: boolean; version: number } = { version: doc.version }
    if (t !== doc.title) body.title = t
    if (clear) body.clear_expiry = true
    else if (expiresOn && expiresOn !== doc.expires_on) body.expires_on = expiresOn
    if (body.title === undefined && body.expires_on === undefined && !body.clear_expiry) {
      setServerError('Nothing was changed.')
      return
    }
    setBusy(true)
    try {
      const res = await documentsApi.update(doc.doc_id, body)
      onDone(res.data)
    } catch (err) {
      const info = parseServerError(err, 'The change could not be saved.')
      if (info.status === 409) {
        setServerError('This document was changed by someone else. The latest values have been reloaded; please try again.')
        onStale()
      } else setServerError(info.detail)
      setBusy(false)
    }
  }

  return (
    <form className="dc-subform" onSubmit={submit} noValidate data-testid="edit-form" aria-label="Edit title or expiry">
      <h3 className="dc-h3">Edit the current version</h3>
      <p className="dc-fine">Only the title and the expiry date of the current version can be edited. The file itself is never changed - upload a new version instead.</p>
      <div className="dc-field">
        <label className="dc-label" htmlFor={`dc-edit-title-${doc.doc_id}`}>
          Title
        </label>
        <input id={`dc-edit-title-${doc.doc_id}`} className="dc-input" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} data-testid="edit-title" />
        <FieldError text={errors.title} />
      </div>
      <div className="dc-field dc-field-narrow">
        <label className="dc-label" htmlFor={`dc-edit-exp-${doc.doc_id}`}>
          Expiry date
        </label>
        <input id={`dc-edit-exp-${doc.doc_id}`} className="dc-input" type="date" value={clear ? '' : expiresOn} onChange={(e) => setExpiresOn(e.target.value)} disabled={busy || clear} data-testid="edit-expiry" />
        <FieldError text={errors.expires_on} />
      </div>
      {!doc.type.expiry_required && doc.expires_on ? (
        <label className="dc-check">
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} disabled={busy} data-testid="edit-clear-expiry" /> Remove the expiry date
        </label>
      ) : null}
      {serverError ? (
        <div data-testid="edit-error">
          <Alert tone="danger">{serverError}</Alert>
        </div>
      ) : null}
      <div className="dc-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="edit-submit">
          Save changes
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}
