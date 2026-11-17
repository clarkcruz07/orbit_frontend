import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/ui/Feedback'
import type { ImportReport } from './api'
import { filterRows, reasonText, rowErrorList, rowStatusWord, rowTone, summaryText, type ReportFilter } from './logic'
import { Pill } from './parts'

const SHOW_CAP = 200

/**
 * The per-row report of a CSV check or import. It shows only what the service returned (row number, result, reason, per-field
 * messages). Cell values are never shown: the service does not echo them and neither does this page.
 */
export function ImportReportView({ report }: { report: ImportReport }) {
  const [filter, setFilter] = useState<ReportFilter>(report.invalid > 0 ? 'invalid' : 'all')
  const [showAll, setShowAll] = useState(false)
  const rows = filterRows(report.rows, filter)
  const visible = showAll ? rows : rows.slice(0, SHOW_CAP)
  const tabs: { id: ReportFilter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: report.rows.length },
    { id: 'created', label: report.dry_run ? 'Would be created' : 'Created', n: report.created },
    { id: 'skipped', label: 'Skipped', n: report.skipped },
    { id: 'invalid', label: 'Invalid', n: report.invalid },
  ]

  return (
    <div className="pm-report" data-testid="import-report" data-dry-run={report.dry_run ? 'true' : 'false'}>
      <p className="pm-report-summary" data-testid="report-summary">
        {summaryText(report)}
      </p>
      <ul className="pm-report-counts" aria-label="Totals">
        <li data-testid="count-created">
          <Pill tone="green">{report.dry_run ? 'Would be created' : 'Created'}</Pill> <strong>{report.created}</strong>
        </li>
        <li data-testid="count-skipped">
          <Pill tone="amber">Skipped</Pill> <strong>{report.skipped}</strong>
        </li>
        <li data-testid="count-invalid">
          <Pill tone="red">Invalid</Pill> <strong>{report.invalid}</strong>
        </li>
      </ul>
      {report.ignored_columns.length ? (
        <p className="pm-help" data-testid="ignored-columns">
          Ignored columns (not used): {report.ignored_columns.join(', ')}.
        </p>
      ) : null}

      <div className="pm-subtabs" role="group" aria-label="Show rows">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`pm-subtab${filter === t.id ? ' active' : ''}`} aria-pressed={filter === t.id} onClick={() => setFilter(t.id)} data-testid={`report-filter-${t.id}`}>
            {t.label} ({t.n})
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="pm-muted" data-testid="report-none">
          No rows in this group.
        </p>
      ) : (
        <ul className="pm-report-rows" data-testid="report-rows">
          {visible.map((r) => {
            const errs = rowErrorList(r)
            return (
              <li key={r.row} className="pm-report-row" data-testid="report-row" data-status={r.status} data-reason={r.reason ?? ''}>
                <span className="pm-report-rownum">Row {r.row}</span>
                <span className="pm-report-status">
                  <Pill tone={rowTone(r.status)}>{rowStatusWord(r, report.dry_run)}</Pill>
                </span>
                <span className="pm-report-detail">
                  {reasonText(r) ? <span className="pm-wrap">{reasonText(r)}</span> : null}
                  {errs.length ? (
                    <ul className="pm-report-errors">
                      {errs.map((m) => (
                        <li key={m} className="pm-wrap">
                          {m}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {r.employee_id ? (
                    <Link to={`/people/${encodeURIComponent(r.employee_id)}`} className="pm-link" data-testid="report-open">
                      Open {r.employee_id}
                    </Link>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {!showAll && rows.length > SHOW_CAP ? (
        <button type="button" className="btn btn-secondary pm-more" onClick={() => setShowAll(true)} data-testid="report-show-all">
          Show all {rows.length} rows
        </button>
      ) : null}
      {report.invalid > 0 ? (
        <Alert tone="info">Invalid and skipped rows are left out. Fix them in your file and check it again, or import the rest now and add those people later.</Alert>
      ) : null}
    </div>
  )
}
