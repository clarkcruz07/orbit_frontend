import { HrCoverage } from './HrCoverage'
import { HrEmployees } from './HrEmployees'
import { HrExpiring } from './HrExpiring'
import { HrPublish } from './HrPublish'
import { HrTypes } from './HrTypes'
import { HR_SECTIONS, type HrSection } from './logic'

/** HR area. Each section loads its own data; the server answers 403 to anyone who is not HR and the section says so. */
export function HrTab({ section, onSection }: { section: HrSection; onSection: (s: HrSection) => void }) {
  return (
    <div data-testid="hr-tab">
      <div className="dc-subtabs" role="tablist" aria-label="HR document tools">
        {HR_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className={`dc-subtab${section === s.id ? ' active' : ''}`}
            onClick={() => onSection(s.id)}
            data-testid={`hr-section-${s.id}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section === 'employees' ? <HrEmployees /> : null}
      {section === 'expiring' ? <HrExpiring /> : null}
      {section === 'publish' ? <HrPublish /> : null}
      {section === 'coverage' ? <HrCoverage /> : null}
      {section === 'types' ? <HrTypes /> : null}
    </div>
  )
}
