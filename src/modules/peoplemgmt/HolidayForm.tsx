import { useId, useState, type FormEvent } from 'react'
import { Alert } from '@/ui/Feedback'
import { type Holiday, type HolidayBody, holidaysApi, parseFailure } from './api'
import {
  HOLIDAY_NAME_MAX,
  HOLIDAY_TYPES,
  HOLIDAY_YEAR_MAX,
  HOLIDAY_YEAR_MIN,
  MONTH_NAMES,
  buildHolidayCreate,
  buildHolidayPatch,
  emptyHolidayForm,
  failureMessage,
  formFromHoliday,
  validateHolidayForm,
  type FieldErrors,
  type HolidayForm as Form,
} from './logic'
import { Field } from './parts'

/** Add or edit one holiday. The service has the last word on every rule (duplicates are a 409 shown here). */
export function HolidayFormCard({
  holiday,
  year,
  onSaved,
  onCancel,
}: {
  holiday: Holiday | null
  year: number
  onSaved: (saved: Holiday, message: string) => void
  onCancel: () => void
}) {
  const uid = useId().replace(/:/g, '')
  const id = (n: string) => `hol-${uid}-${n}`
  const [form, setForm] = useState<Form>(() => (holiday ? formFromHoliday(holiday, year) : emptyHolidayForm(year)))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))
  const editing = holiday !== null && holiday.holiday_id !== null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const local = validateHolidayForm(form)
    if (Object.keys(local).length) {
      setErrors(local)
      setBanner('Please fix the highlighted fields.')
      return
    }
    let body: HolidayBody
    if (editing && holiday) {
      body = buildHolidayPatch(holiday, form)
      if (Object.keys(body).length === 0) {
        onCancel()
        return
      }
    } else {
      body = buildHolidayCreate(form)
    }
    setBusy(true)
    setErrors({})
    setBanner(null)
    try {
      const saved = editing && holiday?.holiday_id ? await holidaysApi.update(holiday.holiday_id, body) : await holidaysApi.create(body)
      onSaved({ ...saved, date_in_year: saved.date ?? null }, editing ? 'Holiday saved.' : 'Holiday added.')
    } catch (err) {
      const f = parseFailure(err)
      if (f.status === 422 && f.field && ['name', 'date', 'month', 'day'].includes(f.field)) {
        setErrors({ [f.field === 'day' ? 'month' : f.field]: f.detail ?? 'This value was not accepted.' })
        setBanner(null)
      } else {
        setBanner(failureMessage(f, editing ? 'The holiday could not be saved.' : 'The holiday could not be added.'))
      }
      setBusy(false)
    }
  }

  const dayMax = form.month === '2' ? 29 : [4, 6, 9, 11].includes(Number(form.month)) ? 30 : 31

  return (
    <form className="card card-pad pm-card-section pm-holiday-form" onSubmit={submit} noValidate aria-busy={busy} aria-labelledby={id('h')} data-testid="holiday-form">
      <h2 className="pm-h2" id={id('h')}>
        {editing ? 'Edit holiday' : 'Add holiday'}
      </h2>
      {banner ? (
        <div className="pm-banner" data-testid="holiday-form-error">
          <Alert tone="danger">{banner}</Alert>
        </div>
      ) : null}
      <div className="pm-grid">
        <div className="pm-span-2">
          <Field id={id('name')} label="Name" required error={errors.name} testId="field-holiday-name">
            {(a) => <input {...a} className="pm-input" type="text" value={form.name} maxLength={HOLIDAY_NAME_MAX + 40} disabled={busy} autoComplete="off" onChange={(e) => set('name', e.target.value)} data-testid="holiday-name" />}
          </Field>
        </div>
        <Field id={id('type')} label="Type" required testId="field-holiday-type">
          {(a) => (
            <select {...a} className="pm-input" value={form.type} disabled={busy} onChange={(e) => set('type', e.target.value as Form['type'])} data-testid="holiday-type">
              {HOLIDAY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <fieldset className="pm-fieldset pm-fieldset-flat" disabled={busy}>
          <legend className="pm-label">Repeats</legend>
          <label className="pm-radio" htmlFor={id('once')}>
            <input id={id('once')} type="radio" name={id('rep')} checked={!form.recurring} onChange={() => set('recurring', false)} data-testid="holiday-once" />
            <span>One date only</span>
          </label>
          <label className="pm-radio" htmlFor={id('yearly')}>
            <input id={id('yearly')} type="radio" name={id('rep')} checked={form.recurring} onChange={() => set('recurring', true)} data-testid="holiday-yearly" />
            <span>Every year on the same day</span>
          </label>
        </fieldset>
        {form.recurring ? (
          <>
            <Field id={id('month')} label="Month" required error={errors.month} testId="field-holiday-month">
              {(a) => (
                <select {...a} className="pm-input" value={form.month} disabled={busy} onChange={(e) => set('month', e.target.value)} data-testid="holiday-month">
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={String(i + 1)}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field id={id('day')} label="Day" required help="29 February is allowed: it falls on 28 February in other years." testId="field-holiday-day">
              {(a) => (
                <select {...a} className="pm-input" value={form.day} disabled={busy} onChange={(e) => set('day', e.target.value)} data-testid="holiday-day">
                  {Array.from({ length: dayMax }, (_, i) => String(i + 1)).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  {Number(form.day) > dayMax ? <option value={form.day}>{form.day}</option> : null}
                </select>
              )}
            </Field>
          </>
        ) : (
          <Field id={id('date')} label="Date" required error={errors.date} help={`From ${HOLIDAY_YEAR_MIN} to ${HOLIDAY_YEAR_MAX}.`} testId="field-holiday-date">
            {(a) => <input {...a} className="pm-input" type="date" min={`${HOLIDAY_YEAR_MIN}-01-01`} max={`${HOLIDAY_YEAR_MAX}-12-31`} value={form.date} disabled={busy} onChange={(e) => set('date', e.target.value)} data-testid="holiday-date" />}
          </Field>
        )}
      </div>
      <label className="pm-check pm-check-box" htmlFor={id('active')}>
        <input id={id('active')} type="checkbox" checked={form.active} disabled={busy} onChange={(e) => set('active', e.target.checked)} data-testid="holiday-active" />
        <span>
          <strong>Active</strong>
          <span className="pm-help">An inactive holiday is kept on the list but is not counted in the calendar or in leave day-counting.</span>
        </span>
      </label>
      <div className="pm-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="save-holiday">
          {busy ? 'Saving...' : editing ? 'Save holiday' : 'Add holiday'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="cancel-holiday">
          Cancel
        </button>
      </div>
    </form>
  )
}
