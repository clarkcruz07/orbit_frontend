import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Clock, UserPlus } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { Alert } from '@/ui/Feedback'
import { learningApi, type Course, type CoursePage, type Enrolment } from './api'
import { AssignPanel } from './AssignPanel'
import { useDebounced, useLoad } from './hooks'
import { ErrorBlock, LoadingCard, Pager, Pill } from './parts'
import { DELIVERIES, courseCan, deliveryLabel, durationLabel, enrolmentBlurb, parseServerError } from './logic'

const PAGE_SIZE = 12

export function Catalog({ onChanged }: { onChanged?: () => void }) {
  const [qText, setQText] = useState('')
  const q = useDebounced(qText, 300)
  const [category, setCategory] = useState('')
  const [delivery, setDelivery] = useState('')
  const [page, setPage] = useState(1)
  const [assigning, setAssigning] = useState<Course | null>(null)
  const [flash, setFlash] = useState<{ text: string; id: string | null } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])

  const list = useLoad<CoursePage>(
    () =>
      learningApi.courses({ q, category, delivery, page, page_size: PAGE_SIZE }).then((r) => {
        setCategories((prev) => (r.data.categories.length >= prev.length ? r.data.categories : prev))
        return r.data
      }),
    [q, category, delivery, page],
    'The course catalog could not be loaded.',
  )

  async function enrol(c: Course) {
    if (busyId) return
    setBusyId(c.course_id)
    setActionError(null)
    setFlash(null)
    try {
      const res = await learningApi.enrol(c.course_id)
      setFlash({ text: `You are enrolled in ${c.title}.`, id: res.data.enrolment_id })
      list.reload()
      onChanged?.()
    } catch (e) {
      const info = parseServerError(e, 'You could not be enrolled.')
      setActionError(info.detail)
      if (info.status === 409) list.reload()
    } finally {
      setBusyId(null)
    }
  }

  function assigned(e: Enrolment) {
    setAssigning(null)
    setFlash({ text: `Assigned ${e.course.title} to ${e.employee.name ?? e.employee.employee_id}.`, id: null })
    list.reload()
    onChanged?.()
  }

  const filtered = Boolean(q || category || delivery)

  return (
    <section aria-labelledby="catalog-title" data-testid="catalog">
      <div className="ln-toolbar">
        <h2 id="catalog-title" className="ln-section-title">
          Course catalog
        </h2>
      </div>

      <div className="ln-filters" data-testid="catalog-filters">
        <label className="ln-filter-field ln-filter-wide">
          <span className="ln-label">Search</span>
          <input
            className="ln-input"
            type="search"
            value={qText}
            onChange={(e) => {
              setQText(e.target.value)
              setPage(1)
            }}
            placeholder="Title, topic or category"
            maxLength={100}
            data-testid="catalog-search"
            autoComplete="off"
          />
        </label>
        <label className="ln-filter-field">
          <span className="ln-label">Category</span>
          <select
            className="ln-input ln-select"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setPage(1)
            }}
            data-testid="catalog-category"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="ln-filter-field">
          <span className="ln-label">Delivery</span>
          <select
            className="ln-input ln-select"
            value={delivery}
            onChange={(e) => {
              setDelivery(e.target.value)
              setPage(1)
            }}
            data-testid="catalog-delivery"
          >
            <option value="">Any delivery</option>
            {DELIVERIES.map((d) => (
              <option key={d} value={d}>
                {deliveryLabel(d)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {flash ? (
        <p className="ln-flash" role="status" data-testid="catalog-flash">
          {flash.text}
          {flash.id ? (
            <>
              {' '}
              <Link to={`/learning/enrolments/${encodeURIComponent(flash.id)}`} className="ln-inline-link" data-testid="flash-open">
                Open it
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {actionError ? (
        <div className="ln-flash-block" data-testid="catalog-action-error">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      ) : null}

      {assigning ? <AssignPanel course={assigning} onCancel={() => setAssigning(null)} onDone={assigned} /> : null}

      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} />
      ) : !list.data ? (
        <LoadingCard />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={28} />}
          title={filtered ? 'No courses match' : 'No courses are available yet'}
          body={filtered ? 'Try a different search or clear a filter.' : 'Courses that HR adds to the catalog appear here.'}
        />
      ) : (
        <>
          <ul className="ln-cards" data-testid="course-list">
            {list.data.items.map((c) => (
              <li key={c.course_id}>
                <CourseCard course={c} busy={busyId === c.course_id} onEnrol={() => enrol(c)} onAssign={() => setAssigning(c)} />
              </li>
            ))}
          </ul>
          <Pager page={list.data.page} total={list.data.total} pageSize={list.data.page_size} onPage={setPage} />
        </>
      )}
    </section>
  )
}

export function CourseCard({ course: c, busy, onEnrol, onAssign }: { course: Course; busy: boolean; onEnrol: () => void; onAssign: () => void }) {
  const blurb = enrolmentBlurb(c)
  return (
    <article className="card card-pad ln-course" data-testid="course-card" data-id={c.course_id}>
      <div className="ln-course-head">
        <h3 className="ln-course-title" data-testid="course-title">
          {c.title}
        </h3>
        <div className="ln-row-pills">
          {c.mandatory_default ? (
            <Pill tone="violet" testId="course-mandatory">
              Mandatory by default
            </Pill>
          ) : null}
          {!c.active ? (
            <Pill tone="amber" testId="course-inactive">
              Inactive
            </Pill>
          ) : null}
        </div>
      </div>
      <p className="ln-course-meta">
        <span>{c.category}</span>
        <span>{deliveryLabel(c.delivery)}</span>
        <span className="ln-inline-icon">
          <Clock size={14} aria-hidden="true" /> {durationLabel(c.duration_hours)}
        </span>
      </p>
      {c.description ? <p className="ln-course-desc">{c.description}</p> : null}
      <div className="ln-course-actions">
        {c.my_enrolment ? (
          <Link to={`/learning/enrolments/${encodeURIComponent(c.my_enrolment.enrolment_id)}`} className="btn btn-secondary" data-testid="course-open">
            {blurb ? `${blurb} - open` : 'Open'}
          </Link>
        ) : null}
        {courseCan(c, 'enrol') ? (
          <button type="button" className="btn btn-primary" onClick={onEnrol} disabled={busy} data-testid="course-enrol">
            {busy ? 'Enrolling...' : 'Enrol'}
          </button>
        ) : null}
        {courseCan(c, 'assign') ? (
          <button type="button" className="btn btn-secondary" onClick={onAssign} data-testid="course-assign">
            <UserPlus size={16} aria-hidden="true" /> Assign
          </button>
        ) : null}
      </div>
    </article>
  )
}
