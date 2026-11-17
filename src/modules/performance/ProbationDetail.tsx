import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Download, FileX, RotateCcw, Save, Send, Trash2 } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { PageTitle } from '@/pages/PageTitle'
import { Modal } from '@/modules/peoplemgmt/parts'
import { useLoad } from './hooks'
import { ErrorBlock, LoadingCard, Pill } from './parts'
import { probationApi } from './probationApi'
import { CommentBox, ConfidentialNote, CriterionCard, DevelopmentTable, RatingGuide, RecommendationSection } from './ProbationSections'
import {
  DEFAULT_FORM,
  anchorId,
  averageRating,
  diffDraft,
  evaluationTitle,
  formatAverage,
  isDirty,
  isFieldFilled,
  missingFields,
  missingFromError,
  missingLabel,
  parseServerError,
  ratedCount,
  recommendationLabel,
  recommendationTone,
  serverFieldErrors,
  statusLabel,
  statusTone,
  toDraft,
  validateDraft,
  type Draft,
  type Evaluation,
  type FieldErrors,
  type ProbationFormDef,
} from './probationLogic'
import './probation.css'

const BACK = '/performance?tab=probation'
const DEFAULT_KEYS = DEFAULT_FORM.criteria.map((c) => c.key)

type Dialog = null | 'submit' | 'reopen' | 'delete' | 'leave'
type Busy = null | 'save' | 'submit' | 'pdf' | 'reopen' | 'delete'
type Flash = { tone: 'info' | 'danger'; text: string } | null

function focusAnchor(key: string) {
  const el = document.getElementById(anchorId(key))
  if (!el) return
  el.scrollIntoView({ block: 'center' })
  const target = el.tagName === 'FIELDSET' ? el.querySelector<HTMLElement>('input') : el
  target?.focus({ preventScroll: true })
}

/** One evaluation: the paper form as a page. Editable while it is a draft the server lets the caller edit; read-only once submitted. */
export function ProbationDetail() {
  const { id = '' } = useParams()
  const formLoad = useLoad(() => probationApi.form(), [], 'The form could not be loaded.')
  const evalLoad = useLoad(() => probationApi.get(id, DEFAULT_KEYS), [id], 'The evaluation could not be loaded.')
  // The company's own wording is the fallback when the server's copy cannot be loaded: the form stays usable.
  const form: ProbationFormDef | null = formLoad.data ?? (formLoad.error ? DEFAULT_FORM : null)
  const ev = evalLoad.data

  if (evalLoad.error && !ev) {
    const status = evalLoad.error.status
    return (
      <div className="page pf-page" data-testid="probation-detail-error">
        <BackToList />
        {status === 404 ? (
          <EmptyState icon={<FileX size={28} />} title="Evaluation not found" body="This evaluation does not exist, or you do not have access to it." />
        ) : status === 403 ? (
          <EmptyState icon={<FileX size={28} />} title="Not available" body="Probation evaluations are only available to the evaluating manager and HR." />
        ) : (
          <ErrorBlock message={evalLoad.error.detail} onRetry={evalLoad.reload} />
        )}
      </div>
    )
  }
  if (!ev || !form) {
    return (
      <div className="page pf-page" data-testid="probation-detail-loading">
        <BackToList />
        <LoadingCard rows={5} />
      </div>
    )
  }
  return <Editor key={ev.evaluation_id} initial={ev} form={form} />
}

function BackToList({ onClick }: { onClick?: (e: MouseEvent) => void }) {
  return (
    <p className="pf-back">
      <Link to={BACK} className="pf-back-link" onClick={onClick} data-testid="back-link">
        <ChevronLeft size={16} aria-hidden="true" /> Back to probation evaluations
      </Link>
    </p>
  )
}

function Editor({ initial, form }: { initial: Evaluation; form: ProbationFormDef }) {
  const navigate = useNavigate()
  const keys = useMemo(() => form.criteria.map((c) => c.key), [form])
  const [saved, setSaved] = useState<Evaluation>(initial)
  const [base, setBase] = useState<Draft>(() => toDraft(initial, keys))
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, keys))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [missing, setMissing] = useState<string[] | null>(null)
  const [banner, setBanner] = useState<Flash>(null)
  const [flash, setFlash] = useState<Flash>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [stale, setStale] = useState(false)
  const [guideOpenFirst] = useState(() => ratedCount(initial.ratings, keys) === 0)

  const readOnly = !saved.can_edit
  const dirty = !readOnly && isDirty(base, draft, keys)
  const given = ratedCount(draft.ratings, keys)
  const average = averageRating(draft.ratings, keys)
  const name = evaluationTitle(saved)

  // Closing or reloading the tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const apply = useCallback(
    (next: Evaluation) => {
      setSaved(next)
      const d = toDraft(next, keys)
      setBase(d)
      setDraft(d)
    },
    [keys],
  )

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const setRating = (key: string, entry: { rating: number | null; comments: string }) => setDraft((d) => ({ ...d, ratings: { ...d.ratings, [key]: entry } }))

  // The checklist shrinks while the manager fills things in.
  const stillMissing = useMemo(() => (missing ? missing.filter((k) => !isFieldFilled(draft, k)) : null), [missing, draft])

  function showFirstError(found: FieldErrors) {
    const first = Object.keys(found)[0]
    if (!first) return
    const map: Array<[RegExp, (m: RegExpExecArray) => string]> = [
      [/^comments\.(.+)$/, (m) => `eval-comments-${m[1]}`],
      [/^ratings\.(.+)$/, (m) => `eval-rating-${m[1]}`],
      [/^development_rows\.(\d+)\.(\w+)$/, (m) => `eval-dev-${m[1]}-${m[2]}`],
      [/^extension\.(.+)$/, (m) => `eval-ext-${m[1]}`],
    ]
    for (const [re, build] of map) {
      const m = re.exec(first)
      if (m) {
        const el = document.getElementById(build(m))
        if (el) {
          el.scrollIntoView({ block: 'center' })
          el.focus({ preventScroll: true })
          return
        }
      }
    }
    focusAnchor(first)
  }

  async function save() {
    if (busy || readOnly) return
    setFlash(null)
    setBanner(null)
    const found = validateDraft(draft, keys, form.limits)
    setErrors(found)
    if (Object.keys(found).length) {
      setBanner({ tone: 'danger', text: 'Some values need attention before this can be saved.' })
      showFirstError(found)
      return
    }
    const body = diffDraft(base, draft, keys)
    if (!body) {
      setFlash({ tone: 'info', text: 'No changes to save.' })
      return
    }
    setBusy('save')
    try {
      apply(await probationApi.patch(saved.evaluation_id, body, keys))
      setFlash({ tone: 'info', text: 'Draft saved.' })
    } catch (err) {
      fail(err, 'The draft could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  function fail(err: unknown, fallback: string) {
    const info = parseServerError(err, fallback)
    if (info.status === 409) {
      setStale(true)
      setBanner({ tone: 'danger', text: `${info.detail} Reload to see the latest version. What you typed stays here until you do.` })
      return
    }
    setErrors(serverFieldErrors(info, keys))
    setBanner({ tone: 'danger', text: info.detail })
  }

  function askSubmit() {
    if (busy || readOnly) return
    setFlash(null)
    setBanner(null)
    const found = validateDraft(draft, keys, form.limits)
    setErrors(found)
    if (Object.keys(found).length) {
      setBanner({ tone: 'danger', text: 'Some values need attention before this can be submitted.' })
      showFirstError(found)
      return
    }
    const miss = missingFields(draft, keys)
    if (miss.length) {
      setMissing(miss)
      setBanner({ tone: 'danger', text: 'This evaluation is not complete yet. The list below shows what is missing.' })
      focusAnchor(miss[0])
      return
    }
    setMissing(null)
    setDialog('submit')
  }

  async function doSubmit() {
    if (busy) return
    setBusy('submit')
    setBanner(null)
    try {
      const body = diffDraft(base, draft, keys)
      if (body) apply(await probationApi.patch(saved.evaluation_id, body, keys))
      apply(await probationApi.submit(saved.evaluation_id, keys))
      setDialog(null)
      setMissing(null)
      setErrors({})
      setFlash({ tone: 'info', text: 'Submitted. HR has been notified and the evaluation is now locked.' })
    } catch (err) {
      setDialog(null)
      const miss = missingFromError(err)
      if (miss) {
        setMissing(miss)
        setBanner({ tone: 'danger', text: 'This evaluation is not complete yet. The list below shows what is missing.' })
        const first = miss[0]
        window.setTimeout(() => focusAnchor(first), 0)
      } else {
        fail(err, 'The evaluation could not be submitted.')
      }
    } finally {
      setBusy(null)
    }
  }

  async function doReopen() {
    if (busy) return
    setBusy('reopen')
    try {
      apply(await probationApi.reopen(saved.evaluation_id, keys))
      setDialog(null)
      setFlash({ tone: 'info', text: 'Reopened. The evaluation can be edited again.' })
    } catch (err) {
      setDialog(null)
      fail(err, 'The evaluation could not be reopened.')
    } finally {
      setBusy(null)
    }
  }

  async function doDelete() {
    if (busy) return
    setBusy('delete')
    try {
      await probationApi.remove(saved.evaluation_id)
      navigate(BACK)
    } catch (err) {
      setDialog(null)
      fail(err, 'The evaluation could not be deleted.')
      setBusy(null)
    }
  }

  async function pdf() {
    if (busy) return
    setBusy('pdf')
    setFlash(null)
    try {
      await probationApi.downloadPdf(saved.evaluation_id)
    } catch (err) {
      setFlash({ tone: 'danger', text: parseServerError(err, 'The PDF could not be downloaded.').detail })
    } finally {
      setBusy(null)
    }
  }

  function onBack(e: MouseEvent) {
    if (dirty) {
      e.preventDefault()
      setDialog('leave')
    }
  }

  return (
    <div className="page pf-page pb-page" data-testid="probation-detail" data-id={saved.evaluation_id} data-status={saved.status} data-mode={readOnly ? 'read' : 'edit'}>
      <BackToList onClick={onBack} />
      <PageTitle title={`Probation evaluation: ${name}`} subtitle={`${form.title} (version ${form.version})`} />
      <ConfidentialNote />

      {banner ? (
        <div className="pf-flash-block" data-testid="probation-banner">
          <Alert tone={banner.tone}>{banner.text}</Alert>
          {stale ? (
            <button type="button" className="btn btn-secondary pf-retry" onClick={() => window.location.reload()} data-testid="probation-reload">
              Reload
            </button>
          ) : null}
        </div>
      ) : null}
      {flash ? (
        <p className="pf-flash" role="status" data-testid="probation-flash">
          {flash.text}
        </p>
      ) : null}

      {stillMissing && stillMissing.length ? (
        <div className="card card-pad pb-missing" role="alert" data-testid="missing-list">
          <strong>Before this can be submitted ({stillMissing.length} left):</strong>
          <ul>
            {stillMissing.map((k) => (
              <li key={k}>
                <button type="button" className="pf-linkbtn" onClick={() => focusAnchor(k)} data-testid={`missing-${k}`}>
                  {missingLabel(k, form.criteria)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="card card-pad" aria-labelledby="eval-header-title" data-testid="eval-header">
        <div className="pf-card-head">
          <h2 id="eval-header-title">{form.title}</h2>
          <div className="pf-row-pills">
            <Pill tone={statusTone(saved.status)} testId="eval-status">
              {statusLabel(saved.status)}
            </Pill>
            <Pill tone={recommendationTone(saved.recommendation)} testId="eval-recommendation-pill">
              {recommendationLabel(saved.recommendation)}
            </Pill>
          </div>
        </div>
        <dl className="pf-facts" data-testid="eval-facts">
          <div>
            <dt>Employee Name</dt>
            <dd data-testid="eval-employee">{saved.employee.name ?? saved.employee.employee_id}</dd>
          </div>
          <div>
            <dt>Position</dt>
            <dd>{saved.employee.position ?? '-'}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{saved.employee.department ?? '-'}</dd>
          </div>
          <div>
            <dt>Manager / Team Lead</dt>
            <dd>{saved.manager?.name ?? 'No manager on file'}</dd>
          </div>
          <div>
            <dt>Evaluator</dt>
            <dd>{saved.evaluator.name ?? '-'}</dd>
          </div>
          {saved.status === 'submitted' ? (
            <div>
              <dt>Submitted</dt>
              <dd>
                {saved.submitted_at ? formatDate(saved.submitted_at) : '-'}
                {saved.submitted_by_name ? ` by ${saved.submitted_by_name}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="pf-field pf-field-narrow">
          <label htmlFor="eval-review-date" className="pf-label">
            Review Date
          </label>
          {readOnly ? (
            <p className="pf-text" data-testid="review-date-read">
              {saved.review_date ? formatDate(saved.review_date) : 'Not set'}
            </p>
          ) : (
            <>
              <input
                id="eval-review-date"
                type="date"
                className="pf-input"
                value={draft.review_date}
                onChange={(e) => update({ review_date: e.target.value })}
                aria-invalid={errors.review_date ? true : undefined}
                data-testid="review-date"
              />
              {errors.review_date ? <p className="pf-field-error" role="alert">{errors.review_date}</p> : null}
            </>
          )}
        </div>
        <p className="pb-progress" data-testid="eval-progress" aria-live="polite">
          <strong>
            {given} of {keys.length}
          </strong>{' '}
          rated. Average {formatAverage(average)}
        </p>
      </section>

      <RatingGuide guide={form.rating_guide} initiallyOpen={guideOpenFirst} />

      <div className="pb-sections" data-testid="eval-form">
        {form.criteria.map((c) => (
          <CriterionCard
            key={c.key}
            criterion={c}
            entry={draft.ratings[c.key] ?? { rating: null, comments: '' }}
            readOnly={readOnly}
            limits={form.limits}
            errors={errors}
            onChange={(entry) => setRating(c.key, entry)}
          />
        ))}

        <CommentBox
          id="eval-strengths"
          title="10. Overall Strengths"
          prompt="Please summarise the employee's key strengths demonstrated during the probationary period."
          value={draft.strengths}
          readOnly={readOnly}
          max={form.limits.comment_max}
          error={errors.strengths}
          testId="strengths"
          onChange={(v) => update({ strengths: v })}
        />
        <CommentBox
          id="eval-development"
          title="11. Areas for Development"
          prompt="Identify areas where the employee can continue to develop and improve."
          value={draft.development_comments}
          readOnly={readOnly}
          max={form.limits.comment_max}
          error={errors.development_comments}
          testId="development-comments"
          onChange={(v) => update({ development_comments: v })}
        />
        <section className="card card-pad pb-criterion" aria-labelledby="eval-dev-title" data-testid="section-development-plan">
          <h3 className="pb-criterion-title" id="eval-dev-title">
            Development plan
          </h3>
          <p className="pb-criteria-label">Development area, recommended actions and target completion.</p>
          <DevelopmentTable rows={draft.development_rows} readOnly={readOnly} limits={form.limits} errors={errors} onChange={(rows) => update({ development_rows: rows })} />
        </section>
        <CommentBox
          id="eval-summary"
          title="Overall Performance Summary"
          prompt="Please provide an overall assessment of the employee's performance during the probation period, highlighting key achievements, development areas, and readiness for regular employment."
          value={draft.summary}
          readOnly={readOnly}
          max={form.limits.comment_max}
          error={errors.summary}
          required
          testId="summary"
          onChange={(v) => update({ summary: v })}
        />
        <RecommendationSection
          options={form.recommendations}
          value={draft.recommendation}
          extension={draft.extension}
          readOnly={readOnly}
          limits={form.limits}
          errors={errors}
          onValue={(v) => update({ recommendation: v })}
          onExtension={(ext) => update({ extension: ext })}
        />
      </div>

      <div className="card card-pad pb-bar" data-testid="eval-bar">
        <p className="pb-bar-status" aria-live="polite" data-testid="eval-bar-status">
          {given} of {keys.length} rated - average {formatAverage(average)}
          {!readOnly ? <span className="pb-dirty">{dirty ? ' - unsaved changes' : ' - all changes saved'}</span> : null}
        </p>
        <div className="pb-bar-actions">
          {saved.can_delete ? (
            <button type="button" className="btn btn-secondary" onClick={() => setDialog('delete')} disabled={busy !== null} data-testid="delete">
              <Trash2 size={16} aria-hidden="true" /> Delete draft
            </button>
          ) : null}
          {saved.can_reopen ? (
            <button type="button" className="btn btn-secondary" onClick={() => setDialog('reopen')} disabled={busy !== null} data-testid="reopen">
              <RotateCcw size={16} aria-hidden="true" /> Reopen for editing
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={() => void pdf()} disabled={busy !== null} data-testid="download-pdf">
            <Download size={16} aria-hidden="true" /> {busy === 'pdf' ? 'Preparing...' : 'Download PDF'}
          </button>
          {!readOnly ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => void save()} disabled={busy !== null || !dirty} data-testid="save-draft">
                <Save size={16} aria-hidden="true" /> {busy === 'save' ? 'Saving...' : 'Save draft'}
              </button>
              {saved.can_submit ? (
                <button type="button" className="btn btn-primary" onClick={askSubmit} disabled={busy !== null} data-testid="submit-evaluation">
                  <Send size={16} aria-hidden="true" /> Submit evaluation
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {dialog === 'submit' ? (
        <Modal title="Submit this evaluation?" onClose={() => setDialog(null)} busy={busy === 'submit'} testId="submit-dialog">
          <p>
            This locks the evaluation of <strong>{name}</strong> and notifies HR. After that only HR can reopen it for changes.
          </p>
          <p className="pf-help">
            Rated {given} of {keys.length}, average {formatAverage(average)}. Recommendation: {recommendationLabel(draft.recommendation)}.
          </p>
          <div className="pf-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)} disabled={busy === 'submit'} data-testid="submit-cancel">
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void doSubmit()} disabled={busy === 'submit'} data-testid="submit-confirm">
              {busy === 'submit' ? 'Submitting...' : 'Submit evaluation'}
            </button>
          </div>
        </Modal>
      ) : null}
      {dialog === 'reopen' ? (
        <Modal title="Reopen for editing?" onClose={() => setDialog(null)} busy={busy === 'reopen'} testId="reopen-dialog">
          <p>The evaluation goes back to a draft so the evaluator can change it. It has to be submitted again afterwards.</p>
          <div className="pf-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)} disabled={busy === 'reopen'} data-testid="reopen-cancel">
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void doReopen()} disabled={busy === 'reopen'} data-testid="reopen-confirm">
              {busy === 'reopen' ? 'Reopening...' : 'Reopen'}
            </button>
          </div>
        </Modal>
      ) : null}
      {dialog === 'delete' ? (
        <Modal title="Delete this draft?" onClose={() => setDialog(null)} busy={busy === 'delete'} testId="delete-dialog">
          <p>
            The draft evaluation of <strong>{name}</strong> is removed for good. This cannot be undone.
          </p>
          <div className="pf-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)} disabled={busy === 'delete'} data-testid="delete-cancel">
              Keep it
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void doDelete()} disabled={busy === 'delete'} data-testid="delete-confirm">
              {busy === 'delete' ? 'Deleting...' : 'Delete draft'}
            </button>
          </div>
        </Modal>
      ) : null}
      {dialog === 'leave' ? (
        <Modal title="Leave without saving?" onClose={() => setDialog(null)} testId="leave-dialog">
          <p>You have unsaved changes on this evaluation. If you leave now they are lost.</p>
          <div className="pf-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)} data-testid="leave-stay">
              Keep editing
            </button>
            <button type="button" className="btn btn-primary" onClick={() => navigate(BACK)} data-testid="leave-confirm">
              Leave
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

