import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, FileUp } from 'lucide-react'
import { PageTitle } from '@/pages/PageTitle'
import { Alert } from '@/ui/Feedback'
import { parseFailure } from './api'
import { failureMessage, saveBlob } from './logic'
import { LoadingCard, NotAvailable, useHrAccess } from './parts'
import {
  MATCHED_BY,
  P201_MAX_BYTES,
  P201_MAX_ROWS,
  defaultSelection,
  key,
  profile201Api,
  selectionBody,
  type P201Applied,
  type P201Preview,
} from './profile201'
import '@/pages/pages.css'
import './peoplemgmt.css'

type Phase = 'idle' | 'checking' | 'checked' | 'applying' | 'done'

/** HR: the 201 file. Check the spreadsheet (nothing is saved), tick what to accept, then apply. Fills each person's profile (My Profile). */
export function Profile201Page() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<P201Preview | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<P201Applied | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const access = useHrAccess()
  const busy = phase === 'checking' || phase === 'applying'

  function choose(next: File | null) {
    setFile(next)
    setPreview(null)
    setResult(null)
    setError(null)
    setPhase('idle')
    if (next && next.size > P201_MAX_BYTES) setError('The file is larger than 5 MB. Split it into smaller files.')
  }

  function fail(err: unknown, back: Phase) {
    const f = parseFailure(err)
    if (f.status === 403) setDenied(true)
    setError(f.status === 413 ? 'The file is larger than 5 MB. Split it into smaller files.' : f.status === 422 && f.detail ? f.detail : failureMessage(f, 'The file could not be processed.'))
    setPhase(back)
  }

  async function check() {
    if (!file || busy || file.size > P201_MAX_BYTES) return
    setPhase('checking')
    setError(null)
    try {
      const p = await profile201Api.preview(file)
      setPreview(p)
      setPicked(defaultSelection(p))
      setPhase('checked')
    } catch (err) {
      fail(err, 'idle')
    }
  }

  async function apply() {
    if (!preview?.batch_id || busy || picked.size === 0) return
    setPhase('applying')
    setError(null)
    try {
      setResult(await profile201Api.apply(preview.batch_id, selectionBody(preview, picked)))
      setPhase('done')
    } catch (err) {
      fail(err, 'checked')
    }
  }

  async function template() {
    setTemplateBusy(true)
    try {
      saveBlob(await profile201Api.template(), '201_file_template.xlsx')
    } catch (err) {
      setError(failureMessage(parseFailure(err), 'The template could not be downloaded.'))
    } finally {
      setTemplateBusy(false)
    }
  }

  function toggle(k: string) {
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }
  function tickAll(onlyNew: boolean) {
    if (!preview) return
    const next = new Set<string>()
    for (const r of preview.rows) for (const c of r.changes) if (r.employee_id && (!onlyNew || c.kind === 'new')) next.add(key(r.employee_id, c.path))
    setPicked(next)
  }

  const back = (
    <p className="pm-back">
      <Link to="/people" className="pm-back-link" data-testid="back-to-people">
        <ArrowLeft size={16} aria-hidden="true" /> Back to people
      </Link>
    </p>
  )
  const title = <PageTitle title="Import the 201 file" subtitle="Fill in people's profiles from a spreadsheet. Check it first. Nothing is saved until you accept the changes." />

  if (denied || access === 'denied') {
    return (
      <div className="page pm-page" data-testid="p201-denied">
        {back}
        <NotAvailable />
      </div>
    )
  }
  if (access === 'checking') {
    return (
      <div className="page pm-page">
        {back}
        {title}
        <LoadingCard testId="access-checking" label="Checking access" />
      </div>
    )
  }

  const withChanges = preview?.rows.filter((r) => r.status === 'changes') ?? []
  const others = preview?.rows.filter((r) => r.status !== 'changes') ?? []

  return (
    <div className="page pm-page" data-testid="p201-page" data-phase={phase}>
      {back}
      {title}

      <section className="card card-pad pm-card-section" aria-labelledby="p201-1">
        <h2 className="pm-h2" id="p201-1">
          1. Your spreadsheet
        </h2>
        <p className="pm-lead">
          One row per person, in an Excel (.xlsx) or CSV file with a heading row. Each row is matched to an existing person by work e-mail, then employee number, then an exact name. Headings such as "Date Hired", "SSS No." or "Marital Status" are recognised.
        </p>
        <ul className="pm-limits">
          <li>At most {P201_MAX_ROWS} people and 5 MB. The first sheet is read.</li>
          <li>Empty cells never clear anything. Dates: write them as 2024-02-01 or 1 Feb 2024.</li>
          <li>Government numbers (TIN, SSS, PhilHealth, Pag-IBIG) are shown masked here and are never written to the audit log.</li>
        </ul>
        <div className="pm-file-row">
          <input ref={inputRef} id="p201-file" type="file" accept=".xlsx,.csv,text/csv" className="sr-only" disabled={busy} onChange={(e) => choose(e.target.files?.[0] ?? null)} data-testid="p201-file" />
          <label htmlFor="p201-file" className="btn btn-secondary">
            <FileUp size={16} aria-hidden="true" /> {file ? 'Choose another file' : 'Choose file'}
          </label>
          <span className="pm-file-name">{file ? file.name : 'No file chosen'}</span>
          <button type="button" className="btn btn-primary" onClick={check} disabled={!file || busy || file.size > P201_MAX_BYTES} data-testid="p201-check">
            {phase === 'checking' ? 'Checking...' : 'Check file'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={template} disabled={templateBusy} data-testid="p201-template">
            <Download size={16} aria-hidden="true" /> {templateBusy ? 'Preparing...' : 'Download template'}
          </button>
        </div>
        {error ? (
          <div className="pm-account-note" role="alert" data-testid="p201-error">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
      </section>

      {preview ? (
        <section className="card card-pad pm-card-section" aria-labelledby="p201-2" data-testid="p201-preview">
          <h2 className="pm-h2" id="p201-2">
            2. What would change
          </h2>
          <p className="pm-lead" data-testid="p201-summary">
            {preview.total} rows read. {preview.people_with_changes} people have changes ({preview.new_fields} new values, {preview.changed_fields} that would replace a value).
            {preview.unmatched ? ` ${preview.unmatched} rows match nobody.` : ''}
            {preview.skipped ? ` ${preview.skipped} skipped.` : ''}
            {preview.invalid ? ` ${preview.invalid} could not be used.` : ''}
          </p>
          <p className="pm-help">
            Recognised columns: {preview.columns.map((c) => (c.heading === c.label ? c.label : `${c.heading} as ${c.label}`)).join(', ') || 'none'}.
            {preview.ignored_columns.length ? ` Ignored: ${preview.ignored_columns.join(', ')}.` : ''}
          </p>

          {withChanges.length > 0 ? (
            <>
              <div className="pm-file-row">
                <button type="button" className="btn btn-secondary" onClick={() => tickAll(true)} disabled={busy}>
                  Tick new values only
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => tickAll(false)} disabled={busy}>
                  Tick everything
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setPicked(new Set())} disabled={busy}>
                  Untick all
                </button>
              </div>
              {withChanges.map((r) => (
                <div key={r.row} className="pm-table-card" data-testid="p201-person">
                  <h3 className="pm-h3">
                    {r.name ?? 'Person'} <span className="r-sub">row {r.row}, matched by {MATCHED_BY[r.matched_by ?? ''] ?? r.matched_by}</span>
                  </h3>
                  <table className="pm-table">
                    <thead>
                      <tr>
                        <th scope="col">Accept</th>
                        <th scope="col">Field</th>
                        <th scope="col">Now</th>
                        <th scope="col">In the file</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.changes.map((c) => {
                        const k = key(r.employee_id as string, c.path)
                        return (
                          <tr key={c.path}>
                            <td>
                              <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} disabled={busy} aria-label={`Accept ${c.label} for ${r.name ?? 'this person'}`} />
                            </td>
                            <td>{c.label}</td>
                            <td>{c.old ?? '-'}</td>
                            <td>
                              <strong>{c.new ?? '-'}</strong> {c.kind === 'changed' ? <span className="r-pill r-pill-amber">replaces</span> : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {Object.keys(r.field_errors).length ? (
                    <p className="pm-help">
                      Not used: {Object.entries(r.field_errors).map(([f, m]) => `${f} ${m}`).join('; ')}.
                    </p>
                  ) : null}
                </div>
              ))}
              <div className="pm-file-row">
                <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || picked.size === 0 || phase === 'done'} data-testid="p201-apply">
                  {phase === 'applying' ? 'Saving...' : `Apply ${picked.size} change${picked.size === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          ) : (
            <p className="pm-lead">Nothing in this file would change a profile.</p>
          )}

          {others.length > 0 ? (
            <details>
              <summary>Rows that were not used ({others.length})</summary>
              <ul className="pm-limits" data-testid="p201-others">
                {others.map((r) => (
                  <li key={r.row}>
                    Row {r.row}
                    {r.name ? `, ${r.name}` : Object.values(r.given)[0] ? `, ${Object.values(r.given)[0]}` : ''}: {r.status === 'no_changes' ? 'already up to date' : r.message ?? 'not used'}
                    {Object.keys(r.field_errors).length ? ` (${Object.entries(r.field_errors).map(([f, m]) => `${f} ${m}`).join('; ')})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {result ? (
        <section className="card card-pad pm-card-section" aria-labelledby="p201-3" data-testid="p201-result">
          <h2 className="pm-h2" id="p201-3">
            3. Done
          </h2>
          <Alert tone="info">
            {result.people_updated} {result.people_updated === 1 ? 'person' : 'people'} updated, {result.fields_applied} values saved
            {result.failed ? `, ${result.failed} could not be saved` : ''}. Their My Profile pages show the new details.
          </Alert>
          {result.rows.some((r) => r.status === 'failed' || r.skipped.length) ? (
            <ul className="pm-limits">
              {result.rows
                .filter((r) => r.status === 'failed' || r.skipped.length)
                .map((r) => (
                  <li key={r.row}>
                    {r.name ?? `Row ${r.row}`}: {r.status === 'failed' ? r.message ?? 'not saved' : ''}
                    {r.skipped.length ? ` Skipped: ${r.skipped.join(', ')} (changed since the check).` : ''}
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
