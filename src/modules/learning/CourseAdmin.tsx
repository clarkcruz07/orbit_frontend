import { useState, type FormEvent } from 'react'
import { BookOpen, Pencil, Plus } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { Alert } from '@/ui/Feedback'
import { learningApi, type Course, type CoursePage } from './api'
import { useLoad } from './hooks'
import { Counter, ErrorBlock, FieldError, LoadingCard, Pager, Pill } from './parts'
import { DELIVERIES, DEFAULT_LIMITS, courseBody, deliveryLabel, durationLabel, emptyCourseForm, formFromCourse, parseServerError, validateCourse, type CourseForm, type FieldErrors } from './logic'

const PAGE_SIZE = 20

/** HR course catalog admin: create, edit, deactivate/reactivate. Courses are never deleted (the API has no delete). */
export function CourseAdmin({ limits = DEFAULT_LIMITS, onChanged }: { limits?: typeof DEFAULT_LIMITS; onChanged?: () => void }) {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'all' | 'true' | 'false'>('all')
  const [editing, setEditing] = useState<Course | 'new' | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const list = useLoad<CoursePage>(() => learningApi.courses({ active: filter, page, page_size: PAGE_SIZE }).then((r) => r.data), [filter, page], 'The courses could not be loaded.')

  async function toggleActive(c: Course) {
    if (busyId) return
    setBusyId(c.course_id)
    setActionError(null)
    setFlash(null)
    try {
      await learningApi.patchCourse(c.course_id, { active: !c.active, version: c.version })
      setFlash(c.active ? `${c.title} is deactivated: it can no longer be taken or assigned. Existing enrolments carry on.` : `${c.title} is active again.`)
      list.reload()
      onChanged?.()
    } catch (e) {
      const info = parseServerError(e, 'The course could not be updated.')
      setActionError(info.status === 409 ? `${info.detail} The list has been refreshed.` : info.detail)
      if (info.status === 409) list.reload()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="ln-subsection" aria-labelledby="admin-title" data-testid="course-admin">
      <div className="ln-toolbar">
        <h3 id="admin-title" className="ln-card-title">
          Course catalog {list.data ? `(${list.data.total})` : ''}
        </h3>
        <div className="ln-toolbar-right">
          <label className="ln-filter">
            <span className="ln-visually-hidden">Show</span>
            <select
              className="ln-input ln-select"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as 'all' | 'true' | 'false')
                setPage(1)
              }}
              aria-label="Show courses"
              data-testid="admin-active-filter"
            >
              <option value="all">All courses</option>
              <option value="true">Active only</option>
              <option value="false">Inactive only</option>
            </select>
          </label>
          {editing === null ? (
            <button type="button" className="btn btn-primary" onClick={() => setEditing('new')} data-testid="admin-new-course">
              <Plus size={16} aria-hidden="true" /> New course
            </button>
          ) : null}
        </div>
      </div>

      {flash ? (
        <p className="ln-flash" role="status" data-testid="admin-flash">
          {flash}
        </p>
      ) : null}
      {actionError ? (
        <div className="ln-flash-block" data-testid="admin-action-error">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      ) : null}

      {editing !== null ? (
        <CourseFormCard
          key={editing === 'new' ? 'new' : editing.course_id}
          course={editing === 'new' ? undefined : editing}
          limits={limits}
          onCancel={() => setEditing(null)}
          onSaved={(c, created) => {
            setEditing(null)
            setFlash(created ? `Course created: ${c.title}` : `Course saved: ${c.title}`)
            list.reload()
            onChanged?.()
          }}
          onStale={() => list.reload()}
        />
      ) : null}

      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingCard />
      ) : list.data.items.length === 0 ? (
        <EmptyState plain icon={<BookOpen size={24} />} title="No courses" body="Create a course to add it to the catalog." />
      ) : (
        <>
          <ul className="ln-rows" data-testid="admin-course-list">
            {list.data.items.map((c) => (
              <li key={c.course_id}>
                <div className="ln-row ln-row-static card" data-testid="admin-course-row" data-id={c.course_id} data-active={c.active ? 'true' : 'false'}>
                  <div className="ln-row-main">
                    <strong className="ln-row-title ln-row-title-plain">{c.title}</strong>
                    <div className="ln-sub">{[c.category, deliveryLabel(c.delivery), durationLabel(c.duration_hours)].join(' - ')}</div>
                    <div className="ln-row-pills ln-pills-top">
                      {c.mandatory_default ? <Pill tone="violet">Mandatory by default</Pill> : null}
                      <Pill tone={c.active ? 'green' : 'amber'} testId="admin-course-state">
                        {c.active ? 'Active' : 'Inactive'}
                      </Pill>
                    </div>
                  </div>
                  <div className="ln-row-side ln-row-buttons">
                    <button type="button" className="btn btn-secondary" onClick={() => setEditing(c)} data-testid="admin-edit-course">
                      <Pencil size={16} aria-hidden="true" /> Edit
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => toggleActive(c)} disabled={busyId !== null} data-testid="admin-toggle-course">
                      {busyId === c.course_id ? 'Saving...' : c.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Pager page={list.data.page} total={list.data.total} pageSize={list.data.page_size} onPage={setPage} />
        </>
      )}
    </section>
  )
}

function CourseFormCard({
  course,
  limits,
  onCancel,
  onSaved,
  onStale,
}: {
  course?: Course
  limits: typeof DEFAULT_LIMITS
  onCancel: () => void
  onSaved: (c: Course, created: boolean) => void
  onStale: () => void
}) {
  const [f, setF] = useState<CourseForm>(course ? formFromCourse(course) : emptyCourseForm())
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof CourseForm>(k: K, v: CourseForm[K]) => setF((p) => ({ ...p, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const found = validateCourse(f, limits)
    setErrors(found)
    setServerError(null)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const body = courseBody(f)
      const res = course ? await learningApi.patchCourse(course.course_id, { ...body, version: course.version }) : await learningApi.createCourse(body)
      onSaved(res.data, !course)
    } catch (err) {
      const info = parseServerError(err, 'The course could not be saved.')
      if (info.status === 409 && course) onStale()
      setErrors(info.fieldErrors)
      setServerError(info.detail)
    } finally {
      setBusy(false)
    }
  }

  const id = course?.course_id ?? 'new'
  return (
    <div className="card card-pad ln-form-card" data-testid="course-form-card">
      <h3 className="ln-card-title">{course ? `Edit: ${course.title}` : 'New course'}</h3>
      <form className="ln-form" onSubmit={submit} noValidate>
        <div className="ln-field">
          <label className="ln-label" htmlFor={`c-title-${id}`}>
            Title <span className="ln-req" aria-hidden="true">*</span>
          </label>
          <input id={`c-title-${id}`} className="ln-input" value={f.title} onChange={(e) => set('title', e.target.value)} aria-invalid={errors.title ? true : undefined} aria-describedby={errors.title ? `c-title-${id}-e` : undefined} data-testid="course-title-input" autoComplete="off" />
          <div className="ln-help-row">
            <FieldError id={`c-title-${id}-e`} message={errors.title} />
            <Counter value={f.title} max={limits.title_max} />
          </div>
        </div>
        <div className="ln-field">
          <label className="ln-label" htmlFor={`c-cat-${id}`}>
            Category <span className="ln-req" aria-hidden="true">*</span>
          </label>
          <input id={`c-cat-${id}`} className="ln-input" value={f.category} onChange={(e) => set('category', e.target.value)} aria-invalid={errors.category ? true : undefined} aria-describedby={errors.category ? `c-cat-${id}-e` : undefined} data-testid="course-category-input" autoComplete="off" />
          <div className="ln-help-row">
            <FieldError id={`c-cat-${id}-e`} message={errors.category} />
            <Counter value={f.category} max={limits.category_max} />
          </div>
        </div>
        <div className="ln-field">
          <label className="ln-label" htmlFor={`c-desc-${id}`}>
            Description <span className="ln-opt">(optional)</span>
          </label>
          <textarea id={`c-desc-${id}`} className="ln-input ln-textarea" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} aria-invalid={errors.description ? true : undefined} aria-describedby={errors.description ? `c-desc-${id}-e` : undefined} data-testid="course-description-input" />
          <div className="ln-help-row">
            <FieldError id={`c-desc-${id}-e`} message={errors.description} />
            <Counter value={f.description} max={limits.description_max} />
          </div>
        </div>
        <div className="ln-two">
          <div className="ln-field">
            <label className="ln-label" htmlFor={`c-dur-${id}`}>
              Duration (hours) <span className="ln-req" aria-hidden="true">*</span>
            </label>
            <input id={`c-dur-${id}`} className="ln-input" inputMode="decimal" value={f.duration_hours} onChange={(e) => set('duration_hours', e.target.value)} aria-invalid={errors.duration_hours ? true : undefined} aria-describedby={errors.duration_hours ? `c-dur-${id}-e` : undefined} data-testid="course-duration-input" autoComplete="off" />
            <FieldError id={`c-dur-${id}-e`} message={errors.duration_hours} />
          </div>
          <div className="ln-field">
            <label className="ln-label" htmlFor={`c-del-${id}`}>
              Delivery
            </label>
            <select id={`c-del-${id}`} className="ln-input ln-select" value={f.delivery} onChange={(e) => set('delivery', e.target.value as CourseForm['delivery'])} data-testid="course-delivery-input">
              {DELIVERIES.map((d) => (
                <option key={d} value={d}>
                  {deliveryLabel(d)}
                </option>
              ))}
            </select>
            <FieldError id={`c-del-${id}-e`} message={errors.delivery} />
          </div>
        </div>
        <label className="ln-check">
          <input type="checkbox" checked={f.mandatory_default} onChange={(e) => set('mandatory_default', e.target.checked)} data-testid="course-mandatory-input" />
          <span>
            Mandatory by default
            <span className="ln-sub"> Self-enrolments and assignments start as mandatory, which needs a confirmation on completion.</span>
          </span>
        </label>
        {!course ? (
          <label className="ln-check">
            <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} data-testid="course-active-input" />
            <span>Active (available in the catalog)</span>
          </label>
        ) : null}
        {serverError ? (
          <div data-testid="course-form-error">
            <Alert tone="danger">{serverError}</Alert>
          </div>
        ) : null}
        <div className="ln-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="course-cancel">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="course-save">
            {busy ? 'Saving...' : course ? 'Save course' : 'Create course'}
          </button>
        </div>
      </form>
    </div>
  )
}
