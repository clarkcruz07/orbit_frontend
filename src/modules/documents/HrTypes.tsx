import { useState, type FormEvent } from 'react'
import { Plus, Tags } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { Alert } from '@/ui/Feedback'
import { documentsApi, type DocumentType } from './api'
import { useLoad } from './hooks'
import { ErrorBlock, FieldError, LoadingCard, Notice, Pill } from './parts'
import { parseServerError, validateTypeName } from './logic'

/** HR: the document-type catalog (editable). Types in use are deactivated, never deleted. */
export function HrTypes() {
  const list = useLoad(() => documentsApi.types(true).then((r) => r.data.items), [], 'The document types could not be loaded.')
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const items = list.data ?? []

  return (
    <div data-testid="hr-types">
      <Notice tone="info" testId="types-note">
        HR can add, change or deactivate them. A deactivated type cannot be chosen for new documents, but existing documents stay readable.
      </Notice>
      <div className="dc-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => { setCreating((v) => !v); setMessage(null) }} aria-expanded={creating} data-testid="type-new-open">
          <Plus size={16} aria-hidden="true" /> Add a type
        </button>
      </div>
      {message ? (
        <div data-testid="types-message">
          <Alert tone="info">{message}</Alert>
        </div>
      ) : null}
      {creating ? (
        <TypeForm
          onCancel={() => setCreating(false)}
          onDone={(t) => {
            setCreating(false)
            setMessage(`Added "${t.name}".`)
            list.reload()
          }}
        />
      ) : null}
      {list.error ? (
        <ErrorBlock message={list.error.status === 403 ? 'The catalog is for HR only.' : list.error.detail} onRetry={list.reload} testId="types-error" />
      ) : list.loading && !list.data ? (
        <LoadingCard testId="types-loading" />
      ) : items.length === 0 ? (
        <EmptyState icon={<Tags size={28} />} title="No document types" body="Add a type before anyone can upload a document." />
      ) : (
        <ul className="dc-list" data-testid="type-rows">
          {items.map((t) => (
            <TypeRow
              key={t.type_id}
              type={t}
              onChanged={(msg) => {
                setMessage(msg)
                list.reload()
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function TypeRow({ type, onChanged }: { type: DocumentType; onChanged: (message: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggleActive() {
    setBusy(true)
    setError(null)
    try {
      await documentsApi.updateType(type.type_id, { active: !type.active })
      onChanged(`${type.active ? 'Deactivated' : 'Activated'} "${type.name}".`)
    } catch (err) {
      setError(parseServerError(err, 'The type could not be changed.').detail)
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await documentsApi.deleteType(type.type_id)
      onChanged(`Deleted "${type.name}".`)
    } catch (err) {
      const info = parseServerError(err, 'The type could not be deleted.')
      setError(info.status === 409 ? 'This type is used by documents and cannot be deleted. Deactivate it instead.' : info.detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="dc-row card" data-testid="type-row" data-type-id={type.type_id} data-active={type.active ? 'yes' : 'no'}>
      <div className="dc-row-main">
        <div className="dc-row-body">
          <div className="dc-row-title">
            <strong data-testid="type-name">{type.name}</strong>
            {type.expiry_required ? <Pill tone="amber">Expiry required</Pill> : null}
            {type.hr_only ? <Pill tone="violet">HR only</Pill> : null}
            {!type.active ? <Pill tone="neutral">Inactive</Pill> : null}
          </div>
          <div className="dc-sub">{type.description || 'No description.'}</div>
        </div>
        <div className="dc-row-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing((v) => !v)} aria-expanded={editing} disabled={busy} data-testid="type-edit">
            Edit
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void toggleActive()} disabled={busy} data-testid="type-toggle">
            {type.active ? 'Deactivate' : 'Activate'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void remove()} disabled={busy} data-testid="type-delete">
            Delete
          </button>
        </div>
      </div>
      {error ? (
        <div className="dc-row-alert" data-testid="type-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      {editing ? (
        <div className="dc-detail">
          <TypeForm
            type={type}
            onCancel={() => setEditing(false)}
            onDone={(t) => {
              setEditing(false)
              onChanged(`Saved "${t.name}".`)
            }}
          />
        </div>
      ) : null}
    </li>
  )
}

function TypeForm({ type, onDone, onCancel }: { type?: DocumentType; onDone: (t: DocumentType) => void; onCancel: () => void }) {
  const [name, setName] = useState(type?.name ?? '')
  const [description, setDescription] = useState(type?.description ?? '')
  const [expiryRequired, setExpiryRequired] = useState(type?.expiry_required ?? false)
  const [hrOnly, setHrOnly] = useState(type?.hr_only ?? false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = type?.type_id ?? 'new'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const problem = validateTypeName(name)
    setNameError(problem)
    if (problem) return
    setBusy(true)
    try {
      const body = { name: name.trim(), description: description.trim(), expiry_required: expiryRequired, hr_only: hrOnly }
      const res = type ? await documentsApi.updateType(type.type_id, body) : await documentsApi.createType(body)
      onDone(res.data)
    } catch (err) {
      const info = parseServerError(err, 'The type could not be saved.')
      setServerError(info.status === 409 ? 'A type with this name already exists.' : info.detail)
      setBusy(false)
    }
  }

  return (
    <form className="card card-pad dc-form" onSubmit={submit} noValidate data-testid="type-form" aria-label={type ? 'Edit document type' : 'Add document type'}>
      <h2>{type ? `Edit ${type.name}` : 'Add a document type'}</h2>
      <div className="dc-field">
        <label className="dc-label" htmlFor={`dc-type-name-${id}`}>
          Name
        </label>
        <input id={`dc-type-name-${id}`} className="dc-input" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} data-testid="type-name-input" autoComplete="off" />
        <FieldError text={nameError ?? undefined} />
      </div>
      <div className="dc-field">
        <label className="dc-label" htmlFor={`dc-type-desc-${id}`}>
          Description <span className="dc-opt">(optional)</span>
        </label>
        <input id={`dc-type-desc-${id}`} className="dc-input" type="text" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} data-testid="type-desc-input" />
      </div>
      <label className="dc-check">
        <input type="checkbox" checked={expiryRequired} onChange={(e) => setExpiryRequired(e.target.checked)} disabled={busy} data-testid="type-expiry-input" /> Documents of this type need an expiry date
      </label>
      <label className="dc-check">
        <input type="checkbox" checked={hrOnly} onChange={(e) => setHrOnly(e.target.checked)} disabled={busy} data-testid="type-hronly-input" /> HR only (hidden from the employee as well)
      </label>
      {serverError ? (
        <div data-testid="type-form-error">
          <Alert tone="danger">{serverError}</Alert>
        </div>
      ) : null}
      <div className="dc-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="type-submit">
          Save
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}
