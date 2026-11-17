import { useState, type FormEvent } from 'react'
import { FilePlus2, ScrollText } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { Alert } from '@/ui/Feedback'
import { documentsApi, type PolicySummary } from './api'
import { useLoad } from './hooks'
import { ErrorBlock, FieldError, FileField, LoadingCard, Notice, Pill, Spinner } from './parts'
import { formatDate, parseServerError, uploadErrorText, validatePolicy, type FieldErrors } from './logic'

/** HR: publish a policy (version 1) or a new version of an existing one (the old version is kept, everyone acknowledges again). */
export function HrPublish() {
  const list = useLoad(() => documentsApi.policies().then((r) => r.data.items), [], 'The policies could not be loaded.')
  const [creating, setCreating] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const items = list.data ?? []

  return (
    <div data-testid="hr-publish">
      <Notice tone="info" testId="publish-note">
        Publishing a policy notifies every employee with an account. A new version replaces the current one for readers, keeps the old version in the history and asks everyone to acknowledge again. Policy content is set by HR - nothing here is company policy.
      </Notice>
      <div className="dc-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => { setCreating((v) => !v); setDone(null) }} aria-expanded={creating} data-testid="policy-new-open">
          <FilePlus2 size={16} aria-hidden="true" /> Publish a new policy
        </button>
      </div>
      {done ? (
        <div data-testid="publish-done">
          <Alert tone="info">{done}</Alert>
        </div>
      ) : null}
      {creating ? (
        <PolicyForm
          mode="new"
          onCancel={() => setCreating(false)}
          onDone={(p) => {
            setCreating(false)
            setDone(`Published "${p.title}" (version ${p.version}).`)
            list.reload()
          }}
        />
      ) : null}

      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} testId="publish-error" />
      ) : list.loading && !list.data ? (
        <LoadingCard testId="publish-loading" />
      ) : items.length === 0 ? (
        <EmptyState icon={<ScrollText size={28} />} title="No policies published yet" body="Publish the first policy with the button above." />
      ) : (
        <ul className="dc-list" data-testid="publish-rows">
          {items.map((p) => (
            <PublishRow
              key={p.policy_id}
              policy={p}
              onPublished={(n) => {
                setDone(`Published version ${n.version} of "${n.title}". Everyone must acknowledge it again.`)
                list.reload()
              }}
              onStale={list.reload}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function PublishRow({ policy, onPublished, onStale }: { policy: PolicySummary; onPublished: (p: PolicySummary) => void; onStale: () => void }) {
  const [open, setOpen] = useState(false)
  const canPublish = policy.allowed_actions.includes('publish_version')
  return (
    <li className="dc-row card" data-testid="publish-row" data-policy-id={policy.policy_id}>
      <div className="dc-row-main">
        <div className="dc-row-icon" aria-hidden="true">
          <ScrollText size={22} />
        </div>
        <div className="dc-row-body">
          <div className="dc-row-title">
            <strong>{policy.title}</strong>
            <Pill tone="blue">Version {policy.version}</Pill>
          </div>
          <div className="dc-sub">
            Effective {formatDate(policy.effective_date)} - {policy.version_count} version{policy.version_count === 1 ? '' : 's'}
            {policy.published_by ? ` - published by ${policy.published_by.name}` : ''}
          </div>
        </div>
        {canPublish ? (
          <div className="dc-row-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="policy-new-version-open">
              <FilePlus2 size={16} aria-hidden="true" /> Publish new version
            </button>
          </div>
        ) : null}
      </div>
      {open && canPublish ? (
        <div className="dc-detail">
          <PolicyForm
            mode="version"
            policy={policy}
            onCancel={() => setOpen(false)}
            onStale={onStale}
            onDone={(p) => {
              setOpen(false)
              onPublished(p)
            }}
          />
        </div>
      ) : null}
    </li>
  )
}

function PolicyForm({
  mode,
  policy,
  onDone,
  onCancel,
  onStale,
}: {
  mode: 'new' | 'version'
  policy?: PolicySummary
  onDone: (p: PolicySummary) => void
  onCancel: () => void
  onStale?: () => void
}) {
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isVersion = mode === 'version' && policy

  async function submit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    const found = validatePolicy({ title, summary, effectiveDate, file, titleOptional: Boolean(isVersion) })
    setErrors(found)
    if (Object.keys(found).length || !file) return
    setBusy(true)
    try {
      const res =
        isVersion && policy
          ? await documentsApi.publishVersion(policy.policy_id, {
              title: title.trim() || undefined,
              summary: summary.trim() || undefined,
              effective_date: effectiveDate,
              file,
              expected_version: policy.version,
            })
          : await documentsApi.publishPolicy({ title: title.trim(), summary: summary.trim() || undefined, effective_date: effectiveDate, file })
      onDone(res.data)
    } catch (err) {
      const info = parseServerError(err)
      if (info.status === 409) {
        setServerError('This policy was changed by someone else. The latest version has been reloaded; please check it and publish again.')
        onStale?.()
      } else setServerError(uploadErrorText(err))
      setBusy(false)
    }
  }

  const pid = policy?.policy_id ?? 'new'
  return (
    <form className="card card-pad dc-form" onSubmit={submit} noValidate data-testid={isVersion ? 'policy-version-form' : 'policy-form'} aria-label={isVersion ? 'Publish a new version' : 'Publish a policy'}>
      <h2>{isVersion && policy ? `New version of ${policy.title} (version ${policy.version + 1})` : 'Publish a new policy'}</h2>
      <div className="dc-grid-2">
        <div className="dc-field">
          <label className="dc-label" htmlFor={`dc-pol-title-${pid}`}>
            Title {isVersion ? <span className="dc-opt">(optional - keeps the current title)</span> : null}
          </label>
          <input id={`dc-pol-title-${pid}`} className="dc-input" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} data-testid="policy-title-input" autoComplete="off" />
          <FieldError text={errors.title} />
        </div>
        <div className="dc-field">
          <label className="dc-label" htmlFor={`dc-pol-eff-${pid}`}>
            Effective date
          </label>
          <input id={`dc-pol-eff-${pid}`} className="dc-input" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} disabled={busy} data-testid="policy-effective-input" />
          <FieldError text={errors.effective_date} />
        </div>
      </div>
      <div className="dc-field">
        <label className="dc-label" htmlFor={`dc-pol-sum-${pid}`}>
          Summary <span className="dc-opt">(optional, up to 1000 characters)</span>
        </label>
        <textarea id={`dc-pol-sum-${pid}`} className="dc-input dc-textarea" rows={3} maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} disabled={busy} data-testid="policy-summary-input" />
        <FieldError text={errors.summary} />
      </div>
      <FileField id={`dc-pol-file-${pid}`} file={file} onFile={setFile} error={errors.file} disabled={busy} label="Policy file" testId="policy-file" />
      {busy ? <Spinner label="Publishing..." /> : null}
      {serverError ? (
        <div data-testid="policy-form-error">
          <Alert tone="danger">{serverError}</Alert>
        </div>
      ) : null}
      <div className="dc-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="policy-publish-submit">
          Publish
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}
