import { useId, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { PROFILE_SECTIONS, type EmployeeProfile, type ProfilePatch, type ProfileSection } from '@/api/profile'
import { Alert } from '@/ui/Feedback'
import { formatDate } from '@/lib/dates'
import { parseFailure } from './api'
import { failureMessage, fieldErrorsText, type FieldErrors } from './logic'
import {
  HR_ONLY_NOTE,
  SECTION_FIELDS,
  SENSITIVE_NOTE,
  buildSectionPatch,
  buildSelfStatutoryPatch,
  isMasked,
  maskNumber,
  sectionErrors,
  sectionFormFromProfile,
  sectionHasValue,
  sectionOfError,
  sectionRows,
  selfFields,
  validateSection,
  type FieldSpec,
  type ProfileForm,
  type SectionForm,
} from './profileLogic'
import { Field } from './parts'

const slug = (key: string) => key.replace(/\./g, '-')

/** Extra behaviour for the person's OWN government IDs: the server only sends masked values, so the inputs start empty and a key can be cleared. */
export interface SelfStatutory {
  existing: Record<string, string>
  cleared: Record<string, boolean>
  onToggleClear: (key: string) => void
}

/** The inputs of one profile section. `errors` is keyed by the field key inside the section ("address.city"). */
export function ProfileFields({
  section,
  form,
  onChange,
  errors,
  disabled,
  prefix,
  fields = SECTION_FIELDS[section],
  selfStatutory,
}: {
  section: ProfileSection
  form: SectionForm
  onChange: (next: SectionForm) => void
  errors: FieldErrors
  disabled?: boolean
  prefix: string
  fields?: readonly FieldSpec[]
  selfStatutory?: SelfStatutory
}) {
  const uid = useId().replace(/:/g, '')
  const set = (key: string, value: string) => onChange({ ...form, [key]: value })
  return (
    <div className="pm-grid" data-testid={`profile-fields-${section}`}>
      {fields.map((spec) => (
        <div key={spec.key} className={spec.span === 2 ? 'pm-span-2' : undefined}>
          <ProfileInput
            spec={spec}
            section={section}
            id={`${prefix}-${uid}-${slug(spec.key)}`}
            value={form[spec.key] ?? ''}
            error={errors[spec.key]}
            disabled={disabled || Boolean(selfStatutory?.cleared[spec.key])}
            placeholder={selfStatutory ? (selfStatutory.cleared[spec.key] ? 'Will be cleared' : 'Enter to replace') : undefined}
            onChange={(v) => set(spec.key, v)}
          />
          {selfStatutory && selfStatutory.existing[spec.key] ? (
            <p className="pm-clear-row">
              <span className="pm-sub" data-testid={`current-profile-${section}-${slug(spec.key)}`}>
                On file: {selfStatutory.existing[spec.key]}
              </span>
              <button
                type="button"
                className="btn btn-secondary pm-clear-btn"
                aria-pressed={Boolean(selfStatutory.cleared[spec.key])}
                disabled={disabled}
                onClick={() => selfStatutory.onToggleClear(spec.key)}
                data-testid={`clear-profile-${section}-${slug(spec.key)}`}
              >
                {selfStatutory.cleared[spec.key] ? 'Undo clear' : 'Clear'}
              </button>
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ProfileInput({
  spec,
  section,
  id,
  value,
  error,
  disabled,
  placeholder,
  onChange,
}: {
  spec: FieldSpec
  section: ProfileSection
  id: string
  value: string
  error?: string
  disabled?: boolean
  placeholder?: string
  onChange: (v: string) => void
}) {
  const tid = `${section}-${slug(spec.key)}`
  return (
    <Field id={id} label={spec.label} optional help={spec.help} error={error} testId={`field-profile-${tid}`}>
      {(a) => {
        if (spec.kind === 'select') {
          return (
            <select {...a} className="pm-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={`input-profile-${tid}`}>
              <option value="">Not provided</option>
              {(spec.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {value && !(spec.options ?? []).some((o) => o.value === value) ? <option value={value}>{value}</option> : null}
            </select>
          )
        }
        const type = spec.kind === 'date' ? 'date' : spec.kind === 'email' ? 'email' : spec.kind === 'phone' ? 'tel' : 'text'
        const inputMode = spec.kind === 'id' || spec.kind === 'year' ? 'numeric' : spec.kind === 'phone' ? 'tel' : undefined
        return (
          <input
            {...a}
            className="pm-input"
            type={type}
            inputMode={inputMode}
            value={value}
            maxLength={spec.kind === 'date' ? undefined : spec.kind === 'year' ? 4 : (spec.max ?? 120) + 40}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            data-testid={`input-profile-${tid}`}
          />
        )
      }}
    </Field>
  )
}

// ------------------------------------------------------------------------------------------------ Add person: optional sections
/** The five optional profile sections under "Add person": each closed by default; a section with an error opens by itself. */
export function ProfileNewSections({ form, onChange, errors, disabled }: { form: ProfileForm; onChange: (next: ProfileForm) => void; errors: FieldErrors; disabled?: boolean }) {
  const [open, setOpen] = useState<Partial<Record<ProfileSection, boolean>>>({})
  const hasError = (s: ProfileSection) => Object.keys(errors).some((k) => sectionOfError(k) === s)
  return (
    <div className="pm-collapses" data-testid="profile-new">
      {PROFILE_SECTIONS.map((s) => {
        const isOpen = Boolean(open[s.id]) || hasError(s.id)
        return (
          <details
            key={s.id}
            className="pm-collapse"
            open={isOpen}
            onToggle={(e) => {
              const nowOpen = (e.currentTarget as HTMLDetailsElement).open // read it NOW: currentTarget is gone by the time the updater runs
              setOpen((o) => ({ ...o, [s.id]: nowOpen }))
            }}
            data-testid={`profile-new-${s.id}`}
          >
            <summary className="pm-collapse-summary" data-testid={`toggle-profile-${s.id}`}>
              <span className="pm-collapse-title">
                {s.id === 'statutory' ? <Lock size={15} aria-hidden="true" /> : null} {s.title}
                {sectionHasValue(form[s.id]) ? <span className="pm-collapse-dot" aria-label="Has details" title="Has details" /> : null}
              </span>
              <span className="pm-collapse-hint">{s.hint}</span>
            </summary>
            <div className="pm-collapse-body">
              {s.id === 'statutory' ? <p className="pm-sensitive" data-testid="profile-new-sensitive">{SENSITIVE_NOTE}</p> : null}
              <ProfileFields
                section={s.id}
                form={form[s.id]}
                onChange={(next) => onChange({ ...form, [s.id]: next })}
                errors={sectionErrors(errors, s.id)}
                disabled={disabled}
                prefix={`new-${s.id}`}
              />
            </div>
          </details>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ one card per section (HR and self)
export type CardMode = 'hr' | 'self'

/**
 * One profile section, as a read view with its own Edit. `save` sends the request and throws on failure (the card shows the server's words).
 * mode 'hr': HR edits any section of a person. mode 'self': the person's own My Profile; the work section and the birth year are HR only
 * (read-only, "Ask HR to change this."), and the government IDs arrive masked, so their form starts empty and a key can be cleared.
 */
export function ProfileSectionCard({
  section,
  profile,
  mode,
  save,
  onSaved,
}: {
  section: ProfileSection
  profile: EmployeeProfile
  mode: CardMode
  save: (body: { profile: ProfilePatch }) => Promise<void>
  /** Called after a successful save with the section title (HR pages use it for the page notice). */
  onSaved?: (title: string) => void
}) {
  const meta = PROFILE_SECTIONS.find((s) => s.id === section)!
  const self = mode === 'self'
  const sensitive = section === 'statutory'
  const readOnly = self && section === 'work'
  const fields = self ? selfFields(section) : SECTION_FIELDS[section]
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<SectionForm>({})
  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<FieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const titleId = `pm-profile-${section}-h`
  const selfIds = self && sensitive

  function start() {
    setForm(selfIds ? {} : sectionFormFromProfile(section, profile))
    setCleared({})
    setErrors({})
    setBanner(null)
    setSaved(null)
    setEditing(true)
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (saving) return
    const typed = selfIds ? Object.fromEntries(Object.entries(form).filter(([k]) => !cleared[k])) : form
    const local = validateSection(section, typed)
    if (Object.keys(local).length) {
      setErrors(local)
      setBanner('Please fix the highlighted fields.')
      return
    }
    const body = selfIds ? buildSelfStatutoryPatch(form, cleared) : buildSectionPatch(section, profile, form)
    if (!body) {
      setEditing(false)
      return
    }
    setSaving(true)
    setErrors({})
    setBanner(null)
    try {
      await save(body)
      setEditing(false)
      if (self) setSaved(`${meta.title} saved.`)
      onSaved?.(meta.title)
    } catch (err) {
      const f = parseFailure(err)
      if (f.code === 'hr_only_field') setBanner(f.detail ?? HR_ONLY_NOTE)
      else if (f.status === 422 && Object.keys(f.fieldErrors).length) {
        setErrors(fieldErrorsText(f.fieldErrors))
        setBanner('The service did not accept some values. See the highlighted fields.')
      } else setBanner(failureMessage(f, `${meta.title} could not be saved.`))
    } finally {
      setSaving(false)
    }
  }

  const rows = sectionRows(section, profile, formatDate)
  const spec = (key: string) => SECTION_FIELDS[section].find((f) => f.key === key)
  const shown = (v: string): string => {
    if (self || !sensitive || revealed || isMasked(v)) return v
    return maskNumber(v) || v
  }

  return (
    <section
      className={`card card-pad pm-card-section pm-profile-card${sensitive ? ' pm-profile-sensitive' : ''}`}
      aria-labelledby={titleId}
      data-testid={`profile-card-${section}`}
      data-editing={editing ? '1' : '0'}
    >
      <div className="pm-section-head">
        <div>
          <h2 className="pm-h2" id={titleId}>
            {sensitive ? <Lock size={16} aria-hidden="true" className="pm-lock" /> : null} {meta.title}
          </h2>
          {sensitive ? (
            <p className="pm-sensitive" data-testid="profile-sensitive-note">
              {self ? 'Only you and HR can see this.' : SENSITIVE_NOTE}
            </p>
          ) : null}
          {readOnly ? (
            <p className="pm-sensitive" data-testid={`profile-hr-only-${section}`}>
              Set by HR. {HR_ONLY_NOTE}
            </p>
          ) : null}
        </div>
        <div className="pm-head-actions">
          {sensitive && !self && !editing ? (
            <button type="button" className="btn btn-secondary" aria-pressed={revealed} onClick={() => setRevealed((v) => !v)} data-testid="toggle-statutory-show">
              {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />} {revealed ? 'Hide' : 'Show'}
            </button>
          ) : null}
          {!editing && !readOnly ? (
            <button type="button" className="btn btn-secondary" onClick={start} data-testid={`edit-profile-${section}`}>
              Edit
            </button>
          ) : null}
        </div>
      </div>

      {saved && !editing ? (
        <p className="pm-ok" role="status" data-testid={`profile-saved-${section}`}>
          {saved}
        </p>
      ) : null}

      {editing ? (
        <form onSubmit={submit} noValidate aria-busy={saving} data-testid={`profile-form-${section}`}>
          {banner ? (
            <div className="pm-banner" data-testid={`profile-error-${section}`}>
              <Alert tone="danger">{banner}</Alert>
            </div>
          ) : null}
          {selfIds ? <p className="pm-help">These numbers are hidden. Type a number to replace the one on file, or clear it.</p> : null}
          <ProfileFields
            section={section}
            form={form}
            onChange={setForm}
            errors={sectionErrors(errors, section)}
            disabled={saving}
            prefix={`edit-${section}`}
            fields={fields}
            selfStatutory={selfIds ? { existing: profile.statutory as unknown as Record<string, string>, cleared, onToggleClear: (k) => setCleared((c) => ({ ...c, [k]: !c[k] })) } : undefined}
          />
          {self && section === 'personal' ? <p className="pm-help" data-testid="profile-hr-only-birth-year">Birth year is set by HR. {HR_ONLY_NOTE}</p> : null}
          <div className="pm-actions">
            <button type="submit" className="btn btn-primary" disabled={saving} data-testid={`save-profile-${section}`}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving} data-testid={`cancel-profile-${section}`}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="pm-facts" data-testid={`profile-facts-${section}`}>
          {rows.map((r) => (
            <div key={r.key} data-testid={`fact-profile-${section}-${slug(r.key)}`}>
              <dt>{r.label}</dt>
              <dd className={`pm-wrap${r.provided ? '' : ' pm-muted'}${r.key === 'address' ? ' pm-multiline' : ''}`}>
                {r.provided ? (r.sensitive ? shown(r.value) : r.value) : r.value}
                {self && spec(r.key)?.hrOnly ? <span className="pm-sub">{HR_ONLY_NOTE}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
