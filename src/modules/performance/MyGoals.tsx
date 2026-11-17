import { useState } from 'react'
import { Plus, Target } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { performanceApi } from './api'
import { GoalForm } from './GoalForm'
import { useLoad } from './hooks'
import { GoalRows } from './lists'
import { ErrorBlock, LoadingCard, Pager } from './parts'
import { DEFAULT_LIMITS, GOAL_STATUSES, goalStatusLabel } from './logic'

const PAGE_SIZE = 20

export function MyGoals({ limits = DEFAULT_LIMITS, onChanged }: { limits?: typeof DEFAULT_LIMITS; onChanged?: () => void }) {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const list = useLoad(
    () => performanceApi.goals({ scope: 'mine', status, page, page_size: PAGE_SIZE }).then((r) => r.data),
    [status, page],
    'Your goals could not be loaded.',
  )

  return (
    <section aria-labelledby="my-goals-title" data-testid="my-goals">
      <div className="pf-toolbar">
        <h2 id="my-goals-title" className="pf-section-title">
          My goals
        </h2>
        <div className="pf-toolbar-right">
          <label className="pf-filter">
            <span className="pf-visually-hidden">Filter by status</span>
            <select
              className="pf-input pf-select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(1)
              }}
              data-testid="goal-status-filter"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {GOAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {goalStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          {!creating ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-goal">
              <Plus size={16} aria-hidden="true" /> New goal
            </button>
          ) : null}
        </div>
      </div>

      {flash ? (
        <p className="pf-flash" role="status" data-testid="goal-flash">
          {flash}
        </p>
      ) : null}

      {creating ? (
        <div className="card card-pad pf-form-card" data-testid="goal-create-card">
          <h3 className="pf-card-title">New goal</h3>
          <p className="pf-help">Only you can edit your goal. Your manager and HR can read it, and your manager can comment on it.</p>
          <GoalForm
            limits={limits}
            onCancel={() => setCreating(false)}
            onSaved={(g) => {
              setCreating(false)
              setFlash(`Goal created: ${g.title}`)
              setPage(1)
              list.reload()
              onChanged?.()
            }}
          />
        </div>
      ) : null}

      {list.error ? (
        <ErrorBlock message={list.error.detail} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <LoadingCard />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Target size={28} />}
          title={status ? 'No goals with this status' : 'You have no goals yet'}
          body={status ? 'Try another status filter.' : 'Create a goal to track what you are working towards. Goals carry no score or rating.'}
          action={
            !status && !creating ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-goal-empty">
                <Plus size={16} aria-hidden="true" /> New goal
              </button>
            ) : undefined
          }
        />
      ) : list.data ? (
        <>
          <GoalRows goals={list.data.items} />
          <Pager page={list.data.page} total={list.data.total} pageSize={list.data.page_size} onPage={setPage} />
        </>
      ) : null}
    </section>
  )
}
