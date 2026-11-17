import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { directoryApi, type DirectoryEntry } from '@/api/directory'

export interface PickedEmployee {
  employee_id: string
  name: string
}

interface Props {
  id: string
  label: string
  value: PickedEmployee | null
  onChange: (next: PickedEmployee | null) => void
  error?: string
  optional?: boolean
  disabled?: boolean
}

/** Small people search over the directory API (basic fields only). Shows at most 8 matches; nothing is chosen until a person is clicked. */
export function EmployeePicker({ id, label, value, onChange, error, optional, disabled }: Props) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<DirectoryEntry[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) {
      setResults(null)
      setFailed(false)
      return
    }
    const ctl = new AbortController()
    let live = true
    const timer = window.setTimeout(() => {
      directoryApi
        .list({ q, page_size: 8 }, ctl.signal)
        .then((p) => {
          if (!live) return
          setResults(p.items)
          setFailed(false)
        })
        .catch(() => {
          if (!live || ctl.signal.aborted) return
          setResults(null)
          setFailed(true)
        })
    }, 250)
    return () => {
      live = false
      ctl.abort()
      window.clearTimeout(timer)
    }
  }, [text])

  if (value) {
    return (
      <div className={`lv-field${error ? ' has-error' : ''}`}>
        <span className="lv-label" id={`${id}-label`}>
          {label}
        </span>
        <div className="lv-picked" data-testid="picked-employee" aria-labelledby={`${id}-label`}>
          <span className="lv-wrap">
            {value.name} <span className="lv-muted">({value.employee_id})</span>
          </span>
          <button type="button" className="btn btn-secondary lv-picked-clear" onClick={() => onChange(null)} disabled={disabled} aria-label={`Clear ${value.name}`} data-testid="picked-clear">
            <X size={16} aria-hidden="true" /> Change
          </button>
        </div>
        <p className="lv-field-error" role="alert">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className={`lv-field${error ? ' has-error' : ''}`}>
      <label className="lv-label" htmlFor={id}>
        {label} {optional ? <span className="lv-opt">(optional)</span> : null}
      </label>
      <input id={id} type="search" className="lv-input" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} placeholder="Type at least 2 letters of a name" autoComplete="off" data-testid="picker-input" aria-invalid={Boolean(error)} />
      {failed ? (
        <p className="lv-field-error" role="alert">
          The people search is not available right now.
        </p>
      ) : null}
      {results !== null ? (
        results.length === 0 ? (
          <p className="lv-help" data-testid="picker-empty">
            Nobody matches "{text.trim()}".
          </p>
        ) : (
          <ul className="lv-picker-list" data-testid="picker-results">
            {results.map((r) => (
              <li key={r.employee_id}>
                <button
                  type="button"
                  className="lv-picker-option"
                  onClick={() => {
                    onChange({ employee_id: r.employee_id, name: r.name })
                    setText('')
                    setResults(null)
                  }}
                  data-testid="picker-option"
                  data-id={r.employee_id}
                >
                  <strong className="lv-wrap">{r.name}</strong>
                  <span className="lv-sub">{[r.job_title, r.department].filter(Boolean).join(' - ') || r.employee_id}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <p className="lv-field-error" role="alert">
        {error}
      </p>
    </div>
  )
}
