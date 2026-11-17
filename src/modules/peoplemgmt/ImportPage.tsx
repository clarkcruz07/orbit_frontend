import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, FileUp } from 'lucide-react'
import { PageTitle } from '@/pages/PageTitle'
import { Alert } from '@/ui/Feedback'
import { type ImportReport, parseFailure, peopleApi } from './api'
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  IMPORT_COLUMNS_OPTIONAL,
  IMPORT_COLUMNS_PROFILE,
  IMPORT_COLUMNS_REQUIRED,
  IMPORT_FORMULA_NOTE,
  canImport,
  failureMessage,
  fileHints,
  hasBlockingHint,
  importButtonLabel,
  importFileMessage,
  peekCsv,
  peekHints,
  saveBlob,
  type FileHint,
} from './logic'
import { ImportReportView } from './ImportReportView'
import { LoadingCard, NotAvailable, Notice, Spinner, useHrAccess } from './parts'
import '@/pages/pages.css'
import './peoplemgmt.css'

type Phase = 'idle' | 'checking' | 'checked' | 'importing' | 'done'

/** HR: CSV import. Always "Check file" (a dry run that writes nothing) first; "Import N people" appears only after a dry run that would create someone. */
export function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [hints, setHints] = useState<FileHint[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const alive = useRef(true)
  const access = useHrAccess()
  useEffect(() => () => { alive.current = false }, [])

  const busy = phase === 'checking' || phase === 'importing'

  async function choose(next: File | null) {
    setFile(next)
    setReport(null)
    setError(null)
    setPhase('idle')
    if (!next) {
      setHints([])
      return
    }
    const base = fileHints(next)
    setHints(base)
    // Read only the header names and count lines (a hint). Nothing is sent anywhere and no cell is shown.
    if (next.size > 0 && next.size <= CSV_MAX_BYTES) {
      try {
        const peek = peekCsv(await next.text())
        if (alive.current) setHints([...base, ...peekHints(peek)])
      } catch {
        /* a hint only */
      }
    }
  }

  async function dryRun() {
    if (!file || busy) return
    setPhase('checking')
    setError(null)
    setReport(null)
    try {
      const r = await peopleApi.importCsv(file, true)
      setReport(r)
      setPhase('checked')
    } catch (err) {
      fail(err, 'idle')
    }
  }

  async function realRun() {
    if (!file || busy || !canImport(report)) return
    setPhase('importing')
    setError(null)
    try {
      const r = await peopleApi.importCsv(file, false)
      setReport(r)
      setPhase('done')
    } catch (err) {
      fail(err, 'checked')
    }
  }

  function fail(err: unknown, back: Phase) {
    const f = parseFailure(err)
    if (f.status === 403) setDenied(true)
    setError(importFileMessage(f) ?? failureMessage(f, 'The file could not be processed.'))
    setPhase(back)
  }

  async function template() {
    setTemplateBusy(true)
    setTemplateError(null)
    try {
      saveBlob(await peopleApi.templateBlob(), 'employee_import_template.csv')
    } catch (err) {
      setTemplateError(failureMessage(parseFailure(err), 'The template could not be downloaded.'))
    } finally {
      setTemplateBusy(false)
    }
  }

  function reset() {
    if (inputRef.current) inputRef.current.value = ''
    void choose(null)
  }

  const back = (
    <p className="pm-back">
      <Link to="/people" className="pm-back-link" data-testid="back-to-people">
        <ArrowLeft size={16} aria-hidden="true" /> Back to people
      </Link>
    </p>
  )

  if (denied || access === 'denied') {
    return (
      <div className="page pm-page" data-testid="import-denied">
        {back}
        <NotAvailable />
      </div>
    )
  }
  if (access === 'checking') {
    return (
      <div className="page pm-page">
        {back}
        <PageTitle title="Import people from a CSV file" subtitle="Check the file first. Nothing is saved until you choose to import." />
        <LoadingCard testId="access-checking" label="Checking access" />
      </div>
    )
  }

  return (
    <div className="page pm-page" data-testid="import-page" data-phase={phase}>
      {back}
      <PageTitle title="Import people from a CSV file" subtitle="Check the file first. Nothing is saved until you choose to import." />

      <section className="card card-pad pm-card-section" aria-labelledby="pm-imp-1">
        <h2 className="pm-h2" id="pm-imp-1">
          1. Get the template
        </h2>
        <p className="pm-lead">The template is the header row only. Fill in one person per row, save as CSV (UTF-8), and keep the header names.</p>
        <p className="pm-help" data-testid="import-columns">
          Required columns: {IMPORT_COLUMNS_REQUIRED.join(', ')}. Optional: {IMPORT_COLUMNS_OPTIONAL.join(', ')}. Roles are separated by ; or | (Employee is always added). Any other column is ignored.
        </p>
        <div className="pm-help" data-testid="import-profile-columns">
          <p>Optional profile columns, added after those (leave a cell empty to skip it; an old file without them still works). A row error names its column.</p>
          <ul className="pm-limits">
            {IMPORT_COLUMNS_PROFILE.map((g) => (
              <li key={g.group} data-testid={`import-profile-group-${g.group.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                <strong>{g.group}:</strong> {g.columns.join(', ')}
              </li>
            ))}
          </ul>
          <p>birth_year is a four-digit year. Dates are YYYY-MM-DD. gender is female, male, non_binary or prefer_not_to_say; civil_status is single, married, widowed, separated or other; work_arrangement is onsite, hybrid or remote.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={template} disabled={templateBusy} data-testid="download-template">
          <Download size={16} aria-hidden="true" /> {templateBusy ? 'Preparing...' : 'Download template'}
        </button>
        {templateError ? (
          <div className="pm-account-note" data-testid="template-error">
            <Alert tone="danger">{templateError}</Alert>
          </div>
        ) : null}
      </section>

      <section className="card card-pad pm-card-section" aria-labelledby="pm-imp-2">
        <h2 className="pm-h2" id="pm-imp-2">
          2. Choose your file
        </h2>
        <ul className="pm-limits" data-testid="import-limits">
          <li>CSV text file, UTF-8, comma separated, with a header row.</li>
          <li>At most {CSV_MAX_ROWS} people and 1 MB per file.</li>
          <li data-testid="formula-note">{IMPORT_FORMULA_NOTE}</li>
        </ul>
        <div className="pm-file-row">
          <input
            ref={inputRef}
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void choose(e.target.files?.[0] ?? null)}
            data-testid="import-file"
          />
          <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy} data-testid="choose-file">
            <FileUp size={16} aria-hidden="true" /> Choose CSV file
          </button>
          <span className="pm-file-name pm-wrap" data-testid="file-name">
            {file ? file.name : 'No file chosen'}
          </span>
          {file ? (
            <button type="button" className="btn btn-secondary" onClick={reset} disabled={busy} data-testid="remove-file">
              Remove file
            </button>
          ) : null}
        </div>
        {hints.map((h) => (
          <p key={h.text} className={`pm-hint pm-hint-${h.tone}`} role="status" data-testid="file-hint">
            {h.text}
          </p>
        ))}
      </section>

      <section className="card card-pad pm-card-section" aria-labelledby="pm-imp-3">
        <h2 className="pm-h2" id="pm-imp-3">
          3. Check, then import
        </h2>
        <p className="pm-lead">&quot;Check file&quot; reads every row and reports what would happen. It does not create anyone.</p>
        <div className="pm-actions pm-actions-flat">
          <button type="button" className="btn btn-primary" onClick={dryRun} disabled={!file || busy || hasBlockingHint(hints)} data-testid="check-file">
            {phase === 'checking' ? 'Checking...' : 'Check file'}
          </button>
          {canImport(report) && phase !== 'done' ? (
            <button type="button" className="btn btn-primary pm-btn-go" onClick={realRun} disabled={busy} data-testid="run-import">
              {phase === 'importing' ? 'Importing...' : importButtonLabel(report)}
            </button>
          ) : null}
        </div>
        {busy ? <Spinner label={phase === 'checking' ? 'Checking the file...' : 'Importing...'} /> : null}
        {error ? (
          <div className="pm-account-note" data-testid="import-error">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
        {report && phase === 'checked' ? (
          <Notice tone={canImport(report) ? 'info' : 'warning'} testId="check-result">
            {canImport(report)
              ? `Nothing has been saved yet. ${importButtonLabel(report)} will create the ${report.created} ${report.created === 1 ? 'person' : 'people'} marked "would be created" and leave the other rows out.`
              : 'Nothing would be created from this file. Fix the rows below and check the file again.'}
          </Notice>
        ) : null}
        {report && phase === 'done' ? (
          <div className="pm-done" data-testid="import-done">
            <Alert tone="info">
              Import finished: {report.created} {report.created === 1 ? 'person was' : 'people were'} added. New sign-in accounts have no password: those people sign in with their Microsoft work account.
            </Alert>
            <div className="pm-actions pm-actions-flat">
              <Link to="/people" className="btn btn-primary" data-testid="go-to-people">
                View people
              </Link>
              <button type="button" className="btn btn-secondary" onClick={reset} data-testid="import-another">
                Import another file
              </button>
            </div>
          </div>
        ) : null}
        {report ? <ImportReportView key={`${report.dry_run}-${report.total}-${report.created}-${report.invalid}`} report={report} /> : null}
      </section>
    </div>
  )
}
