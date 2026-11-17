import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, CalendarCheck, CalendarDays, Clock, FileText, Headset, Library, UsersRound, type LucideIcon } from 'lucide-react'
import { CATALOGS, type CatalogLink } from './logic'
import { Panel } from './parts'

const ICONS: Record<string, LucideIcon> = { leave: CalendarDays, timesheet: Clock, documents: FileText, learning: BookOpen, hrcases: Headset, holidays: CalendarCheck, people: UsersRound, knowledge: Library }

/** Two more places HR manages from Settings (People management and the company holiday list); each has its own pages. */
const MANAGE: readonly CatalogLink[] = [
  {
    id: 'holidays',
    title: 'Holidays',
    description: 'The company holiday list. The Company Calendar and leave day-counting both use it.',
    to: '/settings/holidays',
    where: 'Settings > Holidays',
  },
  {
    id: 'people',
    title: 'People',
    description: 'Add, edit and deactivate people, set their roles, or import a CSV file.',
    to: '/people',
    where: 'People',
  },
  {
    id: 'knowledge',
    title: 'Knowledge Base',
    description: 'The articles Bluedge Orbit answers from, next to the policy documents it reads.',
    to: '/knowledge-base',
    where: 'Knowledge Base',
  },
]

/**
 * "Catalogs": a read-only index. Each catalog is managed on its own module's page; this tab only links there,
 * so there is exactly one place to edit each one. The server decides on that page what a person may change.
 */
export function CatalogsTab() {
  return (
    <div className="st-stack" data-testid="tab-catalogs">
      <Panel id="st-cat-h" title="Catalogs" sub="Where HR manages each catalog." testId="catalogs-panel">
        <ul className="st-catalogs" data-testid="catalogs-list">
          {[...CATALOGS, ...MANAGE].map((c) => {
            const Icon = ICONS[c.id] ?? FileText
            return (
              <li key={c.id} className="st-catalog" data-testid={`catalog-${c.id}`}>
                <span className="st-tile" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.7} />
                </span>
                <div className="st-row-text">
                  <strong>{c.title}</strong>
                  <span>{c.description}</span>
                  <span className="st-muted">Found under: {c.where}</span>
                  {c.note ? <span className="st-note" data-testid={`catalog-note-${c.id}`}>{c.note}</span> : null}
                </div>
                <Link to={c.to} className="btn btn-secondary st-go" data-testid={`catalog-link-${c.id}`}>
                  Open
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}
