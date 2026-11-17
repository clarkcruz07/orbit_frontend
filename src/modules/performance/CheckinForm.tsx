import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/ui/Feedback'
import { performanceApi, type Checkin } from './api'
import { Counter, FieldError } from './parts'
import { DEFAULT_LIMITS, MOOD_LABELS, parseServerError, validateCheckin, type FieldErrors, type ServerErrorInfo } from './logic'

/**
 * Employee check-in form. Without `fill` it creates a new submitted check-in (period label needed); with `fill` it
 * fills in a manager-requested one (the period is fixed by the request). Submitted check-ins are immutable, so there
 * is no "edit" mode.
 */
export function CheckinForm({
  fill,
  limits = DEFAULT_LIMITS,
  onSaved,
  onCancel,
  onStale,
}: {
  fill?: Checkin
  limits?: typeof DEFAULT_LIMITS
  onSaved: (c: Checkin) => void
  onCancel?: () => void
  onStale?: () => void
}) {
  const [period, setPeriod] = useState('')
  const [accomplishments, setAccomplishments] = useState('')
  const [blockers, setBlockers] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [mood, setMood] = useState<number | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [server, setServer] = useState<ServerErrorInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const key = fill?.checkin_id ?? 'new'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const found = validateCheckin({ period_label: period, accomplishments, blockers, next_steps: nextSteps, mood }, { needsPeriod: !fill, limits })
    setErrors(found)
    setServer(null)
    if (Object.keys(found).length) return
    setBusy(true)
    const texts = { accomplishments: accomplishments.trim(), blockers: blockers.trim(), next_steps: nextSteps.trim(), mood }
    try {
      const res = fill ? await performanceApi.fillCheckin(fill.checkin_id, texts) : await performanceApi.createCheckin({ period_label: period.trim(), ...texts })
      onSaved(res.data)
    } catch (err) {
      const info = parseServerError(err, 'The check-in could not be submitted.')
      if (info.status === 409 && fill) onStale?.()
      setErrors(info.fieldErrors)
      setServer(info)
    } finally {
      setBusy(false)
    }
  }

  const text = (id: 'accomplishments' | 'blockers' | 'next_steps', label: string, value: string, set: (v: string) => void, hint: string) => (
    <div className="pf-field">
      <label htmlFor={`${key}-${id}`} className="pf-label">
        {label}
      </label>
      <textarea
        id={`${key}-${id}`}
        className="pf-input pf-textarea"
        rows={4}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={hint}
        aria-invalid={errors[id] ? true : undefined}
        aria-describedby={errors[id] ? `${key}-${id}-error` : undefined}
        data-testid={`checkin-${id}`}
      />
      <div className="pf-help-row">
        <FieldError id={`${key}-${id}-error`} message={errors[id]} />
        <Counter value={value} max={limits.checkin_text_max} />
      </div>
    </div>
  )

  return (
    <form className="pf-form" onSubmit={submit} noValidate data-testid={fill ? 'checkin-fill-form' : 'checkin-form'}>
      {fill ? (
        <p className="pf-help">
          Period: <strong>{fill.period_label}</strong> (set by the request)
        </p>
      ) : (
        <div className="pf-field pf-field-narrow">
          <label htmlFor={`${key}-period`} className="pf-label">
            Period <span className="pf-req" aria-hidden="true">*</span>
          </label>
          <input
            id={`${key}-period`}
            className="pf-input"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="e.g. 2027-Q1 or Week 12"
            maxLength={limits.period_label_max + 20}
            aria-invalid={errors.period_label ? true : undefined}
            aria-describedby={errors.period_label ? `${key}-period-error` : undefined}
            data-testid="checkin-period"
            autoComplete="off"
          />
          <FieldError id={`${key}-period-error`} message={errors.period_label} />
        </div>
      )}
      {text('accomplishments', 'Accomplishments', accomplishments, setAccomplishments, 'What went well since the last check-in?')}
      {text('blockers', 'Blockers', blockers, setBlockers, 'What is getting in the way?')}
      {text('next_steps', 'Next steps', nextSteps, setNextSteps, 'What will you focus on next?')}
      {errors.texts ? <FieldError id={`${key}-texts-error`} message={errors.texts} /> : null}

      <fieldset className="pf-field pf-mood" data-testid="mood-field">
        <legend className="pf-label">
          Mood <span className="pf-opt">(optional, 1 to 5; only you and your manager see it unless HR is allowed to)</span>
        </legend>
        <div className="pf-mood-options">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={`pf-mood-option${mood === n ? ' active' : ''}`}>
              <input type="radio" name={`${key}-mood`} value={n} checked={mood === n} onChange={() => setMood(n)} data-testid={`mood-${n}`} />
              <span className="pf-mood-num">{n}</span>
              <span className="pf-mood-word">{MOOD_LABELS[n]}</span>
            </label>
          ))}
          {mood !== null ? (
            <button type="button" className="pf-linkbtn" onClick={() => setMood(null)} data-testid="mood-clear">
              Clear
            </button>
          ) : null}
        </div>
        <FieldError id={`${key}-mood-error`} message={errors.mood} />
      </fieldset>

      {server ? (
        <div data-testid="checkin-form-error">
          <Alert tone="danger">
            {server.detail}
            {server.existingCheckinId ? (
              <>
                {' '}
                <Link to={`/performance/checkins/${encodeURIComponent(server.existingCheckinId)}`} className="pf-inline-link" data-testid="existing-checkin-link">
                  Open the existing check-in
                </Link>
              </>
            ) : null}
          </Alert>
        </div>
      ) : null}
      <div className="pf-actions">
        {onCancel ? (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="checkin-cancel">
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="checkin-submit">
          {busy ? 'Submitting...' : 'Submit check-in'}
        </button>
      </div>
      <p className="pf-help">A submitted check-in cannot be edited. It is sent to the reviewer, who can acknowledge it with feedback.</p>
    </form>
  )
}
