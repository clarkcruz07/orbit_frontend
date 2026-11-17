import { Trash2 } from 'lucide-react'
import {
  CELL_MESSAGE,
  cellKey,
  dayMonth,
  formatDayLabel,
  formatHours,
  weekdayShort,
  type CellIssue,
  type GridRow,
  type GridTotals,
  type GridValidation,
} from './logic'

export interface SheetGridProps {
  days: readonly string[]
  rows: readonly GridRow[]
  editable: boolean
  phone: boolean
  validation: GridValidation
  totals: GridTotals
  onCell: (codeId: string, day: string, text: string) => void
  onRemove: (codeId: string) => void
}

function CellInput({ row, day, issue, onCell }: { row: GridRow; day: string; issue: CellIssue | undefined; onCell: SheetGridProps['onCell'] }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`ts-input ts-cell${issue ? ' invalid' : ''}`}
      value={row.cells[day] ?? ''}
      onChange={(e) => onCell(row.code_id, day, e.target.value)}
      aria-label={`${row.code_name}, ${formatDayLabel(day)}, hours`}
      aria-invalid={Boolean(issue)}
      title={issue ? CELL_MESSAGE[issue] : undefined}
      placeholder="0"
      data-testid={`cell-${row.code_id}-${day}`}
    />
  )
}

function CodeLabel({ row }: { row: GridRow }) {
  return (
    <span className="ts-code">
      <span className="ts-code-name">{row.code_name}</span>
      {row.billable ? <span className="ts-code-tag">Billable</span> : null}
      {!row.code_active ? <span className="ts-code-tag ts-code-tag-off">Inactive</span> : null}
    </span>
  )
}

function RemoveButton({ row, onRemove }: { row: GridRow; onRemove: SheetGridProps['onRemove'] }) {
  return (
    <button type="button" className="ts-icon-btn" onClick={() => onRemove(row.code_id)} aria-label={`Remove ${row.code_name}`} data-testid={`remove-${row.code_id}`}>
      <Trash2 size={16} aria-hidden="true" />
    </button>
  )
}

/** The weekly grid (codes down, Monday to Sunday across). On phones the same data is stacked as one card per day. */
export function SheetGrid({ days, rows, editable, phone, validation, totals, onCell, onRemove }: SheetGridProps) {
  if (phone) {
    return (
      <div className="ts-stacked" data-testid="sheet-grid" data-layout="stacked">
        <p className="ts-week-total" data-testid="week-total-card">
          Week total <strong data-testid="week-total">{formatHours(totals.total)}</strong> h
        </p>
        {days.map((d) => (
          <section key={d} className={`ts-day-card${validation.dayIssues[d] ? ' flagged' : ''}`} aria-label={formatDayLabel(d)} data-testid="day-stack" data-date={d}>
            <div className="ts-day-card-top">
              <strong>{formatDayLabel(d)}</strong>
              <span className="ts-day-card-hours" data-testid={`day-total-${d}`}>
                {formatHours(totals.dayTotals[d])} h
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="ts-muted">No codes on this week yet.</p>
            ) : (
              <ul className="ts-stack-rows">
                {rows.map((r) => (
                  <li key={r.code_id}>
                    <label className="ts-stack-row">
                      <CodeLabel row={r} />
                      {editable ? (
                        <CellInput row={r} day={d} issue={validation.cellIssues[cellKey(r.code_id, d)]} onCell={onCell} />
                      ) : (
                        <span className="ts-readonly-cell" data-testid={`cell-${r.code_id}-${d}`}>
                          {r.cells[d] ? formatHours(Number(r.cells[d])) : '-'}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {validation.dayIssues[d] ? (
              <p className="ts-field-error" role="alert">
                {validation.dayIssues[d]}
              </p>
            ) : null}
          </section>
        ))}
        {editable && rows.length > 0 ? (
          <ul className="ts-remove-list" aria-label="Rows on this timesheet">
            {rows.map((r) => (
              <li key={r.code_id}>
                <CodeLabel row={r} /> <RemoveButton row={r} onRemove={onRemove} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  return (
    <div className="ts-grid-wrap" data-testid="sheet-grid" data-layout="table">
      <table className="ts-grid">
        <thead>
          <tr>
            <th scope="col" className="ts-grid-code">
              Code
            </th>
            {days.map((d) => (
              <th key={d} scope="col" className={validation.dayIssues[d] ? 'flagged' : undefined}>
                <span className="ts-grid-wd">{weekdayShort(d)}</span>
                <span className="ts-grid-date">{dayMonth(d)}</span>
              </th>
            ))}
            <th scope="col" className="ts-grid-total">
              Total
            </th>
            {editable ? (
              <th scope="col" className="ts-grid-remove">
                <span className="sr-only">Remove row</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={days.length + (editable ? 3 : 2)} className="ts-grid-empty" data-testid="grid-empty">
                {editable ? 'No rows yet. Add a code below to start entering hours.' : 'No hours were recorded for this week.'}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.code_id} data-testid="grid-row" data-code={r.code_id}>
                <th scope="row" className="ts-grid-code">
                  <CodeLabel row={r} />
                </th>
                {days.map((d) => (
                  <td key={d}>
                    {editable ? (
                      <CellInput row={r} day={d} issue={validation.cellIssues[cellKey(r.code_id, d)]} onCell={onCell} />
                    ) : (
                      <span className="ts-readonly-cell" data-testid={`cell-${r.code_id}-${d}`}>
                        {r.cells[d] ? formatHours(Number(r.cells[d])) : '-'}
                      </span>
                    )}
                  </td>
                ))}
                <td className="ts-grid-total" data-testid={`row-total-${r.code_id}`}>
                  {formatHours(totals.rowTotals[r.code_id])}
                </td>
                {editable ? (
                  <td className="ts-grid-remove">
                    <RemoveButton row={r} onRemove={onRemove} />
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="ts-grid-code">
              Day total
            </th>
            {days.map((d) => (
              <td key={d} className={`ts-grid-daytotal${validation.dayIssues[d] ? ' flagged' : ''}`} data-testid={`day-total-${d}`}>
                {formatHours(totals.dayTotals[d])}
              </td>
            ))}
            <td className="ts-grid-total ts-grid-weektotal" data-testid="week-total">
              {formatHours(totals.total)}
            </td>
            {editable ? <td /> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
