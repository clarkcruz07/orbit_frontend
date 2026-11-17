import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { Alert, Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { leaveApi, type EntitlementRow, type LeaveType } from './api'
import { EmployeePicker, type PickedEmployee } from './EmployeePicker'
import {
  DEFAULT_TYPE_IDS,
  EMPTY_TYPE_FORM,
  NAME_MAX,
  formatDays,
  friendlyError,
  parseDays,
  parseLeaveError,
  typeFormFrom,
  typeSummary,
  validateOverride,
  validateTypeForm,
  type OverrideErrors,
  type TypeFormErrors,
  type TypeFormValues,
} from './logic'
import { Pill } from './parts'

type Confirm = { id: string; kind: 'deactivate' | 'delete' } | null

// ------------------------------------------------------------------------------------------------ type form (add + edit)
function TypeForm({ initial, editingId, existing, onSaved, onCancel }: { initial: TypeFormValues; editingId: string | null; existing: LeaveType[]; onSaved: (message: string) => void; onCancel: () => void }) {
  const [v, setV] = useState<TypeFormValues>(initial)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [serverFields, setServerFields] = useState<TypeFormErrors>({})
  const errors = validateTypeForm(v, existing, editingId)
  const shown = attempted ? { ...serverFields, ...errors } : serverFields

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setServerError(null)
    if (Object.keys(errors).length > 0) return setAttempted(true)
    const body = { name: v.name.trim(), paid: v.paid, annual_days: parseDays(v.days) ?? 0, requires_reason: v.requiresReason }
    setBusy(true)
    try {
      if (editingId) await leaveApi.patchType(editingId, body)
      else await leaveApi.createType(body)
      onSaved(editingId ? `Saved "${body.name}". The values are no longer marked as defaults.` : `Added "${body.name}".`)
    } catch (err) {
      const info = parseLeaveError(err, 'The leave type could not be saved.')
      setServerError(friendlyError(info))
      const f: TypeFormErrors = {}
      if (info.status === 409) f.name = friendlyError(info)
      setServerFields(f)
      setBusy(false)
    }
  }

  const k = editingId ?? 'new'
  return (
    <form className="card card-pad lv-inline-form" onSubmit={submit} noValidate data-testid={editingId ? 'type-edit-form' : 'type-add-form'} aria-label={editingId ? 'Edit leave type' : 'Add leave type'}>
      <h3>{editingId ? 'Edit leave type' : 'Add leave type'}</h3>
      <div className="lv-inline-grid">
        <div className={`lv-field${shown.name ? ' has-error' : ''}`}>
          <label className="lv-label" htmlFor={`tn-${k}`}>
            Name
          </label>
          <input id={`tn-${k}`} className="lv-input" value={v.name} maxLength={NAME_MAX} disabled={busy} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="type-name" aria-invalid={Boolean(shown.name)} />
          <p className="lv-field-error" role="alert" data-testid="type-name-error">
            {shown.name}
          </p>
        </div>
        <div className={`lv-field${shown.days ? ' has-error' : ''}`}>
          <label className="lv-label" htmlFor={`td-${k}`}>
            Days per year
          </label>
          <input id={`td-${k}`} className="lv-input" inputMode="decimal" value={v.days} disabled={busy} onChange={(e) => setV({ ...v, days: e.target.value })} data-testid="type-days" aria-invalid={Boolean(shown.days)} />
          <p className="lv-field-error" role="alert" data-testid="type-days-error">
            {shown.days}
          </p>
        </div>
      </div>
      <div className="lv-checks">
        <label className="lv-check">
          <input type="checkbox" checked={v.paid} disabled={busy} onChange={(e) => setV({ ...v, paid: e.target.checked })} data-testid="type-paid" />
          <span>Paid type (balance is limited to the days per year; unpaid types have no limit)</span>
        </label>
        <label className="lv-check">
          <input type="checkbox" checked={v.requiresReason} disabled={busy} onChange={(e) => setV({ ...v, requiresReason: e.target.checked })} data-testid="type-reason" />
          <span>Requests of this type need a reason</span>
        </label>
      </div>
      {serverError ? (
        <div data-testid="type-error">
          <Alert tone="danger">{serverError}</Alert>
        </div>
      ) : null}
      <div className="lv-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="type-cancel">
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="type-save">
          {busy ? 'Saving...' : editingId ? 'Save changes' : 'Add leave type'}
        </button>
      </div>
    </form>
  )
}

// ------------------------------------------------------------------------------------------------ catalog
function TypesSection({ types, onReload }: { types: LeaveType[]; onReload: () => void }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)

  function saved(msg: string) {
    setAdding(false)
    setEditing(null)
    setMessage(msg)
    onReload()
  }

  async function run(t: LeaveType, work: () => Promise<unknown>, done: string) {
    setBusyId(t.type_id)
    setError(null)
    setMessage(null)
    try {
      await work()
      setConfirm(null)
      setMessage(done)
      onReload()
    } catch (err) {
      setConfirm(null)
      setError({ id: t.type_id, message: friendlyError(parseLeaveError(err, 'That change could not be saved.')) })
    } finally {
      setBusyId(null)
    }
  }

  const renderRow = (t: LeaveType) => {
    const canDelete = t.in_use === false && !DEFAULT_TYPE_IDS.includes(t.type_id)
    const asking = confirm?.id === t.type_id ? confirm.kind : null
    return (
      <>
        <div className="lv-type-actions">
          <button type="button" className="btn btn-secondary" onClick={() => { setAdding(false); setEditing(t.type_id) }} disabled={busyId === t.type_id} data-testid="type-edit">
            <Pencil size={15} aria-hidden="true" /> Edit
          </button>
          {t.active ? (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm({ id: t.type_id, kind: 'deactivate' })} disabled={busyId === t.type_id} data-testid="type-deactivate">
              <Power size={15} aria-hidden="true" /> Deactivate
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => void run(t, () => leaveApi.patchType(t.type_id, { active: true }), `"${t.name}" is available again.`)} disabled={busyId === t.type_id} data-testid="type-activate">
              <Power size={15} aria-hidden="true" /> Activate
            </button>
          )}
          {canDelete ? (
            <button type="button" className="btn lv-btn-danger-outline" onClick={() => setConfirm({ id: t.type_id, kind: 'delete' })} disabled={busyId === t.type_id} data-testid="type-delete">
              <Trash2 size={15} aria-hidden="true" /> Delete
            </button>
          ) : null}
        </div>
        {asking ? (
          <div className="lv-confirm" role="alertdialog" aria-label="Confirm" data-testid="type-confirm-box">
            <p>
              {asking === 'deactivate'
                ? `Deactivate "${t.name}"? Existing requests keep working, but nobody can request this type until you activate it again.`
                : `Delete "${t.name}" for good? Only types that no request ever used can be deleted. This cannot be undone.`}
            </p>
            <div className="lv-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)} disabled={busyId === t.type_id} data-testid="type-confirm-cancel">
                Keep it
              </button>
              <button
                type="button"
                className={`btn ${asking === 'delete' ? 'lv-btn-danger' : 'btn-primary'}`}
                onClick={() => void run(t, () => (asking === 'delete' ? leaveApi.deleteType(t.type_id) : leaveApi.patchType(t.type_id, { active: false })), asking === 'delete' ? `Deleted "${t.name}".` : `"${t.name}" is now inactive.`)}
                disabled={busyId === t.type_id}
                data-testid="type-confirm"
              >
                {asking === 'delete' ? 'Delete' : 'Deactivate'}
              </button>
            </div>
          </div>
        ) : null}
        {error?.id === t.type_id ? (
          <div data-testid="type-row-error">
            <Alert tone="danger">{error.message}</Alert>
          </div>
        ) : null}
      </>
    )
  }

  const editingType = types.find((t) => t.type_id === editing)

  return (
    <section className="lv-section" aria-labelledby="lv-types-h" data-testid="settings-types">
      <div className="lv-section-head">
        <div>
          <h2 id="lv-types-h">Leave types</h2>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setAdding(true) }} disabled={adding} data-testid="type-add">
          <Plus size={16} aria-hidden="true" /> Add leave type
        </button>
      </div>
      {message ? (
        <div className="lv-flash" data-testid="settings-flash">
          <Alert tone="info">{message}</Alert>
        </div>
      ) : null}
      {adding ? <TypeForm initial={EMPTY_TYPE_FORM} editingId={null} existing={types} onSaved={saved} onCancel={() => setAdding(false)} /> : null}
      {editingType ? <TypeForm key={editingType.type_id} initial={typeFormFrom(editingType)} editingId={editingType.type_id} existing={types} onSaved={saved} onCancel={() => setEditing(null)} /> : null}

      <div className="card lv-table-card" data-testid="types-table">
        <table className="lv-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Rule</th>
              <th scope="col">Status</th>
              <th scope="col">In use</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.type_id} data-testid="type-row" data-type={t.type_id} data-active={t.active ? 'true' : 'false'}>
                <td>
                  <strong className="lv-wrap">{t.name}</strong>
                </td>
                <td className="lv-wrap">{typeSummary(t)}</td>
                <td>
                  {t.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
                </td>
                <td>{t.in_use === null ? '-' : t.in_use ? 'Yes' : 'No'}</td>
                <td className="lv-actions-cell">
                  {renderRow(t)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="lv-cards" data-testid="types-cards">
        {types.map((t) => (
          <li key={t.type_id} className="card lv-card-item" data-testid="type-card" data-type={t.type_id}>
            <div className="lv-card-top">
              <strong>{t.name}</strong>
              <span>{t.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</span>
            </div>
            <div className="lv-card-meta">
              <span>{typeSummary(t)}</span>
            </div>
            {renderRow(t)}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ entitlement overrides
function OverridesSection({ types, year }: { types: LeaveType[]; year: number }) {
  const [rows, setRows] = useState<EntitlementRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterYear, setFilterYear] = useState('')
  const [employee, setEmployee] = useState<PickedEmployee | null>(null)
  const [typeId, setTypeId] = useState('')
  const [formYear, setFormYear] = useState(String(year))
  const [days, setDays] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [removing, setRemoving] = useState<EntitlementRow | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const values = { employeeId: employee?.employee_id ?? '', typeId, year: formYear, days }
  const errors: OverrideErrors = validateOverride(values)
  const shown: OverrideErrors = attempted ? errors : {}

  const load = useCallback(() => {
    let live = true
    setLoadError(null)
    leaveApi
      .entitlements({ year: filterYear ? Number(filterYear) : undefined })
      .then((r) => live && setRows(r.items))
      .catch((e) => live && setLoadError(friendlyError(parseLeaveError(e, 'The overrides could not be loaded.'))))
    return () => {
      live = false
    }
  }, [filterYear])
  useEffect(() => load(), [load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setServerError(null)
    setMessage(null)
    if (Object.keys(errors).length > 0) return setAttempted(true)
    setBusy(true)
    try {
      await leaveApi.setEntitlement({ employee_id: values.employeeId, type_id: typeId, year: Number(formYear), days: parseDays(days) ?? 0 })
      setMessage(`Saved: ${employee?.name} now has ${formatDays(parseDays(days))} of ${types.find((t) => t.type_id === typeId)?.name ?? typeId} for ${formYear}.`)
      setEmployee(null)
      setDays('')
      setAttempted(false)
      load()
    } catch (err) {
      setServerError(friendlyError(parseLeaveError(err, 'The override could not be saved.')))
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: EntitlementRow) {
    setBusy(true)
    setRemoveError(null)
    try {
      await leaveApi.removeEntitlement({ employee_id: row.employee_id, type_id: row.type_id, year: row.year })
      setRemoving(null)
      setMessage(`Removed the override for ${row.employee_name ?? row.employee_id}. The type's default applies again.`)
      load()
    } catch (err) {
      setRemoveError(friendlyError(parseLeaveError(err, 'The override could not be removed.')))
    } finally {
      setBusy(false)
    }
  }

  const yearChoices = [year + 1, year, year - 1, year - 2]

  return (
    <section className="lv-section" aria-labelledby="lv-ent-h" data-testid="settings-overrides">
      <div className="lv-section-head">
        <div>
          <h2 id="lv-ent-h">Entitlement overrides</h2>
          <p className="card-sub">Give one person a different entitlement for one year. Lowering it below what is already used is allowed: their remaining days go negative and new requests are refused.</p>
        </div>
      </div>

      <form className="card card-pad lv-inline-form" onSubmit={submit} noValidate data-testid="override-form" aria-label="Set an entitlement override">
        <h3>Set an override</h3>
        <EmployeePicker id="ov-employee" label="Employee name" value={employee} onChange={setEmployee} error={shown.employee} disabled={busy} />
        <div className="lv-inline-grid lv-inline-grid-3">
          <div className={`lv-field${shown.type ? ' has-error' : ''}`}>
            <label className="lv-label" htmlFor="ov-type">
              Leave type
            </label>
            <select id="ov-type" className="lv-input" value={typeId} disabled={busy} onChange={(e) => setTypeId(e.target.value)} data-testid="override-type" aria-invalid={Boolean(shown.type)}>
              <option value="">Select a type</option>
              {types.filter((t) => t.paid).map((t) => (
                <option key={t.type_id} value={t.type_id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="lv-field-error" role="alert">
              {shown.type}
            </p>
          </div>
          <div className={`lv-field${shown.year ? ' has-error' : ''}`}>
            <label className="lv-label" htmlFor="ov-year">
              Year
            </label>
            <input id="ov-year" className="lv-input" inputMode="numeric" value={formYear} disabled={busy} onChange={(e) => setFormYear(e.target.value)} data-testid="override-year" aria-invalid={Boolean(shown.year)} />
            <p className="lv-field-error" role="alert">
              {shown.year}
            </p>
          </div>
          <div className={`lv-field${shown.days ? ' has-error' : ''}`}>
            <label className="lv-label" htmlFor="ov-days">
              Days
            </label>
            <input id="ov-days" className="lv-input" inputMode="decimal" value={days} disabled={busy} onChange={(e) => setDays(e.target.value)} data-testid="override-days" aria-invalid={Boolean(shown.days)} />
            <p className="lv-field-error" role="alert">
              {shown.days}
            </p>
          </div>
        </div>
        {serverError ? (
          <div data-testid="override-error">
            <Alert tone="danger">{serverError}</Alert>
          </div>
        ) : null}
        <div className="lv-actions">
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="override-save">
            {busy ? 'Saving...' : 'Save override'}
          </button>
        </div>
      </form>

      {message ? (
        <div className="lv-flash" data-testid="override-flash">
          <Alert tone="info">{message}</Alert>
        </div>
      ) : null}

      <div className="lv-filters">
        <label className="lv-filter">
          <span className="lv-filter-label">Show year</span>
          <select className="lv-input" value={filterYear} onChange={(e) => setFilterYear(e.target.value)} data-testid="override-year-filter">
            <option value="">All years</option>
            {yearChoices.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loadError ? (
        <div data-testid="override-load-error">
          <Alert tone="danger">{loadError}</Alert>
          <button type="button" className="btn btn-secondary lv-retry" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : rows === null ? (
        <div className="card card-pad" aria-busy="true">
          <Skeleton style={{ height: 14, width: '80%', marginBottom: 10 }} />
          <Skeleton style={{ height: 14, width: '60%' }} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState plain title="No overrides" body="Everyone currently gets the default entitlement of each leave type." />
      ) : (
        <ul className="lv-override-list" data-testid="override-list">
          {rows.map((r) => {
            const key = `${r.employee_id}-${r.type_id}-${r.year}`
            const asking = removing && `${removing.employee_id}-${removing.type_id}-${removing.year}` === key
            return (
              <li key={key} className="card lv-override" data-testid="override-row" data-employee={r.employee_id} data-type={r.type_id} data-year={r.year}>
                <div className="lv-override-main">
                  <strong className="lv-wrap">{r.employee_name ?? r.employee_id}</strong>
                  <span className="lv-sub">
                    {r.type_name ?? r.type_id} - {r.year}
                  </span>
                </div>
                <div className="lv-override-days">
                  <span data-testid="override-days-value">{formatDays(r.days)}</span>
                </div>
                <button type="button" className="btn lv-btn-danger-outline" onClick={() => { setRemoveError(null); setRemoving(r) }} disabled={busy} data-testid="override-remove">
                  <Trash2 size={15} aria-hidden="true" /> Remove
                </button>
                {asking ? (
                  <div className="lv-confirm lv-override-confirm" role="alertdialog" aria-label="Confirm removal" data-testid="override-confirm-box">
                    <p>Remove this override? The default entitlement of the leave type applies again.</p>
                    <div className="lv-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => setRemoving(null)} disabled={busy} data-testid="override-remove-cancel">
                        Keep it
                      </button>
                      <button type="button" className="btn lv-btn-danger" onClick={() => void remove(r)} disabled={busy} data-testid="override-remove-confirm">
                        Remove override
                      </button>
                    </div>
                    {removeError ? <Alert tone="danger">{removeError}</Alert> : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** HR catalog admin inside the Leave page. The tab is offered by a navigation hint; every call is authorised by the server. */
export function SettingsTab({ year }: { year: number }) {
  const [types, setTypes] = useState<LeaveType[] | null>(null)
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null)

  const load = useCallback(() => {
    let live = true
    setError(null)
    leaveApi
      .types(true)
      .then((r) => live && setTypes(r.items))
      .catch((e) => {
        if (!live) return
        const info = parseLeaveError(e, 'The leave types could not be loaded.')
        setError({ message: friendlyError(info), forbidden: info.status === 403 })
      })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => load(), [load])

  return (
    <div data-testid="tab-panel-settings">
      {error ? (
        <div data-testid="settings-error">
          {error.forbidden ? (
            <EmptyState title="Leave settings are not available to you" body={error.message} />
          ) : (
            <>
              <Alert tone="danger">{error.message}</Alert>
              <button type="button" className="btn btn-secondary lv-retry" onClick={() => load()}>
                Try again
              </button>
            </>
          )}
        </div>
      ) : types === null ? (
        <div className="card card-pad" aria-busy="true" data-testid="settings-loading">
          <span className="sr-only" role="status">
            Loading leave settings
          </span>
          <Skeleton style={{ height: 18, width: '30%', marginBottom: 14 }} />
          <Skeleton style={{ height: 14, width: '90%' }} />
        </div>
      ) : (
        <>
          <TypesSection types={types} onReload={() => load()} />
          <OverridesSection types={types} year={year} />
        </>
      )}
    </div>
  )
}
