import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { directoryApi, type DirectReport, type DirectoryEntry } from '@/api/directory'
import { todayIso } from '@/lib/dates'
import { Alert } from '@/ui/Feedback'
import { useAuthStore } from '@/stores/authStore'
import { learningApi, type Course, type Enrolment } from './api'
import { useDebounced } from './hooks'
import { FieldError } from './parts'
import { addDays, parseServerError, validateAssign, type FieldErrors } from './logic'

interface Person {
  employee_id: string
  name: string
  detail: string | null
}

/**
 * Assign a course to a person with an optional due date and a mandatory switch. Who may be assigned is the server's
 * decision (managers: direct reports; HR: anyone else): the picker offers the directory and the user's direct
 * reports, and a refused assignment is shown inline. `course` fixes the course (catalog button); otherwise a select
 * of `courses` is shown.
 */
export function AssignPanel({
  course,
  courses,
  onCancel,
  onDone,
}: {
  course?: Course
  courses?: Course[]
  onCancel: () => void
  onDone: (e: Enrolment) => void
}) {
  const me = useAuthStore((s) => s.user?.employee_id ?? null)
  const [courseId, setCourseId] = useState(course?.course_id ?? courses?.[0]?.course_id ?? '')
  const chosen = course ?? courses?.find((c) => c.course_id === courseId) ?? null
  const [mandatory, setMandatory] = useState(chosen?.mandatory_default ?? false)
  const [dueDate, setDueDate] = useState('')
  const [person, setPerson] = useState<Person | null>(null)
  const [q, setQ] = useState('')
  const query = useDebounced(q.trim(), 300)
  const [results, setResults] = useState<Person[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [reports, setReports] = useState<DirectReport[]>([])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [server, setServer] = useState<{ detail: string; existing: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  // Quick picks: the caller's own direct reports (empty for people who have none).
  useEffect(() => {
    let live = true
    if (me)
      directoryApi
        .get(me)
        .then((p) => live && setReports(p.direct_reports))
        .catch(() => undefined)
    return () => {
      live = false
    }
  }, [me])

  useEffect(() => {
    if (query.length < 2) {
      setResults(null)
      setSearchError(null)
      return
    }
    let live = true
    directoryApi
      .list({ q: query, page_size: 8 })
      .then((p) => {
        if (!live) return
        setSearchError(null)
        setResults(p.items.map((x: DirectoryEntry) => ({ employee_id: x.employee_id, name: x.name, detail: [x.job_title, x.department].filter(Boolean).join(' - ') || null })))
      })
      .catch((e) => {
        if (!live) return
        setResults(null)
        setSearchError(parseServerError(e, 'People could not be searched.').detail)
      })
    return () => {
      live = false
    }
  }, [query])

  function pickCourse(id: string) {
    setCourseId(id)
    const c = courses?.find((x) => x.course_id === id)
    if (c) setMandatory(c.mandatory_default)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    // The server's date is the authority; the client only blocks dates that are clearly in the past (one day of tolerance).
    const found = validateAssign({ course_id: chosen?.course_id ?? '', employee_id: person?.employee_id ?? '', due_date: dueDate }, addDays(todayIso(new Date()), -1))
    setErrors(found)
    setServer(null)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const res = await learningApi.assign({ course_id: chosen!.course_id, employee_id: person!.employee_id, due_date: dueDate.trim() || null, mandatory })
      onDone(res.data)
    } catch (err) {
      const info = parseServerError(err, 'The course could not be assigned.')
      setErrors(info.fieldErrors)
      setServer({ detail: info.status === 403 ? 'You are not allowed to assign a course to that person.' : info.detail, existing: info.existingEnrolmentId })
    } finally {
      setBusy(false)
    }
  }

  const pickable = (results ?? []).filter((r) => r.employee_id !== me)

  return (
    <div className="card card-pad ln-form-card" data-testid="assign-panel">
      <div className="ln-card-head">
        <h3 className="ln-card-title">{course ? `Assign: ${course.title}` : 'Assign a course'}</h3>
        <button type="button" className="ln-iconbtn" onClick={onCancel} aria-label="Close the assign form" data-testid="assign-close">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <form className="ln-form" onSubmit={submit} noValidate>
        {!course ? (
          <div className="ln-field">
            <label className="ln-label" htmlFor="assign-course">
              Course
            </label>
            <select id="assign-course" className="ln-input ln-select" value={courseId} onChange={(e) => pickCourse(e.target.value)} data-testid="assign-course" aria-invalid={errors.course_id ? true : undefined}>
              {(courses ?? []).map((c) => (
                <option key={c.course_id} value={c.course_id}>
                  {c.title}
                </option>
              ))}
            </select>
            <FieldError id="assign-course-error" message={errors.course_id} />
          </div>
        ) : null}

        <div className="ln-field">
          <span className="ln-label" id="assign-person-label">
            Person
          </span>
          {person ? (
            <div className="ln-chosen" data-testid="assign-person" data-id={person.employee_id}>
              <span className="ln-chosen-name">{person.name}</span>
              {person.detail ? <span className="ln-sub">{person.detail}</span> : null}
              <button type="button" className="ln-linkbtn" onClick={() => setPerson(null)} data-testid="assign-person-clear">
                Change
              </button>
            </div>
          ) : (
            <>
              {reports.length > 0 ? (
                <div className="ln-quick" data-testid="assign-reports">
                  <span className="ln-sub">Your direct reports</span>
                  <div className="ln-chips">
                    {reports.map((r) => (
                      <button key={r.employee_id} type="button" className="ln-chip" onClick={() => setPerson({ employee_id: r.employee_id, name: r.name, detail: r.job_title })} data-testid={`assign-pick-${r.employee_id}`}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="ln-search">
                <Search size={16} aria-hidden="true" className="ln-search-icon" />
                <input
                  className="ln-input ln-search-input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search the directory by name"
                  aria-labelledby="assign-person-label"
                  aria-invalid={errors.employee_id ? true : undefined}
                  data-testid="assign-search"
                  autoComplete="off"
                />
              </div>
              {searchError ? <p className="ln-field-error" role="alert">{searchError}</p> : null}
              {query.length >= 2 && results && pickable.length === 0 ? (
                <p className="ln-help" data-testid="assign-no-results">
                  Nobody matches that search.
                </p>
              ) : null}
              {pickable.length > 0 ? (
                <ul className="ln-results" data-testid="assign-results">
                  {pickable.map((r) => (
                    <li key={r.employee_id}>
                      <button type="button" className="ln-result" onClick={() => setPerson(r)} data-testid={`assign-pick-${r.employee_id}`}>
                        <span className="ln-chosen-name">{r.name}</span>
                        {r.detail ? <span className="ln-sub">{r.detail}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          <FieldError id="assign-person-error" message={errors.employee_id} />
        </div>

        <div className="ln-field ln-field-narrow">
          <label className="ln-label" htmlFor="assign-due">
            Due date <span className="ln-opt">(optional)</span>
          </label>
          <input
            id="assign-due"
            type="date"
            className="ln-input"
            value={dueDate}
            min="2000-01-01"
            max="2100-12-31"
            onChange={(e) => setDueDate(e.target.value)}
            aria-invalid={errors.due_date ? true : undefined}
            aria-describedby={errors.due_date ? 'assign-due-error' : undefined}
            data-testid="assign-due"
          />
          <FieldError id="assign-due-error" message={errors.due_date} />
        </div>

        <label className="ln-check">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} data-testid="assign-mandatory" />
          <span>
            Mandatory
            <span className="ln-sub"> A mandatory course needs your confirmation once it is completed.</span>
          </span>
        </label>

        {server ? (
          <div data-testid="assign-error">
            <Alert tone="danger">
              {server.detail}
              {server.existing ? (
                <>
                  {' '}
                  <Link to={`/learning/enrolments/${encodeURIComponent(server.existing)}`} className="ln-inline-link">
                    Open the existing enrolment
                  </Link>
                </>
              ) : null}
            </Alert>
          </div>
        ) : null}
        <div className="ln-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="assign-cancel">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !chosen} data-testid="assign-submit">
            {busy ? 'Assigning...' : 'Assign course'}
          </button>
        </div>
      </form>
    </div>
  )
}
