import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/ui/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import { PageTitle } from '@/pages/PageTitle'
import { DocumentList } from './DocumentList'
import { HrTab } from './HrTab'
import { Notice } from './parts'
import { PoliciesTab } from './PoliciesTab'
import { HR_ONLY_NOTE, PRIVACY_NOTE, TAB_LABEL, parseSection, parseTab, visibleTabs, type HrSection, type TabId } from './logic'
import './documents.css'

/**
 * Documents (route `documents`, and `documents/policies/:policyId` for the policy notification link).
 * Privacy rules. The server decides what each person may see and do.
 */
export function DocumentsPage({ policyDeepLink = false }: { policyDeepLink?: boolean }) {
  const user = useAuthStore((s) => s.user)
  const tabs = useMemo(() => visibleTabs(user?.roles), [user?.roles])
  const [params, setParams] = useSearchParams()
  const { policyId } = useParams()
  const navigate = useNavigate()
  const tab: TabId = policyDeepLink ? 'policies' : parseTab(params.get('tab'), tabs)
  const section = parseSection(params.get('section'))

  function setTab(next: TabId) {
    if (policyDeepLink) {
      navigate(next === 'mine' ? '/documents' : `/documents?tab=${next}`)
      return
    }
    const p = new URLSearchParams(params)
    if (next === 'mine') p.delete('tab')
    else p.set('tab', next)
    p.delete('section')
    setParams(p, { replace: true })
  }
  function setSection(next: HrSection) {
    const p = new URLSearchParams(params)
    p.set('tab', 'hr')
    if (next === 'employees') p.delete('section')
    else p.set('section', next)
    setParams(p, { replace: true })
  }

  return (
    <div className="page dc-page" data-testid="documents-page" data-tab={tab}>
      <PageTitle title="Documents" subtitle="Your personal documents and the company policy library." />

      <div className="dc-tabs" role="tablist" aria-label="Documents">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`dc-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'mine' ? (
        <section data-testid="tab-panel-mine" aria-label="My documents">
          <Notice testId="privacy-note">
            {PRIVACY_NOTE} {HR_ONLY_NOTE}
          </Notice>
          {user && !user.employee_id ? (
            <EmptyState title="No employee record" body="Your sign-in account is not linked to an employee record, so you have no personal documents. You can still read the policy library." />
          ) : (
            <DocumentList
              employeeId={user?.employee_id ?? undefined}
              showEmployee={false}
              upload="self"
              emptyTitle="No documents yet"
              emptyBody="Upload a document such as an ID or certificate. It is kept with its history and is visible to you and HR only."
            />
          )}
        </section>
      ) : null}

      {tab === 'policies' ? (
        <section data-testid="tab-panel-policies" aria-label="Policies">
          <PoliciesTab highlightId={policyDeepLink ? policyId : undefined} />
        </section>
      ) : null}

      {tab === 'hr' ? (
        <section data-testid="tab-panel-hr" aria-label="HR documents">
          <Notice testId="hr-note">
            HR tools. Personal documents are private to the owner and HR: managers cannot see them. Reading someone else&apos;s document is recorded in the audit trail.
          </Notice>
          <HrTab section={section} onSection={setSection} />
        </section>
      ) : null}
    </div>
  )
}

export function DocumentsPolicyRoute() {
  return <DocumentsPage policyDeepLink />
}
