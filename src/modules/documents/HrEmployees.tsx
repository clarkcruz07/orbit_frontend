import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { directoryApi, type DirectoryEntry } from '@/api/directory'
import { DocumentList } from './DocumentList'

/** HR: documents of everyone, or of one person chosen through the directory lookup; upload on their behalf. */
export function HrEmployees() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<DirectoryEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DirectoryEntry | null>(null)

  useEffect(() => {
    const text = q.trim()
    setSearchError(null)
    if (text.length < 2 || selected) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const ctl = new AbortController()
    const t = setTimeout(() => {
      directoryApi
        .list({ q: text, page_size: 8 }, ctl.signal)
        .then((p) => {
          setResults(p.items)
          setSearching(false)
        })
        .catch((e) => {
          if (ctl.signal.aborted || (e as { code?: string })?.code === 'ERR_CANCELED') return
          setSearchError('The directory could not be searched.')
          setSearching(false)
        })
    }, 300)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [q, selected])

  return (
    <div data-testid="hr-employees">
      <section className="card card-pad dc-picker" aria-labelledby="dc-pick-h">
        <h2 id="dc-pick-h">Find an employee</h2>
        <p className="dc-fine">Leave this empty to see everyone&apos;s documents, or pick a person to see only theirs and to upload on their behalf.</p>
        {selected ? (
          <div className="dc-chip-row" data-testid="employee-chip">
            <span className="dc-chip">
              <strong>{selected.name}</strong>
              <span className="dc-sub">
                {selected.department ?? ''}
                {selected.job_title ? ` - ${selected.job_title}` : ''}
              </span>
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => { setSelected(null); setQ('') }} data-testid="employee-clear">
              <X size={16} aria-hidden="true" /> Show everyone
            </button>
          </div>
        ) : (
          <>
            <div className="dc-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                className="dc-search-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, job title or department"
                aria-label="Search employees"
                maxLength={64}
                autoComplete="off"
                data-testid="employee-search"
              />
            </div>
            {searching ? <p className="dc-fine">Searching...</p> : null}
            {searchError ? (
              <p className="dc-field-error" role="alert">
                {searchError}
              </p>
            ) : null}
            {!searching && !searchError && q.trim().length >= 2 && results.length === 0 ? <p className="dc-fine">No employee matches.</p> : null}
            {results.length > 0 ? (
              <ul className="dc-results" data-testid="employee-results">
                {results.map((r) => (
                  <li key={r.employee_id}>
                    <button type="button" className="dc-result" onClick={() => setSelected(r)} data-testid="employee-result">
                      <strong>{r.name}</strong>
                      <span className="dc-sub">
                        {r.department ?? ''}
                        {r.job_title ? ` - ${r.job_title}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <DocumentList
        key={selected?.employee_id ?? 'all'}
        employeeId={selected?.employee_id}
        showEmployee={!selected}
        upload={selected ? { employee_id: selected.employee_id, name: selected.name } : null}
        uploadHelp="Pick an employee above to upload a document on their behalf."
        emptyTitle={selected ? `No documents for ${selected.name}` : 'No employee documents yet'}
        emptyBody={selected ? 'Documents uploaded for this person will appear here.' : 'Documents that employees or HR upload will appear here.'}
      />
    </div>
  )
}
