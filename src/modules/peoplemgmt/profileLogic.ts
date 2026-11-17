/**
 * Pure helpers for the HR employee profile (no DOM, no network). They MIRROR the server limits (docs/api/peoplemgmt.md) only to give quick
 * feedback; the server's own answer is always shown when it disagrees. Error keys use the path the server uses: "profile.<section>.<field>".
 */
import {
  CIVIL_STATUS_OPTIONS,
  GENDER_OPTIONS,
  PROFILE_FIELD_LABEL,
  WORK_ARRANGEMENT_OPTIONS,
  emptyProfile,
  type EmployeeProfile,
  type ProfileBody,
  type ProfilePatch,
  type ProfileSection,
} from '@/api/profile'
import { parseIsoDate } from '@/lib/dates'
import { collapse, textRuleError, type FieldErrors } from './logic'

export const PERSON_NAME_MAX = 60
export const PLACE_MAX = 120
export const PHONE_MIN = 7
export const PHONE_MAX = 24
export const EMPLOYEE_NUMBER_MAX = 30
export const GOV_ID_MAX = 20
export const PERSONAL_EMAIL_MAX = 254

export const BIRTH_YEAR_MIN = 1900
export const BIRTH_YEAR_MIN_AGE = 14
export const BIRTH_YEAR_HELP = 'Shown only to HR and the person. The calendar never shows the year.'
export const HR_ONLY_NOTE = 'Ask HR to change this.'

export type FieldKind = 'text' | 'email' | 'phone' | 'select' | 'date' | 'id' | 'year'

export interface FieldSpec {
  /** Key inside the section; an address part is "address.line1". */
  key: string
  label: string
  kind: FieldKind
  max?: number
  options?: readonly { value: string; label: string }[]
  help?: string
  span?: 2
  /** Only HR can change it: left out of the person's own edit form (and shown read-only on My Profile). */
  hrOnly?: boolean
}

const L = (path: string) => PROFILE_FIELD_LABEL[path] ?? path

export const SECTION_FIELDS: Record<ProfileSection, readonly FieldSpec[]> = {
  personal: [
    { key: 'preferred_name', label: L('profile.personal.preferred_name'), kind: 'text', max: PERSON_NAME_MAX, help: 'What people call them, if different from their full name.' },
    { key: 'gender', label: L('profile.personal.gender'), kind: 'select', options: GENDER_OPTIONS },
    { key: 'civil_status', label: L('profile.personal.civil_status'), kind: 'select', options: CIVIL_STATUS_OPTIONS },
    { key: 'nationality', label: L('profile.personal.nationality'), kind: 'text', max: PERSON_NAME_MAX },
    { key: 'birth_year', label: L('profile.personal.birth_year'), kind: 'year', help: BIRTH_YEAR_HELP, hrOnly: true },
  ],
  contact: [
    { key: 'personal_email', label: L('profile.contact.personal_email'), kind: 'email', max: PERSONAL_EMAIL_MAX, help: 'Not the work address they sign in with.' },
    { key: 'mobile', label: L('profile.contact.mobile'), kind: 'phone', help: 'Digits, spaces and + - ( ) only.' },
    { key: 'address.line1', label: L('profile.contact.address.line1'), kind: 'text', max: PLACE_MAX, span: 2 },
    { key: 'address.line2', label: L('profile.contact.address.line2'), kind: 'text', max: PLACE_MAX, span: 2 },
    { key: 'address.city', label: L('profile.contact.address.city'), kind: 'text', max: PLACE_MAX },
    { key: 'address.province', label: L('profile.contact.address.province'), kind: 'text', max: PLACE_MAX },
    { key: 'address.postal_code', label: L('profile.contact.address.postal_code'), kind: 'text', max: PLACE_MAX },
    { key: 'address.country', label: L('profile.contact.address.country'), kind: 'text', max: PLACE_MAX },
  ],
  emergency_contact: [
    { key: 'name', label: L('profile.emergency_contact.name'), kind: 'text', max: PLACE_MAX, help: 'If you fill in any emergency contact detail, the name and phone are needed.' },
    { key: 'relationship', label: L('profile.emergency_contact.relationship'), kind: 'text', max: PERSON_NAME_MAX },
    { key: 'phone', label: L('profile.emergency_contact.phone'), kind: 'phone', help: 'Digits, spaces and + - ( ) only.' },
  ],
  work: [
    { key: 'employee_number', label: L('profile.work.employee_number'), kind: 'text', max: EMPLOYEE_NUMBER_MAX, help: 'The number on the payslip or HR system, if there is one.' },
    { key: 'company', label: L('profile.work.company'), kind: 'text', max: PLACE_MAX },
    { key: 'office_location', label: L('profile.work.office_location'), kind: 'text', max: PLACE_MAX },
    { key: 'work_arrangement', label: L('profile.work.work_arrangement'), kind: 'select', options: WORK_ARRANGEMENT_OPTIONS },
    { key: 'probation_end_date', label: L('profile.work.probation_end_date'), kind: 'date' },
    { key: 'regularization_date', label: L('profile.work.regularization_date'), kind: 'date' },
  ],
  statutory: [
    { key: 'tin', label: L('profile.statutory.tin'), kind: 'id', max: GOV_ID_MAX, help: 'Digits and hyphens only.' },
    { key: 'sss', label: L('profile.statutory.sss'), kind: 'id', max: GOV_ID_MAX },
    { key: 'philhealth', label: L('profile.statutory.philhealth'), kind: 'id', max: GOV_ID_MAX },
    { key: 'pagibig', label: L('profile.statutory.pagibig'), kind: 'id', max: GOV_ID_MAX },
  ],
}

export const SENSITIVE_NOTE = 'Sensitive: visible only to HR and the person.'
export const NOT_PROVIDED = 'Not provided'

// ------------------------------------------------------------------------------------------------ forms
/** One section as flat strings keyed like the specs ("address.city"). */
export type SectionForm = Record<string, string>
export type ProfileForm = Record<ProfileSection, SectionForm>

const getValue = (section: ProfileSection, profile: EmployeeProfile, key: string): string => {
  const s = profile[section] as unknown as Record<string, unknown>
  if (key.startsWith('address.')) {
    const addr = (s.address ?? {}) as Record<string, unknown>
    const v = addr[key.slice('address.'.length)]
    return typeof v === 'string' ? v : ''
  }
  const v = s[key]
  return typeof v === 'string' ? v : ''
}

export function sectionFormFromProfile(section: ProfileSection, profile: EmployeeProfile): SectionForm {
  const out: SectionForm = {}
  for (const f of SECTION_FIELDS[section]) out[f.key] = getValue(section, profile, f.key)
  return out
}

export function profileFormFromProfile(profile: EmployeeProfile): ProfileForm {
  return {
    personal: sectionFormFromProfile('personal', profile),
    contact: sectionFormFromProfile('contact', profile),
    emergency_contact: sectionFormFromProfile('emergency_contact', profile),
    work: sectionFormFromProfile('work', profile),
    statutory: sectionFormFromProfile('statutory', profile),
  }
}

export const emptyProfileForm = (): ProfileForm => profileFormFromProfile(emptyProfile())

/** True when a value is a person's real entry (not blank). */
const filled = (v: string | undefined): boolean => collapse(v ?? '') !== ''

export function sectionHasValue(form: SectionForm): boolean {
  return Object.values(form).some(filled)
}

/** How many of the five sections have at least one value (for hints such as "2 of 5 sections filled"). */
export function filledSections(profile: EmployeeProfile): number {
  const f = profileFormFromProfile(profile)
  return (Object.keys(f) as ProfileSection[]).filter((s) => sectionHasValue(f[s])).length
}

// ------------------------------------------------------------------------------------------------ validation (server mirror)
const PERSONAL_EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const PHONE_RE = /^[0-9 +\-()]+$/
const GOV_ID_RE = /^[0-9-]+$/

/** Error WITHOUT the field name ("must be at most 60 characters"), or null. Empty values are fine unless the section rule says otherwise. */
export function fieldRuleError(spec: FieldSpec, raw: string, now: Date = new Date()): string | null {
  const text = collapse(raw)
  if (!text) return null
  switch (spec.kind) {
    case 'year': {
      const max = now.getFullYear() - BIRTH_YEAR_MIN_AGE
      if (!/^\d{4}$/.test(text)) return 'must be a four-digit year'
      const y = Number(text)
      return y >= BIRTH_YEAR_MIN && y <= max ? null : `must be between ${BIRTH_YEAR_MIN} and ${max}`
    }
    case 'text':
      return textRuleError(raw, spec.max ?? PLACE_MAX, false)
    case 'email':
      if (text.length > PERSONAL_EMAIL_MAX) return `must be at most ${PERSONAL_EMAIL_MAX} characters`
      return PERSONAL_EMAIL_RE.test(text) ? null : 'must be a valid e-mail address'
    case 'phone':
      if (!PHONE_RE.test(text)) return 'may only contain digits, spaces and + - ( )'
      if (text.length < PHONE_MIN || text.length > PHONE_MAX) return `must be ${PHONE_MIN} to ${PHONE_MAX} characters`
      return null
    case 'id':
      if (!GOV_ID_RE.test(text)) return 'may only contain digits and hyphens'
      return text.length > (spec.max ?? GOV_ID_MAX) ? `must be at most ${spec.max ?? GOV_ID_MAX} characters` : null
    case 'date':
      return parseIsoDate(text) && /^\d{4}-\d{2}-\d{2}$/.test(text) ? null : 'must be a real date'
    case 'select':
      return (spec.options ?? []).some((o) => o.value === text) ? null : 'is not one of the choices'
    default:
      return null
  }
}

const errorKey = (section: ProfileSection, key: string) => `profile.${section}.${key}`
const withLabel = (path: string, err: string) => `${PROFILE_FIELD_LABEL[path] ?? path} ${err}`

/** Checks one section. Keys are server paths; messages carry the field name. */
export function validateSection(section: ProfileSection, form: SectionForm, now: Date = new Date()): FieldErrors {
  const out: FieldErrors = {}
  for (const spec of SECTION_FIELDS[section]) {
    const err = fieldRuleError(spec, form[spec.key] ?? '', now)
    if (err) out[errorKey(section, spec.key)] = withLabel(errorKey(section, spec.key), err)
  }
  if (section === 'emergency_contact' && sectionHasValue(form)) {
    for (const key of ['name', 'phone']) {
      const k = errorKey(section, key)
      if (!filled(form[key]) && !out[k]) out[k] = withLabel(k, 'is required when any emergency contact detail is given')
    }
  }
  return out
}

export function validateProfileForm(form: ProfileForm, now: Date = new Date()): FieldErrors {
  const out: FieldErrors = {}
  for (const s of Object.keys(form) as ProfileSection[]) Object.assign(out, validateSection(s, form[s], now))
  return out
}

/** The section that owns an error key ("profile.contact.mobile" -> "contact"), or null. */
export function sectionOfError(key: string): ProfileSection | null {
  const m = /^profile\.([a-z_]+)\./.exec(key)
  const id = m?.[1]
  return id === 'personal' || id === 'contact' || id === 'emergency_contact' || id === 'work' || id === 'statutory' ? id : null
}

/** A section's own errors, keyed by the field key inside the section ("address.city"). */
export function sectionErrors(errors: FieldErrors, section: ProfileSection): FieldErrors {
  const prefix = `profile.${section}.`
  const out: FieldErrors = {}
  for (const [k, v] of Object.entries(errors)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
  return out
}

// ------------------------------------------------------------------------------------------------ request bodies
const clean = (v: string | undefined): string => collapse(v ?? '')

/** Create: only sections (and keys) that have a value. Returns undefined when nothing was entered at all. */
export function buildProfileCreate(form: ProfileForm): ProfileBody | undefined {
  const body: Record<string, Record<string, unknown>> = {}
  for (const section of Object.keys(form) as ProfileSection[]) {
    const out: Record<string, unknown> = {}
    for (const spec of SECTION_FIELDS[section]) {
      const v = clean(form[section][spec.key])
      if (!v) continue
      if (spec.key.startsWith('address.')) {
        const addr = (out.address ?? {}) as Record<string, string>
        addr[spec.key.slice('address.'.length)] = v
        out.address = addr
      } else out[spec.key] = spec.kind === 'year' ? Number(v) : v
    }
    if (Object.keys(out).length) body[section] = out
  }
  return Object.keys(body).length ? (body as ProfileBody) : undefined
}

/** PATCH for ONE section: only the keys whose value changed; a cleared key is null. Returns null when nothing changed. */
export function buildSectionPatch(section: ProfileSection, original: EmployeeProfile, form: SectionForm): { profile: ProfilePatch } | null {
  const out: Record<string, unknown> = {}
  for (const spec of SECTION_FIELDS[section]) {
    const was = clean(getValue(section, original, spec.key))
    const now = clean(form[spec.key])
    if (was === now) continue
    const value = now === '' ? null : spec.kind === 'year' ? Number(now) : now
    if (spec.key.startsWith('address.')) {
      const addr = (out.address ?? {}) as Record<string, unknown>
      addr[spec.key.slice('address.'.length)] = value
      out.address = addr
    } else out[spec.key] = value
  }
  return Object.keys(out).length ? { profile: { [section]: out } as ProfilePatch } : null
}

// ------------------------------------------------------------------------------------------------ display
export interface ProfileRow {
  key: string
  label: string
  /** The text to show; NOT_PROVIDED when empty. */
  value: string
  provided: boolean
  /** Government numbers (masked until shown). */
  sensitive?: boolean
}

/** HR / own view of the date of birth: 'Date of birth: 12 Dec 1995' when both parts are known, else just the part there is. `birthday` is MM-DD. */
export function dateOfBirth(birthday: string | null | undefined, birthYear: string | null | undefined): { label: string; value: string } | null {
  const m = /^(\d{2})-(\d{2})$/.exec((birthday ?? '').trim())
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const dm = m && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${Number(m[2])} ${months[Number(m[1]) - 1]}` : ''
  const y = (birthYear ?? '').trim()
  if (dm && y) return { label: 'Date of birth', value: `${dm} ${y}` }
  if (dm) return { label: 'Birthday', value: dm }
  if (y) return { label: 'Birth year', value: y }
  return null
}

/** The same from the "Mon DD" text My Profile gets for the birthday ("Dec 12"). */
export function dateOfBirthFromLabel(label: string | null | undefined, birthYear: string | null | undefined): { label: string; value: string } | null {
  const m = /^([A-Za-z]{3}) (\d{1,2})$/.exec((label ?? '').trim())
  const y = (birthYear ?? '').trim()
  if (m && y) return { label: 'Date of birth', value: `${Number(m[2])} ${m[1]} ${y}` }
  if (m) return { label: 'Birthday', value: `${Number(m[2])} ${m[1]}` }
  if (y) return { label: 'Birth year', value: y }
  return null
}

/** My Profile PATCH for the government IDs: the form starts EMPTY (the server only ever sends masked values), a key is sent only if the person typed
 * a replacement, and a cleared key is null. Returns null when nothing was typed or cleared. */
export function buildSelfStatutoryPatch(form: SectionForm, cleared: Record<string, boolean>): { profile: ProfilePatch } | null {
  const out: Record<string, string | null> = {}
  for (const spec of SECTION_FIELDS.statutory) {
    if (cleared[spec.key]) out[spec.key] = null
    else {
      const v = clean(form[spec.key])
      if (v) out[spec.key] = v
    }
  }
  return Object.keys(out).length ? { profile: { statutory: out } } : null
}

/** A section's fields for the person's own edit form (HR-only fields left out). */
export const selfFields = (section: ProfileSection): readonly FieldSpec[] => SECTION_FIELDS[section].filter((f) => !f.hrOnly)

const optionLabel = (options: readonly { value: string; label: string }[] | undefined, v: string): string => options?.find((o) => o.value === v)?.label ?? v

/** The value of one field as people read it ("Hybrid", "5 Mar 2027"). Empty string when there is none. */
export function displayValue(spec: FieldSpec, raw: string, formatDate: (iso: string) => string): string {
  const v = raw.trim()
  if (!v) return ''
  if (spec.kind === 'select') return optionLabel(spec.options, v)
  if (spec.kind === 'date') return formatDate(v)
  return v
}

/** Rows for a section. The address parts become ONE multi-line "Address" row. */
export function sectionRows(section: ProfileSection, profile: EmployeeProfile, formatDate: (iso: string) => string): ProfileRow[] {
  const rows: ProfileRow[] = []
  const form = sectionFormFromProfile(section, profile)
  let addressDone = false
  for (const spec of SECTION_FIELDS[section]) {
    if (spec.key.startsWith('address.')) {
      if (addressDone) continue
      addressDone = true
      const text = addressText(profile)
      rows.push({ key: 'address', label: 'Address', value: text || NOT_PROVIDED, provided: Boolean(text) })
      continue
    }
    const v = displayValue(spec, form[spec.key] ?? '', formatDate)
    rows.push({ key: spec.key, label: spec.label, value: v || NOT_PROVIDED, provided: Boolean(v), sensitive: section === 'statutory' })
  }
  return rows
}

/** "12 Mabini St, Unit 4\nMakati, Metro Manila 1210\nPhilippines" (empty parts are skipped). */
export function addressText(profile: EmployeeProfile): string {
  const a = profile.contact.address
  const lines = [[a.line1, a.line2].filter(Boolean).join(', '), [a.city, a.province].filter(Boolean).join(', ') + (a.postal_code ? ` ${a.postal_code}` : ''), a.country]
  return lines.map((l) => l.trim()).filter(Boolean).join('\n')
}

// ------------------------------------------------------------------------------------------------ masking
export const MASK = '••••'

/** Hides all but the last four characters of a number: "123-456-789" -> "••••-789"-style is avoided; we show "••••6789". */
export function maskNumber(raw: string): string {
  const v = raw.replace(/[^0-9A-Za-z]/g, '')
  if (!v) return ''
  return v.length <= 4 ? MASK : `${MASK}${v.slice(-4)}`
}

/** True for a value the server already masked ("••••1234"): it cannot be shown in full or edited into a real number. */
export function isMasked(raw: string): boolean {
  return raw.includes('•')
}
