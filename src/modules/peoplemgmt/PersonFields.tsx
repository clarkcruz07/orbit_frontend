import { useId } from 'react'
import { EMPLOYMENT_OPTIONS, NAME_MAX, START_DATE_MIN, TEXT_MAX, startDateMax, type FieldErrors, type PersonForm } from './logic'
import { Field, ManagerPicker } from './parts'

export const BIRTHDAY_HELP = 'Month and day only, like 03-27. No year is stored or shown anywhere.'
export const EMAIL_LOCKED_NOTE = "This person's email address is set by configuration, so it cannot be changed here."

/** The fields shared by "Add person" and "Edit details". */
export function PersonFields({
  form,
  onChange,
  errors,
  disabled,
  now,
  selfId,
  emailLocked,
  prefix = 'pf',
}: {
  form: PersonForm
  onChange: (next: PersonForm) => void
  errors: FieldErrors
  disabled?: boolean
  now: Date
  /** The person being edited (cannot be their own manager). */
  selfId?: string | null
  emailLocked?: boolean
  prefix?: string
}) {
  const uid = useId().replace(/:/g, '')
  const id = (n: string) => `${prefix}-${uid}-${n}`
  const set = <K extends keyof PersonForm>(key: K, value: PersonForm[K]) => onChange({ ...form, [key]: value })

  return (
    <div className="pm-grid" data-testid="person-fields">
      <Field id={id('name')} label="Full name" required error={errors.name} testId="field-name">
        {(a) => <input {...a} className="pm-input" type="text" value={form.name} maxLength={NAME_MAX + 40} disabled={disabled} autoComplete="off" onChange={(e) => set('name', e.target.value)} data-testid="input-name" />}
      </Field>
      <Field
        id={id('email')}
        label="Work email"
        required
        error={errors.email}
        help={emailLocked ? EMAIL_LOCKED_NOTE : 'Stored in lower case. It must not be used by another person or account.'}
        testId="field-email"
      >
        {(a) => <input {...a} className="pm-input" type="email" value={form.email} disabled={disabled || emailLocked} autoComplete="off" onChange={(e) => set('email', e.target.value)} data-testid="input-email" />}
      </Field>
      <Field id={id('title')} label="Job title" required error={errors.job_title} testId="field-job_title">
        {(a) => <input {...a} className="pm-input" type="text" value={form.job_title} maxLength={TEXT_MAX + 40} disabled={disabled} autoComplete="off" onChange={(e) => set('job_title', e.target.value)} data-testid="input-job_title" />}
      </Field>
      <Field id={id('dept')} label="Department" required error={errors.department} testId="field-department">
        {(a) => <input {...a} className="pm-input" type="text" value={form.department} maxLength={TEXT_MAX + 40} disabled={disabled} autoComplete="off" onChange={(e) => set('department', e.target.value)} data-testid="input-department" />}
      </Field>
      <Field id={id('type')} label="Employment type" required error={errors.employment_type} testId="field-employment_type">
        {(a) => (
          <select {...a} className="pm-input" value={form.employment_type} disabled={disabled} onChange={(e) => set('employment_type', e.target.value)} data-testid="input-employment_type">
            {EMPLOYMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {form.employment_type && !EMPLOYMENT_OPTIONS.some((o) => o.value === form.employment_type) ? <option value={form.employment_type}>{form.employment_type}</option> : null}
          </select>
        )}
      </Field>
      <Field id={id('start')} label="Start date" optional error={errors.start_date} help="Allowed from 1950 to two years ahead." testId="field-start_date">
        {(a) => <input {...a} className="pm-input" type="date" value={form.start_date} min={START_DATE_MIN} max={startDateMax(now)} disabled={disabled} onChange={(e) => set('start_date', e.target.value)} data-testid="input-start_date" />}
      </Field>
      <Field id={id('bday')} label="Birthday (MM-DD)" optional error={errors.birthday} help={BIRTHDAY_HELP} testId="field-birthday">
        {(a) => <input {...a} className="pm-input" type="text" inputMode="numeric" placeholder="MM-DD" maxLength={5} value={form.birthday} disabled={disabled} autoComplete="off" onChange={(e) => set('birthday', e.target.value)} data-testid="input-birthday" />}
      </Field>
      <div className="pm-span-2">
        <Field
          id={id('mgr')}
          label="Manager"
          optional
          error={errors.manager_id}
          help="Search the directory. Only active people are offered. Leave empty for no manager."
          testId="field-manager"
        >
          {(a) => (
            <ManagerPicker id={a.id} value={form.manager} onChange={(m) => set('manager', m)} exclude={selfId ? [selfId] : []} disabled={disabled} describedBy={a['aria-describedby']} invalid={Boolean(errors.manager_id)} />
          )}
        </Field>
      </div>
    </div>
  )
}
