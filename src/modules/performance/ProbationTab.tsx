import { useEffect, useId, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardCheck, Download, Plus, Search } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { Modal } from '@/modules/peoplemgmt/parts'
import { useDebounced, useLoad } from './hooks'
import { ErrorBlock, LoadingCard, Pill } from './parts'
import { ConfidentialNote } from './ProbationSections'
import { probationApi } from './probationApi'
import {
  DEFAULT_FORM,
  STATUS_FILTERS,
  filterEligible,
  formatAverage,
  evaluationTitle,
  parseServerError,
  recommendationLabel,
  recommendationTone,
  statusLabel,
  statusTone,
  type Eligible,
  type EvalListItem,
  type StatusFilter,
} from './probationLogic'
import './probation.css'

const KEYS = DEFAULT_FORM.criteria.map((c) => c.key)

/**
 * Probation Evaluation tab: the list of evaluations the caller may see (a manager's own, or everyone's for HR), with filter chips, a name
 * search, a "New evaluation" picker and a row action to download the PDF. The server decides who may see what: a 403 shows "not available".
 */
export function ProbationTab() {
  const [filter, setFilter] = useState<StatusFilter>('')
  const [text, setText] = useState('')
  const q = useDebounced(text, 300)
  const [picking, setPicking] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const state = useLoad(() => probationApi.list(filter, q), [filter, q], 'The evaluations could not be loaded.')
  const items = state.data?.items ?? []
  const filtered = filter !== '' || q.trim() !== ''

  async function download(id: string) {
    setBusyId(id)
    setFlash(null)
    try {
      await probationApi.downloadPdf(id)
    } catch (err) {
      setFlash({ tone: 'danger', text: parseServerError(err, 'The PDF could not be downloaded.').detail })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="probation-title" data-testid="probation-tab">
      <div className="pf-toolbar">
        <h2 id="probation-title" className="pf-section-title">
          Probation Evaluation
        </h2>
        <div className="pf-toolbar-right">
          <button type="button" className="btn btn-primary" onClick={() => setPicking(true)} data-testid="new-evaluation">
            <Plus size={16} aria-hidden="true" /> New evaluation
          </button>
        </div>
      </div>
      <ConfidentialNote />

      <div className="pb-filters" data-testid="probation-filters">
        <div className="pb-chips" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <button key={f.id || 'all'} type="button" className={`pb-chip${filter === f.id ? ' active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} data-testid={`filter-${f.id || 'all'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="pb-search">
          <span className="pf-visually-hidden">Search by name</span>
          <Search size={16} aria-hidden="true" />
          <input className="pf-input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name" autoComplete="off" maxLength={80} data-testid="probation-search" />
        </label>
      </div>

      {flash ? (
        <div className="pf-flash-block" data-testid="probation-flash">
          <Alert tone={flash.tone}>{flash.text}</Alert>
        </div>
      ) : null}

      {state.loading && !state.data ? (
        <LoadingCard rows={3} />
      ) : state.error && !state.data ? (
        state.error.status === 403 ? (
          <EmptyState icon={<ClipboardCheck size={28} />} title="Not available" body="Probation evaluations are only available to managers and HR." />
        ) : (
          <ErrorBlock message={state.error.detail} onRetry={state.reload} />
        )
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={28} />}
          title={filtered ? 'No evaluations match' : 'No probation evaluations yet'}
          body={filtered ? 'Try another filter or a different name.' : 'Start one with New evaluation. A manager can evaluate the people who report to them.'}
        />
      ) : (
        <ul className="pf-rows" data-testid="probation-list">
          {items.map((it) => (
            <EvaluationRow key={it.evaluation_id} item={it} busy={busyId === it.evaluation_id} onDownload={() => void download(it.evaluation_id)} />
          ))}
        </ul>
      )}

      {picking ? <NewEvaluationDialog onClose={() => setPicking(false)} /> : null}
    </section>
  )
}

function EvaluationRow({ item, busy, onDownload }: { item: EvalListItem; busy: boolean; onDownload: () => void }) {
  const name = evaluationTitle(item)
  return (
    <li>
      <div className="pf-row card pb-row" data-testid="probation-row" data-id={item.evaluation_id} data-status={item.status}>
        <div className="pf-row-main">
          <Link to={`/performance/probation/${encodeURIComponent(item.evaluation_id)}`} className="pf-row-title pb-row-link" data-testid="probation-open">
            {name}
          </Link>
          <div className="pf-sub">
            {[item.employee.position, item.employee.department].filter(Boolean).join(' - ') || 'No position on file'}
          </div>
          <div className="pf-sub" data-testid="probation-evaluator">
            Evaluator: {item.evaluator.name ?? 'Unknown'}
            {item.manager?.name ? ` - Manager: ${item.manager.name}` : ''}
          </div>
        </div>
        <div className="pf-row-side">
          <div className="pf-row-pills">
            <Pill tone={statusTone(item.status)} testId="probation-status">
              {statusLabel(item.status)}
            </Pill>
            <Pill tone={recommendationTone(item.recommendation)} testId="probation-recommendation">
              {recommendationLabel(item.recommendation)}
            </Pill>
          </div>
          <div className="pf-row-meta">
            <span data-testid="probation-average">Average {formatAverage(item.average)}</span>
            <span>{item.review_date ? `Review ${formatDate(item.review_date)}` : 'No review date'}</span>
          </div>
          <div className="pb-row-actions">
            <Link to={`/performance/probation/${encodeURIComponent(item.evaluation_id)}`} className="btn btn-secondary" aria-label={`Open the evaluation of ${name}`} data-testid="probation-open-btn">
              Open
            </Link>
            <button type="button" className="btn btn-secondary" onClick={onDownload} disabled={busy} aria-label={`Download the PDF of ${name}`} data-testid="probation-download">
              <Download size={16} aria-hidden="true" /> {busy ? 'Preparing...' : 'PDF'}
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

/** Who to evaluate: the people the caller may evaluate (from the server), with type-ahead. Creating opens the new draft. */
function NewEvaluationDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const listId = useId().replace(/:/g, '')
  const [text, setText] = useState('')
  const [chosen, setChosen] = useState<Eligible | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useLoad(() => probationApi.eligible(), [], 'The list of people could not be loaded.')
  const people = load.data ?? []
  const shown = useMemo(() => filterEligible(people, text), [people, text])

  useEffect(() => {
    setError(null)
  }, [chosen])

  async function create() {
    if (!chosen || busy) return
    setBusy(true)
    setError(null)
    try {
      const ev = await probationApi.create(chosen.employee_id, KEYS)
      navigate(`/performance/probation/${encodeURIComponent(ev.evaluation_id)}`)
    } catch (err) {
      const info = parseServerError(err, 'The evaluation could not be started.')
      setError(info.status === 409 ? `${info.detail} Open the existing draft from the list instead.` : info.detail)
      setBusy(false)
    }
  }

  return (
    <Modal title="New probation evaluation" onClose={onClose} busy={busy} testId="new-evaluation-dialog">
      <p className="pf-help">Choose the employee you are evaluating. Their name, position, department and manager are filled in from their record.</p>
      {load.loading ? (
        <LoadingCard rows={2} />
      ) : load.error ? (
        <ErrorBlock message={load.error.status === 403 ? 'Probation evaluations are only available to managers and HR.' : load.error.detail} onRetry={load.reload} />
      ) : people.length === 0 ? (
        <div data-testid="eligible-empty">
          <Alert tone="info">There is nobody to evaluate yet. A manager can evaluate the people who report to them, so their direct reports need to be on file (HR sets managers on the People page).</Alert>
        </div>
      ) : (
        <>
          <label className="pf-label" htmlFor={`${listId}-q`}>
            Find a person
          </label>
          <input id={`${listId}-q`} className="pf-input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name, job title or department" autoComplete="off" data-autofocus data-testid="eligible-search" />
          <div className="pb-eligible" role="radiogroup" aria-label="People you can evaluate" data-testid="eligible-list">
            {shown.length === 0 ? (
              <p className="pf-muted" data-testid="eligible-none">
                Nobody matches that search.
              </p>
            ) : (
              shown.map((p) => (
                <label key={p.employee_id} className={`pb-eligible-item${chosen?.employee_id === p.employee_id ? ' active' : ''}`}>
                  <input type="radio" name="eligible" value={p.employee_id} checked={chosen?.employee_id === p.employee_id} onChange={() => setChosen(p)} data-testid={`eligible-${p.employee_id}`} />
                  <span className="pb-eligible-name">{p.name}</span>
                  <span className="pf-sub">{[p.job_title, p.department].filter(Boolean).join(' - ') || 'No position on file'}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}
      {error ? (
        <div className="pf-flash-block" data-testid="new-evaluation-error">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <div className="pf-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} data-testid="new-evaluation-cancel">
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={!chosen || busy} data-testid="new-evaluation-start">
          {busy ? 'Starting...' : 'Start evaluation'}
        </button>
      </div>
    </Modal>
  )
}
