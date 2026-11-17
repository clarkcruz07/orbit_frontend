import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { FileX } from 'lucide-react'
import { formatDate } from '@/lib/dates'
import { Alert } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { PageTitle } from '@/pages/PageTitle'
import { performanceApi, type Goal, type GoalStatus } from './api'
import { GoalForm } from './GoalForm'
import { useLoad, usePerfConfig } from './hooks'
import { BackLink, Counter, ErrorBlock, FieldError, GoalStatusPill, LoadingCard, Pill, ProgressBar } from './parts'
import {
  PROGRESS_STEPS,
  canCommentGoal,
  canEditGoal,
  clampProgress,
  formatDateTime,
  goalStatusChoices,
  goalStatusLabel,
  parseServerError,
  personName,
  statusAfterProgress,
  validateComment,
} from './logic'
import './performance.css'

export function GoalDetail() {
  const { id = '' } = useParams()
  const cfg = usePerfConfig()
  const load = useLoad(() => performanceApi.goal(id).then((r) => r.data), [id], 'The goal could not be loaded.')
  const goal = load.data
  const [banner, setBanner] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)

  if (load.error && !goal) {
    const gone = load.error.status === 404
    return (
      <div className="page pf-page" data-testid="goal-detail-error">
        <BackLink to="/performance?tab=goals">Back to goals</BackLink>
        {gone ? (
          <EmptyState icon={<FileX size={28} />} title="Goal not found" body="This goal does not exist, or you do not have access to it." />
        ) : (
          <ErrorBlock message={load.error.detail} onRetry={load.reload} />
        )}
      </div>
    )
  }
  if (!goal) {
    return (
      <div className="page pf-page" data-testid="goal-detail-loading">
        <BackLink to="/performance?tab=goals">Back to goals</BackLink>
        <LoadingCard rows={4} />
      </div>
    )
  }

  const editable = canEditGoal(goal)
  const back = editable ? '/performance?tab=goals' : '/performance?tab=team&view=goals'

  return (
    <div className="page pf-page" data-testid="goal-detail" data-id={goal.goal_id}>
      <BackLink to={back}>{editable ? 'Back to my goals' : 'Back to team'}</BackLink>
      <PageTitle title={goal.title} subtitle={editable ? 'Your goal' : `${personName(goal.employee)}'s goal`} />
      {banner ? (
        <div className="pf-flash-block" data-testid="goal-banner">
          <Alert tone={banner.tone}>{banner.text}</Alert>
        </div>
      ) : null}

      <div className="pf-detail-grid">
        <div className="pf-col">
          <section className="card card-pad" aria-labelledby="goal-summary-title">
            <div className="pf-card-head">
              <h2 id="goal-summary-title">Summary</h2>
              <div className="pf-row-pills">
                <GoalStatusPill status={goal.status} />
                {goal.overdue ? (
                  <Pill tone="red" testId="goal-overdue">
                    Overdue
                  </Pill>
                ) : null}
              </div>
            </div>
            <dl className="pf-facts">
              <div>
                <dt>Owner</dt>
                <dd data-testid="goal-owner">
                  {personName(goal.employee)}
                  {goal.employee.department ? ` - ${goal.employee.department}` : ''}
                </dd>
              </div>
              <div>
                <dt>Due date</dt>
                <dd data-testid="goal-due-date">{goal.due_date ? formatDate(goal.due_date) : 'No due date'}</dd>
              </div>
              <div>
                <dt>Progress</dt>
                <dd>
                  <div className="pf-row-progress">
                    <ProgressBar value={goal.progress} label="Goal progress" />
                    <span className="pf-progress-num" data-testid="goal-progress">
                      {goal.progress}%
                    </span>
                  </div>
                </dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{formatDateTime(goal.updated_at)}</dd>
              </div>
            </dl>
            {goal.description ? (
              <>
                <h3 className="pf-subhead">Description</h3>
                <p className="pf-text" data-testid="goal-description-text">
                  {goal.description}
                </p>
              </>
            ) : (
              <p className="pf-muted">No description.</p>
            )}
          </section>

          <CommentThread goal={goal} cfg={cfg} onUpdated={load.setData} onConflict={(m) => { setBanner({ tone: 'info', text: m }); load.reload() }} />
        </div>

        <div className="pf-col">
          {editable ? (
            <GoalControls
              goal={goal}
              limits={cfg.limits}
              onUpdated={(g, text) => {
                load.setData(g)
                setBanner({ tone: 'info', text })
              }}
              onConflict={(m) => {
                setBanner({ tone: 'danger', text: `${m} The latest version has been loaded; please try again.` })
                load.reload()
              }}
            />
          ) : (
            <section className="card card-pad" data-testid="goal-readonly">
              <h2>Read-only</h2>
              <p className="pf-help">Only the owner can change this goal.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function GoalControls({
  goal,
  limits,
  onUpdated,
  onConflict,
}: {
  goal: Goal
  limits: ReturnType<typeof usePerfConfig>['limits']
  onUpdated: (g: Goal, text: string) => void
  onConflict: (message: string) => void
}) {
  const [progress, setProgress] = useState(goal.progress)
  const [status, setStatus] = useState<GoalStatus>(goal.status)
  const [busy, setBusy] = useState<null | 'progress' | 'status'>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  // Re-sync the controls when the server copy changes (save, reload after a conflict).
  const [seen, setSeen] = useState(goal.version)
  if (seen !== goal.version) {
    setSeen(goal.version)
    setProgress(goal.progress)
    setStatus(goal.status)
  }

  const dropped = goal.status === 'dropped'
  const next = statusAfterProgress(goal, progress)

  async function save(kind: 'progress' | 'status') {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      const body = kind === 'progress' ? { progress, version: goal.version } : { status, version: goal.version }
      const res = await performanceApi.patchGoal(goal.goal_id, body)
      onUpdated(res.data, kind === 'progress' ? `Progress saved: ${res.data.progress}% (${goalStatusLabel(res.data.status)}).` : `Status saved: ${goalStatusLabel(res.data.status)}.`)
    } catch (e) {
      const info = parseServerError(e, 'The goal could not be updated.')
      if (info.status === 409) onConflict(info.detail)
      else setError(info.detail)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <section className="card card-pad" aria-labelledby="goal-progress-title" data-testid="goal-progress-card">
        <h2 id="goal-progress-title">Progress</h2>
        {dropped ? <p className="pf-help" data-testid="goal-dropped-note">This goal is dropped. Reopen it by choosing a status below before changing its progress.</p> : null}
        <div className="pf-slider-row">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            disabled={dropped || busy !== null}
            onChange={(e) => setProgress(clampProgress(Number(e.target.value)))}
            aria-label="Progress percent"
            aria-valuetext={`${progress} percent`}
            className="pf-slider"
            data-testid="progress-slider"
          />
          <output className="pf-slider-value" data-testid="progress-value">
            {progress}%
          </output>
        </div>
        <div className="pf-steps" role="group" aria-label="Progress steps">
          {PROGRESS_STEPS.map((s) => (
            <button
              key={s}
              type="button"
              className={`pf-step${progress === s ? ' active' : ''}`}
              onClick={() => setProgress(s)}
              disabled={dropped || busy !== null}
              aria-pressed={progress === s}
              data-testid={`progress-step-${s}`}
            >
              {s}%
            </button>
          ))}
        </div>
        {!dropped && next && progress !== goal.progress ? (
          <p className="pf-help" data-testid="progress-preview">
            Saving sets the status to {goalStatusLabel(next)}.
          </p>
        ) : null}
        <div className="pf-actions">
          <button type="button" className="btn btn-primary" onClick={() => save('progress')} disabled={dropped || busy !== null || progress === goal.progress} data-testid="progress-save">
            {busy === 'progress' ? 'Saving...' : 'Save progress'}
          </button>
        </div>
      </section>

      <section className="card card-pad" aria-labelledby="goal-status-title">
        <h2 id="goal-status-title">Status</h2>
        <div className="pf-field">
          <label htmlFor="goal-status-select" className="pf-label">
            Change status
          </label>
          <select id="goal-status-select" className="pf-input pf-select" value={status} onChange={(e) => setStatus(e.target.value as GoalStatus)} disabled={busy !== null} data-testid="status-select">
            {goalStatusChoices(goal).map((s) => (
              <option key={s} value={s}>
                {goalStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="pf-actions">
          <button type="button" className="btn btn-secondary" onClick={() => save('status')} disabled={busy !== null || status === goal.status} data-testid="status-save">
            {busy === 'status' ? 'Saving...' : 'Save status'}
          </button>
        </div>
        {error ? (
          <div data-testid="goal-control-error">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
      </section>

      <section className="card card-pad" aria-labelledby="goal-edit-title">
        <h2 id="goal-edit-title">Title, description and due date</h2>
        {editing ? (
          <GoalForm
            goal={goal}
            limits={limits}
            onCancel={() => setEditing(false)}
            onConflict={onConflict}
            onSaved={(g) => {
              setEditing(false)
              onUpdated(g, 'Goal details saved.')
            }}
          />
        ) : (
          <div className="pf-actions pf-actions-left">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)} data-testid="goal-edit">
              Edit details
            </button>
          </div>
        )}
      </section>
    </>
  )
}

function CommentThread({
  goal,
  cfg,
  onUpdated,
  onConflict,
}: {
  goal: Goal
  cfg: ReturnType<typeof usePerfConfig>
  onUpdated: (g: Goal) => void
  onConflict: (message: string) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const comments = goal.comments ?? []
  const may = canCommentGoal(goal)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const problem = validateComment(text, cfg.limits.comment_max)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const res = await performanceApi.commentGoal(goal.goal_id, text.trim())
      onUpdated(res.data)
      setText('')
    } catch (err) {
      const info = parseServerError(err, 'The comment could not be added.')
      if (info.status === 409) onConflict(info.detail)
      else setError(info.detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card card-pad" aria-labelledby="comments-title" data-testid="comments">
      <h2 id="comments-title">Manager comments</h2>
      {comments.length === 0 ? (
        <p className="pf-muted" data-testid="no-comments">
          No comments yet.
        </p>
      ) : (
        <ol className="pf-comments">
          {comments.map((c) => (
            <li key={c.comment_id} className="pf-comment" data-testid="comment">
              <div className="pf-comment-head">
                <strong>{c.by.name ?? c.by.employee_id}</strong>
                <span className="pf-muted">{formatDateTime(c.at)}</span>
              </div>
              <p className="pf-text">{c.text}</p>
            </li>
          ))}
        </ol>
      )}
      {may ? (
        <form onSubmit={submit} noValidate className="pf-form pf-comment-form" data-testid="comment-form">
          <label htmlFor="comment-text" className="pf-label">
            Add a comment
          </label>
          <textarea
            id="comment-text"
            className="pf-input pf-textarea"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'comment-error' : undefined}
            data-testid="comment-text"
          />
          <div className="pf-help-row">
            <FieldError id="comment-error" message={error} />
            <Counter value={text} max={cfg.limits.comment_max} />
          </div>
          <div className="pf-actions">
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="comment-submit">
              {busy ? 'Posting...' : 'Post comment'}
            </button>
          </div>
        </form>
      ) : (
        <p className="pf-help" data-testid="comment-readonly">
          Only the owner's manager can comment, and the thread is read-only for everyone else.
        </p>
      )}
    </section>
  )
}
