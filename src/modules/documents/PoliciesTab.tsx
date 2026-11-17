import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, ChevronDown, ChevronUp, Download, ScrollText } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { Alert } from '@/ui/Feedback'
import { documentsApi, type PolicySummary } from './api'
import { saveBlob, useLoad } from './hooks'
import { ErrorBlock, LoadingCard, Pill, Spinner } from './parts'
import { formatBytes, formatDate, formatDateTime, hasAction, parseServerError, typeLabel } from './logic'

export function PoliciesTab({ highlightId }: { highlightId?: string }) {
  const list = useLoad(() => documentsApi.policies().then((r) => r.data.items), [], 'The policies could not be loaded.')
  const items = list.data ?? []
  const missing = Boolean(highlightId) && !list.loading && !list.error && !items.some((p) => p.policy_id === highlightId)

  function patch(next: PolicySummary) {
    list.setData((prev) => (prev ? prev.map((p) => (p.policy_id === next.policy_id ? { ...p, ...next } : p)) : prev))
  }

  return (
    <div data-testid="policies-tab">
      <p className="dc-fine dc-lead">
        Company policies for everyone to read. When a new version is published you are asked to acknowledge it again. An acknowledgement is recorded with its date and cannot be changed.
      </p>
      {missing ? (
        <div data-testid="policy-missing">
          <Alert tone="warning">That policy could not be found. It may have been removed or you may not have access to it.</Alert>
        </div>
      ) : null}
      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} testId="policies-error" />
      ) : list.loading && !list.data ? (
        <LoadingCard testId="policies-loading" />
      ) : items.length === 0 ? (
        <EmptyState icon={<ScrollText size={28} />} title="No policies published yet" body="Company policies appear here once HR publishes them." />
      ) : (
        <ul className="dc-list" data-testid="policy-rows">
          {items.map((p) => (
            <PolicyCard key={p.policy_id} policy={p} highlighted={p.policy_id === highlightId} onChanged={patch} onStale={list.reload} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PolicyCard({ policy, highlighted, onChanged, onStale }: { policy: PolicySummary; highlighted: boolean; onChanged: (p: PolicySummary) => void; onStale: () => void }) {
  const ref = useRef<HTMLLIElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  const canDownload = hasAction(policy.allowed_actions, 'download')
  const canAck = hasAction(policy.allowed_actions, 'acknowledge') && !policy.acknowledged
  const canHistory = hasAction(policy.allowed_actions, 'publish_version')

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView?.({ block: 'center' })
  }, [highlighted])

  async function download(version?: number, filename?: string) {
    setError(null)
    try {
      const res = await documentsApi.policyBlob(policy.policy_id, version)
      saveBlob(res.data, filename ?? policy.file.filename)
    } catch (err) {
      setError(parseServerError(err, 'The file could not be downloaded.').detail)
    }
  }

  async function acknowledge() {
    setBusy(true)
    setError(null)
    try {
      await documentsApi.acknowledge(policy.policy_id, policy.version)
      const fresh = await documentsApi.policy(policy.policy_id)
      onChanged(fresh.data)
      setConfirming(false)
    } catch (err) {
      const info = parseServerError(err, 'The acknowledgement could not be saved.')
      if (info.status === 409) {
        setError('A newer version of this policy was published. Please read the new version, then acknowledge it.')
        setConfirming(false)
        onStale()
      } else setError(info.detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li ref={ref} className={`dc-row dc-policy card${highlighted ? ' dc-highlight' : ''}`} data-testid="policy-row" data-policy-id={policy.policy_id} data-acknowledged={policy.acknowledged ? 'yes' : 'no'}>
      <div className="dc-row-main">
        <div className="dc-row-icon" aria-hidden="true">
          <ScrollText size={22} />
        </div>
        <div className="dc-row-body">
          <div className="dc-row-title">
            <strong data-testid="policy-title">{policy.title}</strong>
            <Pill tone="blue" testId="policy-version">
              Version {policy.version}
            </Pill>
            {policy.acknowledged ? (
              <Pill tone="green" testId="policy-ack-pill">
                <BadgeCheck size={13} aria-hidden="true" /> Acknowledged {policy.acknowledged_at ? formatDate(policy.acknowledged_at.slice(0, 10)) : ''}
              </Pill>
            ) : (
              <Pill tone="amber" testId="policy-ack-pill">
                Not acknowledged
              </Pill>
            )}
          </div>
          {policy.summary ? <p className="dc-policy-summary" data-testid="policy-summary">{policy.summary}</p> : null}
          <div className="dc-sub">
            Effective {formatDate(policy.effective_date)} - published {formatDate(policy.published_at.slice(0, 10))} - {typeLabel(policy.file.content_type)}, {formatBytes(policy.file.size_bytes)}
          </div>
          {policy.acknowledged && policy.acknowledged_at ? (
            <div className="dc-sub" data-testid="policy-ack-at">
              You acknowledged version {policy.version} on {formatDateTime(policy.acknowledged_at)}. This cannot be changed.
            </div>
          ) : null}
        </div>
        <div className="dc-row-actions">
          {canDownload ? (
            <button type="button" className="btn btn-secondary" onClick={() => void download()} data-testid="policy-download">
              <Download size={16} aria-hidden="true" /> Download
            </button>
          ) : null}
          {canAck ? (
            <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={confirming} data-testid="policy-acknowledge">
              <BadgeCheck size={16} aria-hidden="true" /> Acknowledge
            </button>
          ) : null}
          {canHistory ? (
            <button type="button" className="btn btn-secondary" onClick={() => setShowVersions((v) => !v)} aria-expanded={showVersions} data-testid="policy-versions-toggle">
              {showVersions ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />} Versions
            </button>
          ) : null}
        </div>
      </div>

      {confirming ? (
        <div className="dc-confirm" data-testid="ack-confirm-box" role="group" aria-label="Confirm acknowledgement">
          <p>
            I have read version {policy.version} of <strong>{policy.title}</strong>. This is recorded with today&apos;s date and cannot be changed or removed.
          </p>
          <div className="dc-actions">
            <button type="button" className="btn btn-primary" onClick={() => void acknowledge()} disabled={busy} data-testid="ack-confirm">
              Confirm acknowledgement
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
            {busy ? <Spinner label="Saving..." /> : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="dc-row-alert" data-testid="policy-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      {showVersions && canHistory ? <PolicyVersions policy={policy} onDownload={(v, name) => void download(v, name)} /> : null}
    </li>
  )
}

function PolicyVersions({ policy, onDownload }: { policy: PolicySummary; onDownload: (version: number, filename: string) => void }) {
  const detail = useLoad(() => documentsApi.policy(policy.policy_id).then((r) => r.data), [policy.policy_id, policy.version], 'The version history could not be loaded.')
  return (
    <div className="dc-detail" data-testid="policy-versions">
      {detail.loading && !detail.data ? <LoadingCard testId="versions-loading" /> : null}
      {detail.error ? <ErrorBlock message={detail.error.detail} onRetry={detail.reload} testId="versions-error" /> : null}
      {detail.data ? (
        <ol className="dc-versions">
          {(detail.data.versions ?? []).map((v) => (
            <li key={v.version} className="dc-version" data-testid="policy-version-row" data-version={v.version}>
              <div className="dc-version-main">
                <strong>
                  Version {v.version} - {v.title}
                </strong>{' '}
                <Pill tone={v.status === 'active' ? 'green' : 'neutral'}>{v.status === 'active' ? 'Current' : 'Superseded'}</Pill>
                <div className="dc-sub">
                  Effective {formatDate(v.effective_date)} - published {formatDateTime(v.published_at)}
                  {v.published_by ? ` by ${v.published_by.name}` : ''}
                </div>
                <div className="dc-sub">
                  {v.file.filename} - {typeLabel(v.file.content_type)} - {formatBytes(v.file.size_bytes)}
                </div>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => onDownload(v.version, v.file.filename)} data-testid={`policy-version-download-${v.version}`}>
                <Download size={16} aria-hidden="true" /> Download v{v.version}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
