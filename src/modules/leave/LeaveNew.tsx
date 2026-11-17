import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, CalendarOff } from 'lucide-react'
import { PageTitle } from '@/pages/PageTitle'
import { Alert, Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { leaveApi } from './api'
import { ConflictLink, LeaveForm } from './LeaveForm'
import { EMPTY_FORM, fieldForCode, friendlyError, parseLeaveError, toCreateBody, validateForm, type FormErrors, type FormValues } from './logic'
import { useLeaveConfig, useLeaveTypes } from './parts'
import '@/pages/pages.css'
import './leave.css'

/** `leave/new`: type, dates, optional half day and reason, with a live day count from `/leave/preview`. */
export function LeaveNew() {
  const navigate = useNavigate()
  const { config, today } = useLeaveConfig()
  const { types, error: typesError, reload } = useLeaveTypes()
  const [values, setValues] = useState<FormValues>(EMPTY_FORM)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<{ message: string; conflictingId: string | null } | null>(null)
  const [serverFields, setServerFields] = useState<FormErrors>({})
  const formRef = useRef<HTMLFormElement>(null)

  const ctx = useMemo(
    () => ({ types: types ?? [], today, windowDays: config?.window_days, maxSpan: config?.max_span_days, reasonMax: config?.reason_max_chars }),
    [types, today, config],
  )
  const errors = useMemo(() => validateForm(values, ctx), [values, ctx])
  const shown: FormErrors = attempted ? { ...serverFields, ...errors } : serverFields

  // After a refused submit, move focus to the first invalid field.
  useEffect(() => {
    if (!attempted) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [attempted])

  function onChange(next: FormValues) {
    setValues(next)
    setServerError(null)
    setServerFields({})
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setServerError(null)
    if (Object.keys(errors).length > 0) {
      setAttempted(true)
      // Make sure the effect fires again for a second refused attempt.
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    setBusy(true)
    try {
      const created = await leaveApi.create(toCreateBody(values))
      navigate(`/leave/${created.request_id}`, { replace: true, state: { flash: 'created' } })
    } catch (err) {
      const info = parseLeaveError(err, 'The leave request could not be sent.')
      const field = fieldForCode(info.code)
      setServerError({ message: friendlyError(info), conflictingId: info.conflictingId })
      const fields: FormErrors = {}
      for (const [k, v] of Object.entries(info.fieldErrors)) if (v) fields[k as keyof FormErrors] = v
      if (field && !fields[field]) fields[field] = friendlyError(info)
      setServerFields(fields)
      setBusy(false)
    }
  }

  return (
    <div className="page lv-page" data-testid="leave-new">
      <p className="lv-back">
        <Link to="/leave" className="lv-back-link">
          <ArrowLeft size={16} aria-hidden="true" /> Back to leave
        </Link>
      </p>
      <PageTitle title="New leave request" subtitle="Choose the type and dates. You will see the day count before you send it." />

      {typesError ? (
        <div data-testid="types-error">
          <Alert tone="danger">The leave types could not be loaded.</Alert>
          <button type="button" className="btn btn-secondary lv-retry" onClick={reload}>
            Try again
          </button>
        </div>
      ) : types === null ? (
        <div className="card card-pad" aria-busy="true" data-testid="form-loading">
          <span className="sr-only" role="status">
            Loading the form
          </span>
          <Skeleton style={{ height: 18, width: '30%', marginBottom: 14 }} />
          <Skeleton style={{ height: 40, marginBottom: 12 }} />
          <Skeleton style={{ height: 40 }} />
        </div>
      ) : types.length === 0 ? (
        <EmptyState icon={<CalendarOff size={28} />} title="No leave types are available" body="HR has not set up any leave types you can request yet." />
      ) : (
        <form ref={formRef} className="card card-pad lv-form" onSubmit={onSubmit} noValidate data-testid="leave-form">
          <LeaveForm values={values} onChange={onChange} errors={shown} types={types} ctx={ctx} disabled={busy} />
          {serverError ? (
            <div className="lv-form-error" data-testid="form-error">
              <Alert tone="danger">
                {serverError.message}
                {serverError.conflictingId ? (
                  <>
                    {' '}
                    <ConflictLink id={serverError.conflictingId} />
                  </>
                ) : null}
              </Alert>
            </div>
          ) : attempted && Object.keys(errors).length > 0 ? (
            <div className="lv-form-error" data-testid="form-error">
              <Alert tone="danger">Some values need attention before the request can be sent.</Alert>
            </div>
          ) : null}
          <div className="lv-actions">
            <Link to="/leave" className="btn btn-secondary" data-testid="leave-cancel-new">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="leave-submit">
              {busy ? 'Sending...' : 'Submit request'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
