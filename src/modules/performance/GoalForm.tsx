import { useState, type FormEvent } from 'react'
import { performanceApi, type Goal } from './api'
import { Alert } from '@/ui/Feedback'
import { Counter, FieldError } from './parts'
import { DEFAULT_LIMITS, parseServerError, validateGoal, type FieldErrors } from './logic'

/** Create (no `goal`) or edit text fields of an own goal. The server decides whether it may; this only validates. */
export function GoalForm({
  goal,
  limits = DEFAULT_LIMITS,
  onSaved,
  onCancel,
  onConflict,
}: {
  goal?: Goal
  limits?: typeof DEFAULT_LIMITS
  onSaved: (g: Goal) => void
  onCancel?: () => void
  onConflict?: (message: string) => void
}) {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [dueDate, setDueDate] = useState(goal?.due_date ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const editing = Boolean(goal)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const found = validateGoal({ title, description, due_date: dueDate }, limits)
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const res = goal
        ? await performanceApi.patchGoal(goal.goal_id, {
            title: title.trim(),
            description: description.trim(),
            due_date: dueDate.trim() || null,
            version: goal.version,
          })
        : await performanceApi.createGoal({ title: title.trim(), description: description.trim(), due_date: dueDate.trim() || null })
      onSaved(res.data)
      if (!goal) {
        setTitle('')
        setDescription('')
        setDueDate('')
      }
    } catch (err) {
      const info = parseServerError(err, editing ? 'The goal could not be saved.' : 'The goal could not be created.')
      if (info.status === 409 && goal) onConflict?.(info.detail)
      setErrors(info.fieldErrors)
      setFormError(info.detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="pf-form" onSubmit={submit} noValidate data-testid={editing ? 'goal-edit-form' : 'goal-form'}>
      <div className="pf-field">
        <label htmlFor={`goal-title-${goal?.goal_id ?? 'new'}`} className="pf-label">
          Title <span className="pf-req" aria-hidden="true">*</span>
        </label>
        <input
          id={`goal-title-${goal?.goal_id ?? 'new'}`}
          className="pf-input"
          value={title}
          maxLength={limits.goal_title_max + 40}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'goal-title-error' : undefined}
          data-testid="goal-title"
          autoComplete="off"
        />
        <div className="pf-help-row">
          <FieldError id="goal-title-error" message={errors.title} />
          <Counter value={title} max={limits.goal_title_max} />
        </div>
      </div>
      <div className="pf-field">
        <label htmlFor={`goal-desc-${goal?.goal_id ?? 'new'}`} className="pf-label">
          Description <span className="pf-opt">(optional)</span>
        </label>
        <textarea
          id={`goal-desc-${goal?.goal_id ?? 'new'}`}
          className="pf-input pf-textarea"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'goal-desc-error' : undefined}
          data-testid="goal-description"
        />
        <div className="pf-help-row">
          <FieldError id="goal-desc-error" message={errors.description} />
          <Counter value={description} max={limits.goal_description_max} />
        </div>
      </div>
      <div className="pf-field pf-field-narrow">
        <label htmlFor={`goal-due-${goal?.goal_id ?? 'new'}`} className="pf-label">
          Due date <span className="pf-opt">(optional)</span>
        </label>
        <input
          id={`goal-due-${goal?.goal_id ?? 'new'}`}
          type="date"
          className="pf-input"
          value={dueDate}
          min="2000-01-01"
          max="2100-12-31"
          onChange={(e) => setDueDate(e.target.value)}
          aria-invalid={errors.due_date ? true : undefined}
          aria-describedby={errors.due_date ? 'goal-due-error' : undefined}
          data-testid="goal-due"
        />
        <FieldError id="goal-due-error" message={errors.due_date} />
      </div>
      {formError ? (
        <div data-testid="goal-form-error">
          <Alert tone="danger">{formError}</Alert>
        </div>
      ) : null}
      <div className="pf-actions">
        {onCancel ? (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="goal-cancel">
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="goal-save">
          {busy ? 'Saving...' : editing ? 'Save details' : 'Create goal'}
        </button>
      </div>
    </form>
  )
}
