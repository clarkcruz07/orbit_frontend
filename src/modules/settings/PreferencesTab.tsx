import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { settingsApi, type PrefGroup, type PrefItem } from './api'
import { PREFS_DETAIL, PREFS_NOTE, describeError, formatWhen, groupEnabled, rollbackMessage, savedMessage, toggled } from './logic'
import { Panel, RowsSkeleton, Switch } from './parts'

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' }

/** "My preferences": the seven notification groups. Optimistic switches that roll back (with a clear error) if the save fails. */
export function PreferencesTab() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [items, setItems] = useState<PrefItem[]>([])
  const itemsRef = useRef<PrefItem[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [pending, setPending] = useState<ReadonlySet<PrefGroup>>(new Set())
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const commit = useCallback((next: PrefItem[] | ((cur: PrefItem[]) => PrefItem[])) => {
    const value = typeof next === 'function' ? next(itemsRef.current) : next
    itemsRef.current = value
    setItems(value)
  }, [])

  const fetchPrefs = useCallback(() => {
    setLoad({ kind: 'loading' })
    settingsApi
      .preferences()
      .then((p) => {
        commit(p.items)
        setUpdatedAt(p.updated_at)
        setLoad({ kind: 'ready' })
      })
      .catch((err) => setLoad({ kind: 'error', message: describeError(err, 'Your notification preferences could not be loaded.').message }))
  }, [commit])

  useEffect(() => {
    fetchPrefs()
  }, [fetchPrefs])

  async function change(item: PrefItem, next: boolean) {
    if (pending.has(item.group)) return
    const before = groupEnabled(itemsRef.current, item.group)
    commit((cur) => toggled(cur, item.group, next))
    setPending((p) => new Set(p).add(item.group))
    setStatus(null)
    setError(null)
    try {
      const saved = await settingsApi.savePreferences({ [item.group]: next })
      commit((cur) => toggled(cur, item.group, groupEnabled(saved.items, item.group)))
      setUpdatedAt(saved.updated_at)
      setStatus(savedMessage(item.label, groupEnabled(saved.items, item.group)))
    } catch (err) {
      commit((cur) => toggled(cur, item.group, before))
      setError(rollbackMessage(item.label, before, describeError(err, `Your change to ${item.label} was not saved.`).message))
    } finally {
      setPending((p) => {
        const n = new Set(p)
        n.delete(item.group)
        return n
      })
    }
  }

  const saved = formatWhen(updatedAt)

  return (
    <div className="st-stack" data-testid="tab-preferences">
      <Alert tone="info">{PREFS_NOTE}</Alert>

      <Panel id="st-notif-h" title="Notifications" sub={PREFS_DETAIL} testId="prefs-panel">
        {load.kind === 'loading' ? <RowsSkeleton rows={7} height={58} /> : null}
        {load.kind === 'error' ? (
          <div className="st-error" data-testid="prefs-error">
            <Alert tone="danger">{load.message}</Alert>
            <button type="button" className="btn btn-secondary" onClick={fetchPrefs}>
              Try again
            </button>
          </div>
        ) : null}
        {load.kind === 'ready' ? (
          <>
            <ul className="st-rows" data-testid="prefs-list">
              {items.map((item) => {
                const labelId = `pref-${item.group}-label`
                const descId = `pref-${item.group}-desc`
                return (
                  <li key={item.group} className="st-row" data-testid={`pref-${item.group}`}>
                    <span className="st-tile" aria-hidden="true">
                      <BellRing size={20} strokeWidth={1.7} />
                    </span>
                    <div className="st-row-text">
                      <strong id={labelId}>{item.label}</strong>
                      <span id={descId}>{item.description}</span>
                    </div>
                    <Switch checked={item.enabled} busy={pending.has(item.group)} labelId={labelId} describedBy={descId} onChange={(next) => void change(item, next)} testId={`pref-switch-${item.group}`} />
                  </li>
                )
              })}
            </ul>
            <div className="st-feedback" aria-live="polite" data-testid="prefs-status">
              {status ? <span className="st-ok">{status}</span> : null}
            </div>
            {error ? (
              <div className="st-feedback-error" data-testid="prefs-save-error">
                <Alert tone="danger">{error}</Alert>
              </div>
            ) : null}
            <p className="st-foot">{saved ? `Last saved ${saved}.` : 'Nothing saved yet: every group is on, the default.'}</p>
          </>
        ) : null}
      </Panel>
    </div>
  )
}
