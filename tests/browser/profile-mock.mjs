// Shared mock behaviour for the HR employee profile (docs/api/peoplemgmt.md, profile sections): the empty shape, the server's validation
// (field errors keyed "profile.<section>.<field>"), the deep merge with null-clears, and the list / self views. Fictional data only.

export const emptyProfile = () => ({
  personal: { preferred_name: '', gender: '', civil_status: '', nationality: '', birth_year: '' },
  contact: { personal_email: '', mobile: '', address: { line1: '', line2: '', city: '', province: '', postal_code: '', country: '' } },
  emergency_contact: { name: '', relationship: '', phone: '' },
  work: { employee_number: '', company: '', office_location: '', work_arrangement: '', probation_end_date: '', regularization_date: '' },
  statutory: { tin: '', sss: '', philhealth: '', pagibig: '' },
})

export const sampleProfile = () => ({
  personal: { preferred_name: 'Mara', gender: 'female', civil_status: 'single', nationality: 'Filipino', birth_year: 1995 },
  contact: { personal_email: 'mara.home@example.test', mobile: '+63 917 123 4567', address: { line1: '12 Mabini St', line2: 'Unit 4', city: 'Makati', province: 'Metro Manila', postal_code: '1210', country: 'Philippines' } },
  emergency_contact: { name: 'Ana Aquino', relationship: 'Sister', phone: '0917-555-0100' },
  work: { employee_number: 'E-0100', company: 'Bluedge Outsourcing, OPC', office_location: 'Makati', work_arrangement: 'hybrid', probation_end_date: '2027-02-03', regularization_date: '' },
  statutory: { tin: '123-456-789', sss: '34-1234567-8', philhealth: '12-345678901-2', pagibig: '1234-5678-9012' },
})

const SELECTS = {
  'personal.gender': ['female', 'male', 'non_binary', 'prefer_not_to_say'],
  'personal.civil_status': ['single', 'married', 'widowed', 'separated', 'other'],
  'work.work_arrangement': ['onsite', 'hybrid', 'remote'],
}
const LIMITS = {
  'personal.preferred_name': 60, 'personal.nationality': 60, 'emergency_contact.relationship': 60,
  'contact.address.line1': 120, 'contact.address.line2': 120, 'contact.address.city': 120, 'contact.address.province': 120, 'contact.address.postal_code': 120, 'contact.address.country': 120,
  'work.company': 120, 'work.office_location': 120, 'emergency_contact.name': 120, 'work.employee_number': 30,
}
const PHONES = ['contact.mobile', 'emergency_contact.phone']
const IDS = ['statutory.tin', 'statutory.sss', 'statutory.philhealth', 'statutory.pagibig']
const DATES = ['work.probation_end_date', 'work.regularization_date']
const SECTIONS = Object.keys(emptyProfile())

const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d

/** Flattens {section:{key:v, address:{k:v}}} into 'section.key' / 'section.address.k' pairs. Returns null for an unknown section or key. */
function flatten(profile) {
  const out = []
  const shape = emptyProfile()
  for (const [section, value] of Object.entries(profile ?? {})) {
    if (!SECTIONS.includes(section)) return null
    if (value === null) {
      out.push([section, null, 'section'])
      continue
    }
    if (typeof value !== 'object' || Array.isArray(value)) return null
    for (const [key, v] of Object.entries(value)) {
      if (section === 'contact' && key === 'address') {
        if (v === null) {
          out.push(['contact.address', null, 'section'])
          continue
        }
        if (typeof v !== 'object') return null
        for (const [k2, v2] of Object.entries(v)) {
          if (!(k2 in shape.contact.address)) return null
          out.push([`contact.address.${k2}`, v2, 'field'])
        }
        continue
      }
      if (!(key in shape[section])) return null
      out.push([`${section}.${key}`, v, 'field'])
    }
  }
  return out
}

/** Field errors (keyed like the real server) for a create/patch `profile`; {unknown:true} when a section or key does not exist. */
export function profileErrors(profile, existing = emptyProfile()) {
  const flat = flatten(profile)
  if (flat === null) return { unknown: true }
  const fe = {}
  for (const [path, v, kind] of flat) {
    if (kind === 'section' || v === null || v === '') continue
    const key = `profile.${path}`
    if (path === 'personal.birth_year') {
      const n = typeof v === 'number' ? v : /^\d{4}$/.test(String(v).trim()) ? Number(v) : NaN
      if (!Number.isInteger(n) || n < 1900 || n > 2012) fe[key] = 'must be between 1900 and 2012'
      continue
    }
    if (typeof v !== 'string') {
      fe[key] = 'must be text'
      continue
    }
    const t = v.trim().replace(/\s+/g, ' ')
    if (!t) continue
    if (SELECTS[path] && !SELECTS[path].includes(t)) fe[key] = 'is not one of the choices'
    else if (path === 'contact.personal_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) fe[key] = 'must be a valid e-mail address'
    else if (PHONES.includes(path)) {
      if (!/^[0-9 +\-()]+$/.test(t)) fe[key] = 'may only contain digits, spaces and + - ( )'
      else if (t.length < 7 || t.length > 24) fe[key] = 'must be 7 to 24 characters'
    } else if (IDS.includes(path)) {
      if (!/^[0-9-]+$/.test(t)) fe[key] = 'may only contain digits and hyphens'
      else if (t.length > 20) fe[key] = 'must be at most 20 characters'
    } else if (DATES.includes(path)) {
      if (!validDate(t)) fe[key] = 'must be a real date'
    } else if (LIMITS[path] && t.length > LIMITS[path]) fe[key] = `must be at most ${LIMITS[path]} characters`
  }
  // an emergency contact needs name and phone as soon as any detail is given
  const next = mergeProfile(existing, profile)
  const e = next.emergency_contact
  if (Object.values(e).some((x) => x)) {
    if (!e.name) fe['profile.emergency_contact.name'] ??= 'is required when any emergency contact detail is given'
    if (!e.phone) fe['profile.emergency_contact.phone'] ??= 'is required when any emergency contact detail is given'
  }
  return fe
}

const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v)

/** Deep merge: only the keys sent change; null clears a key (or a whole section). */
export function mergeProfile(existing, patch) {
  const next = JSON.parse(JSON.stringify(existing))
  for (const [path, v, kind] of flatten(patch) ?? []) {
    const parts = path.split('.')
    if (kind === 'section') {
      if (path === 'contact.address') next.contact.address = emptyProfile().contact.address
      else next[parts[0]] = emptyProfile()[parts[0]]
      continue
    }
    let o = next
    for (const k of parts.slice(0, -1)) o = o[k]
    o[parts[parts.length - 1]] = v === null ? '' : clean(v)
  }
  return next
}

/** The LIST view omits the sensitive and bulky parts (statutory, emergency contact, address). */
export function listProfile(profile) {
  const e = emptyProfile()
  return { ...profile, statutory: e.statutory, emergency_contact: e.emergency_contact, contact: { ...profile.contact, address: e.contact.address } }
}

/**
 * PATCH /me/profile as the server does it: only personal (not birth_year), contact, emergency_contact and statutory may be sent. Anything HR only (work,
 * birth_year, other keys) is 422 hr_only_field. Returns {status, body} or {next} when it went through.
 */
export function selfPatch(existing, body) {
  const keys = Object.keys(body ?? {})
  if (keys.length !== 1 || keys[0] !== 'profile' || typeof body.profile !== 'object' || body.profile === null) return { status: 422, body: { detail: 'Invalid request', errors: [] } }
  const p = body.profile
  const hrOnly = Object.keys(p).filter((s) => !['personal', 'contact', 'emergency_contact', 'statutory'].includes(s))
  const birthYear = p.personal && typeof p.personal === 'object' && 'birth_year' in p.personal
  if (hrOnly.length || birthYear) {
    const field_errors = Object.fromEntries([...hrOnly.map((s) => [`profile.${s}`, 'is set by HR']), ...(birthYear ? [['profile.personal.birth_year', 'is set by HR']] : [])])
    return { status: 422, body: { detail: 'Ask HR to change this.', code: 'hr_only_field', field_errors } }
  }
  const fe = profileErrors(p, existing)
  if (fe.unknown) return { status: 422, body: { detail: 'Invalid request', errors: [] } }
  if (Object.keys(fe).length) return { status: 422, body: { detail: 'Invalid profile details', code: 'validation', field_errors: fe } }
  return { next: mergeProfile(existing, p) }
}

/** What the person sees of their OWN profile: government numbers masked to the last four. */
export function selfProfile(profile) {
  const mask = (v) => (v ? `••••${String(v).replace(/[^0-9A-Za-z]/g, '').slice(-4)}` : '')
  const s = profile.statutory
  return { ...profile, statutory: { tin: mask(s.tin), sss: mask(s.sss), philhealth: mask(s.philhealth), pagibig: mask(s.pagibig) } }
}
