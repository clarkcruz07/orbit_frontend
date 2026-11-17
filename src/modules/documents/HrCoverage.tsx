import { useState } from 'react'
import { ListChecks, Users } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { documentsApi } from './api'
import { useLoad } from './hooks'
import { ErrorBlock, LoadingCard, Pill } from './parts'
import { formatDateTime, formatPct } from './logic'

/** HR: acknowledgement coverage per policy (counts) and, on request, who has and has not acknowledged (names are HR-only). */
export function HrCoverage() {
  const overview = useLoad(() => documentsApi.coverage().then((r) => r.data), [], 'The coverage figures could not be loaded.')
  const [openId, setOpenId] = useState<string | null>(null)
  const data = overview.data

  return (
    <div data-testid="hr-coverage">
      {overview.error ? (
        <ErrorBlock message={overview.error.status === 403 ? 'Coverage is for HR only.' : overview.error.detail} onRetry={overview.reload} testId="coverage-error" />
      ) : overview.loading && !data ? (
        <LoadingCard testId="coverage-loading" />
      ) : !data || data.policies.length === 0 ? (
        <EmptyState icon={<ListChecks size={28} />} title="No policies to measure" body="Coverage appears here once a policy is published." />
      ) : (
        <>
          <section className="card card-pad dc-cov-summary" aria-label="Overall coverage">
            <div>
              <div className="dc-cov-number" data-testid="coverage-overall">
                {formatPct(data.overall_pct)}
              </div>
              <div className="dc-sub">of current policy acknowledgements are done</div>
            </div>
            <div className="dc-sub" data-testid="coverage-eligible">
              <Users size={14} aria-hidden="true" /> {data.eligible_count} eligible employee{data.eligible_count === 1 ? '' : 's'} (active, with a sign-in account)
            </div>
          </section>
          <ul className="dc-list" data-testid="coverage-rows">
            {data.policies.map((p) => (
              <li key={p.policy_id} className="dc-row card" data-testid="coverage-row" data-policy-id={p.policy_id}>
                <div className="dc-row-main">
                  <div className="dc-row-body">
                    <div className="dc-row-title">
                      <strong>{p.title}</strong>
                      <Pill tone="blue">Version {p.version}</Pill>
                    </div>
                    <div className="dc-sub" data-testid="coverage-counts">
                      {p.acknowledged_count} acknowledged - {p.outstanding_count} outstanding - {formatPct(p.pct)}
                    </div>
                    <div className="dc-meter" role="img" aria-label={`${formatPct(p.pct)} acknowledged`}>
                      <span style={{ width: `${Math.max(0, Math.min(100, p.pct ?? 0))}%` }} />
                    </div>
                  </div>
                  <div className="dc-row-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setOpenId(openId === p.policy_id ? null : p.policy_id)} aria-expanded={openId === p.policy_id} data-testid="coverage-names">
                      {openId === p.policy_id ? 'Hide names' : 'Show names'}
                    </button>
                  </div>
                </div>
                {openId === p.policy_id ? <CoverageDetail policyId={p.policy_id} /> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function CoverageDetail({ policyId }: { policyId: string }) {
  const detail = useLoad(() => documentsApi.policyCoverage(policyId).then((r) => r.data), [policyId], 'The names could not be loaded.')
  const d = detail.data
  return (
    <div className="dc-detail" data-testid="coverage-detail">
      {detail.loading && !d ? <LoadingCard testId="coverage-detail-loading" /> : null}
      {detail.error ? <ErrorBlock message={detail.error.detail} onRetry={detail.reload} testId="coverage-detail-error" /> : null}
      {d ? (
        <div className="dc-cols">
          <section aria-label="Outstanding">
            <h3 className="dc-h3">Outstanding ({d.outstanding_count})</h3>
            {d.outstanding.length === 0 ? (
              <p className="dc-fine" data-testid="outstanding-none">Everyone eligible has acknowledged this version.</p>
            ) : (
              <ul className="dc-names" data-testid="outstanding-list">
                {d.outstanding.map((p) => (
                  <li key={p.employee_id} data-testid="outstanding-person">
                    <strong>{p.name}</strong>
                    <span className="dc-sub">{p.department ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Acknowledged">
            <h3 className="dc-h3">Acknowledged ({d.acknowledged_count})</h3>
            {d.acknowledged.length === 0 ? (
              <p className="dc-fine" data-testid="acknowledged-none">Nobody has acknowledged this version yet.</p>
            ) : (
              <ul className="dc-names" data-testid="acknowledged-list">
                {d.acknowledged.map((p) => (
                  <li key={p.employee_id} data-testid="acknowledged-person">
                    <strong>{p.name}</strong>
                    <span className="dc-sub">
                      {p.department ? `${p.department} - ` : ''}
                      {formatDateTime(p.acknowledged_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
