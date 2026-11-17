import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/ui/Feedback'
import { meApi } from '@/api/me'
import { formatDate } from '@/lib/dates'
import { useAuthStore } from '@/stores/authStore'
import { settingsApi } from './api'
import { ROLES_NOTE, authSourceLabel, authSourceTone, describeError, rolesText, type HrAccess } from './logic'
import { Badge, Panel } from './parts'

type Extra = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; authSource: string; memberSince: string | null }

/**
 * "Account": read-only facts. Name, e-mail, roles, job title and department come from the signed-in user (`GET /auth/me`);
 * the sign-in source from `GET /me/profile`; the company time zone from `GET /settings/overview` only when the server has
 * already shown this person HR access (no probing, so nobody else triggers a refused request).
 */
export function AccountTab({ hrAccess }: { hrAccess: HrAccess }) {
  const user = useAuthStore((s) => s.user)
  const [extra, setExtra] = useState<Extra>({ kind: 'loading' })
  const [zone, setZone] = useState<string | null>(null)

  const loadExtra = useCallback(() => {
    setExtra({ kind: 'loading' })
    meApi
      .profile()
      .then((p) => setExtra({ kind: 'ready', authSource: String(p.auth_source), memberSince: p.member_since }))
      .catch((err) => setExtra({ kind: 'error', message: describeError(err, "Your sign-in source couldn't be loaded.").message }))
  }, [])

  useEffect(() => {
    loadExtra()
  }, [loadExtra])

  useEffect(() => {
    if (hrAccess !== 'allowed') return
    let live = true
    settingsApi
      .overview()
      .then((o) => live && setZone(o.company_timezone))
      .catch(() => undefined) // the zone is a nice-to-have: omit it rather than show an error
    return () => {
      live = false
    }
  }, [hrAccess])

  const dash = '-'
  return (
    <div className="st-stack" data-testid="tab-account">
      <Panel id="st-account-h" title="Your account" sub="These details come from HR and from how you sign in. You can't edit them here." testId="account-panel">
        <dl className="st-facts" data-testid="account-facts">
          <Fact label="Name" value={user?.name ?? dash} testId="fact-name" />
          <Fact label="Email" value={user?.email ?? dash} testId="fact-email" wrap />
          <Fact label="Employee ID" value={user?.employee_id ?? dash} testId="fact-employee-id" />
          <Fact label="Job title" value={user?.job_title || dash} testId="fact-job-title" />
          <Fact label="Department" value={user?.department || dash} testId="fact-department" />
          <Fact label="Roles" value={rolesText(user?.roles ?? [])} testId="fact-roles" />
          <div className="st-fact" data-testid="fact-source">
            <dt>Signed in with</dt>
            <dd>
              {extra.kind === 'loading' ? <Skeleton style={{ width: 150, height: 22 }} /> : null}
              {extra.kind === 'ready' ? <Badge tone={authSourceTone(extra.authSource)}>{authSourceLabel(extra.authSource)}</Badge> : null}
              {extra.kind === 'error' ? (
                <span className="st-inline-error" role="alert">
                  {extra.message}{' '}
                  <button type="button" className="st-link-button" onClick={loadExtra}>
                    Try again
                  </button>
                </span>
              ) : null}
            </dd>
          </div>
          {extra.kind === 'ready' && extra.memberSince ? <Fact label="Member since" value={formatDate(extra.memberSince)} testId="fact-since" /> : null}
          {zone ? <Fact label="Company time zone" value={zone} testId="fact-timezone" /> : null}
        </dl>
        <p className="st-foot">{ROLES_NOTE}</p>
      </Panel>
    </div>
  )
}

function Fact({ label, value, testId, wrap }: { label: string; value: string; testId: string; wrap?: boolean }) {
  return (
    <div className="st-fact" data-testid={testId}>
      <dt>{label}</dt>
      <dd className={wrap ? 'st-wrap' : undefined}>{value}</dd>
    </div>
  )
}
