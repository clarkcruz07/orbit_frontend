/**
 * The HR employee profile (docs/api/peoplemgmt.md, profile sections). One shape for the People pages (HR sees and edits it) and for My Profile
 * (the person sees their own, read-only, with government numbers masked by the server). Every section is always present; a value that is not
 * on file is an empty string, so the UI never has to ask "is this section there?".
 */

export type Gender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_say'
export type CivilStatus = 'single' | 'married' | 'widowed' | 'separated' | 'other'
export type WorkArrangement = 'onsite' | 'hybrid' | 'remote'

export interface ProfilePersonal {
  preferred_name: string
  gender: string
  civil_status: string
  nationality: string
  /** The year only, as digits ('' when not on file). Stored next to the MM-DD birthday; HR and the person see it, nobody else. */
  birth_year: string
}
export interface ProfileAddress {
  line1: string
  line2: string
  city: string
  province: string
  postal_code: string
  country: string
}
export interface ProfileContact {
  personal_email: string
  mobile: string
  address: ProfileAddress
}
export interface ProfileEmergency {
  name: string
  relationship: string
  phone: string
}
export interface ProfileWork {
  employee_number: string
  company: string
  office_location: string
  work_arrangement: string
  probation_end_date: string
  regularization_date: string
}
export interface ProfileStatutory {
  tin: string
  sss: string
  philhealth: string
  pagibig: string
}

export interface EmployeeProfile {
  personal: ProfilePersonal
  contact: ProfileContact
  emergency_contact: ProfileEmergency
  work: ProfileWork
  statutory: ProfileStatutory
}

export type ProfileSection = keyof EmployeeProfile

export const GENDER_OPTIONS: readonly { value: Gender; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]
export const CIVIL_STATUS_OPTIONS: readonly { value: CivilStatus; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'separated', label: 'Separated' },
  { value: 'other', label: 'Other' },
]
export const WORK_ARRANGEMENT_OPTIONS: readonly { value: WorkArrangement; label: string }[] = [
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
]

const text = (v: unknown): string => (typeof v === 'string' ? v : '')
/** A year arrives as an integer (or digits); anything else reads as not provided. */
const year = (v: unknown): string => (typeof v === 'number' && Number.isInteger(v) ? String(v) : typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? v.trim() : '')
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function emptyProfile(): EmployeeProfile {
  return {
    personal: { preferred_name: '', gender: '', civil_status: '', nationality: '', birth_year: '' },
    contact: { personal_email: '', mobile: '', address: { line1: '', line2: '', city: '', province: '', postal_code: '', country: '' } },
    emergency_contact: { name: '', relationship: '', phone: '' },
    work: { employee_number: '', company: '', office_location: '', work_arrangement: '', probation_end_date: '', regularization_date: '' },
    statutory: { tin: '', sss: '', philhealth: '', pagibig: '' },
  }
}

/** Tolerant reader: a missing section or key is "not provided", an unexpected type is ignored. Never throws. */
export function normaliseProfile(raw: unknown): EmployeeProfile {
  const r = obj(raw)
  const p = obj(r.personal)
  const c = obj(r.contact)
  const a = obj(c.address)
  const e = obj(r.emergency_contact)
  const w = obj(r.work)
  const s = obj(r.statutory)
  return {
    personal: { preferred_name: text(p.preferred_name), gender: text(p.gender), civil_status: text(p.civil_status), nationality: text(p.nationality), birth_year: year(p.birth_year) },
    contact: {
      personal_email: text(c.personal_email),
      mobile: text(c.mobile),
      address: { line1: text(a.line1), line2: text(a.line2), city: text(a.city), province: text(a.province), postal_code: text(a.postal_code), country: text(a.country) },
    },
    emergency_contact: { name: text(e.name), relationship: text(e.relationship), phone: text(e.phone) },
    work: {
      employee_number: text(w.employee_number),
      company: text(w.company),
      office_location: text(w.office_location),
      work_arrangement: text(w.work_arrangement),
      probation_end_date: text(w.probation_end_date),
      regularization_date: text(w.regularization_date),
    },
    statutory: { tin: text(s.tin), sss: text(s.sss), philhealth: text(s.philhealth), pagibig: text(s.pagibig) },
  }
}

/** Body of `profile` on create: only sections that have a value; a key with no value is left out. */
export interface ProfileBody {
  personal?: Partial<Record<Exclude<keyof ProfilePersonal, 'birth_year'>, string>> & { birth_year?: number }
  contact?: Partial<Omit<ProfileContact, 'address'>> & { address?: Partial<ProfileAddress> }
  emergency_contact?: Partial<ProfileEmergency>
  work?: Partial<ProfileWork>
  statutory?: Partial<ProfileStatutory>
}

/** Body of `profile` on PATCH: only the keys that changed; a cleared key is null. */
export type ProfilePatch = {
  personal?: Partial<Record<Exclude<keyof ProfilePersonal, 'birth_year'>, string | null>> & { birth_year?: number | null }
  contact?: Partial<Record<'personal_email' | 'mobile', string | null>> & { address?: Partial<Record<keyof ProfileAddress, string | null>> }
  emergency_contact?: Partial<Record<keyof ProfileEmergency, string | null>>
  work?: Partial<Record<keyof ProfileWork, string | null>>
  statutory?: Partial<Record<keyof ProfileStatutory, string | null>>
}

/** Section titles, in display order. */
export const PROFILE_SECTIONS: readonly { id: ProfileSection; title: string; hint: string }[] = [
  { id: 'personal', title: 'Personal', hint: 'Preferred name, gender, civil status and nationality.' },
  { id: 'contact', title: 'Contact and address', hint: 'Personal e-mail, mobile number and home address.' },
  { id: 'emergency_contact', title: 'Emergency contact', hint: 'Who to call in an emergency.' },
  { id: 'work', title: 'Work details', hint: 'Employee number, company, office, work arrangement and probation dates.' },
  { id: 'statutory', title: 'Government IDs', hint: 'TIN, SSS, PhilHealth and Pag-IBIG numbers. Sensitive.' },
]

/** Field names as shown to people (and in error messages), keyed by the path the server uses: "profile.<section>.<field>". */
export const PROFILE_FIELD_LABEL: Record<string, string> = {
  'profile.personal.preferred_name': 'Preferred name',
  'profile.personal.gender': 'Gender',
  'profile.personal.civil_status': 'Civil status',
  'profile.personal.nationality': 'Nationality',
  'profile.personal.birth_year': 'Birth year',
  'profile.contact.personal_email': 'Personal email',
  'profile.contact.mobile': 'Mobile number',
  'profile.contact.address.line1': 'Address line 1',
  'profile.contact.address.line2': 'Address line 2',
  'profile.contact.address.city': 'City',
  'profile.contact.address.province': 'Province',
  'profile.contact.address.postal_code': 'Postal code',
  'profile.contact.address.country': 'Country',
  'profile.emergency_contact.name': 'Emergency contact name',
  'profile.emergency_contact.relationship': 'Relationship',
  'profile.emergency_contact.phone': 'Emergency contact phone',
  'profile.work.employee_number': 'Employee number',
  'profile.work.company': 'Company',
  'profile.work.office_location': 'Office location',
  'profile.work.work_arrangement': 'Work arrangement',
  'profile.work.probation_end_date': 'Probation end date',
  'profile.work.regularization_date': 'Regularisation date',
  'profile.statutory.tin': 'TIN',
  'profile.statutory.sss': 'SSS number',
  'profile.statutory.philhealth': 'PhilHealth number',
  'profile.statutory.pagibig': 'Pag-IBIG number',
}
