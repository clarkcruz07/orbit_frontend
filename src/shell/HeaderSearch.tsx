import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Loader2, Receipt, Search, UserRound, X } from 'lucide-react'
import { searchApi, type SearchResults } from '@/api/search'
import {
  DEBOUNCE_MS,
  buildGroups,
  filterPages,
  flattenGroups,
  hintFor,
  nextActiveIndex,
  normaliseQuery,
  searchFailureMessage,
  type OptionKind,
} from '@/lib/searchLogic'

type Remote =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; results: SearchResults }
  | { state: 'error'; message: string }

const KIND_ICON: Record<OptionKind, typeof Search> = { person: UserRound, request: Receipt, page: FileText }

/**
 * Header search (WAI-ARIA combobox with a listbox popup). People and Requests come from GET /search after a 250 ms
 * debounce (the server decides what the caller may see); Pages are filtered on the client from the navigation.
 * On phones the field collapses to an icon that expands to a full-width field.
 */
export function HeaderSearch({ expanded, onExpand, onCollapse }: { expanded: boolean; onExpand: () => void; onCollapse: () => void }) {
  const navigate = useNavigate()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [remote, setRemote] = useState<Remote>({ state: 'idle' })

  const query = useMemo(() => normaliseQuery(text), [text])
  const pages = useMemo(() => (query.problem ? [] : filterPages(query.q)), [query])
  const results = remote.state === 'ready' ? remote.results : null
  const groups = useMemo(() => buildGroups(results, pages), [results, pages])
  const options = useMemo(() => flattenGroups(groups), [groups])

  // Debounced, abortable server search. Stale responses are dropped.
  useEffect(() => {
    if (query.problem) {
      setRemote({ state: 'idle' })
      return
    }
    let live = true
    setRemote({ state: 'loading' })
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      searchApi
        .search(query.q, ctrl.signal)
        .then((r) => live && setRemote({ state: 'ready', results: r }))
        .catch((e: { code?: string; response?: { status?: number } }) => {
          if (!live || e?.code === 'ERR_CANCELED') return
          setRemote({ state: 'error', message: searchFailureMessage(e?.response?.status) })
        })
    }, DEBOUNCE_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [query.q, query.problem])

  // Keep the highlighted option valid when the list changes.
  useEffect(() => {
    setActive((a) => (a >= options.length ? -1 : a))
  }, [options.length])

  // Focus the field when the phone layout expands it.
  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  const close = useCallback(() => {
    setPanelOpen(false)
    setActive(-1)
  }, [])

  // Click outside closes the popup (and folds an empty phone field back into the icon).
  useEffect(() => {
    if (!panelOpen && !expanded) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return
      close()
      if (expanded && !text.trim()) onCollapse()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [panelOpen, expanded, text, close, onCollapse])

  const go = useCallback(
    (to: string) => {
      close()
      setText('')
      if (expanded) onCollapse()
      navigate(to)
    },
    [close, expanded, navigate, onCollapse],
  )

  const showPanel = panelOpen && text.trim().length > 0
  const hint = hintFor(query.problem)
  const searching = !query.problem && remote.state === 'loading'
  const noResults = !query.problem && remote.state === 'ready' && options.length === 0
  const errorMessage = remote.state === 'error' ? remote.message : null
  const listOpen = showPanel && options.length > 0

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      if (options.length === 0) return
      if ((e.key === 'Home' || e.key === 'End') && !showPanel) return // keep caret movement in the text
      e.preventDefault()
      setPanelOpen(true)
      setActive((a) => nextActiveIndex(a, e.key, options.length))
    } else if (e.key === 'Enter') {
      const target = options[active] ?? (showPanel ? options[0] : undefined)
      if (target) {
        e.preventDefault()
        go(target.to)
      }
    } else if (e.key === 'Escape') {
      if (showPanel) {
        e.preventDefault()
        close()
      } else if (text) {
        e.preventDefault()
        setText('')
      } else if (expanded) {
        e.preventDefault()
        onCollapse()
      }
    }
  }

  return (
    <div className={`topbar-search-wrap${expanded ? ' expanded' : ''}`} ref={wrapRef}>
      <button type="button" className="topbar-search-toggle" aria-label="Open search" aria-expanded={expanded} onClick={onExpand} data-testid="search-toggle">
        <Search size={22} aria-hidden="true" />
      </button>
      <div className="topbar-search" data-testid="search-field">
        <Search size={18} aria-hidden="true" className="topbar-search-icon" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search people, requests and pages"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={listOpen && options[active] ? options[active].id : undefined}
          placeholder="Search for people, policies, requests, or more..."
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setPanelOpen(true)
            setActive(-1)
          }}
          onFocus={() => text.trim() && setPanelOpen(true)}
          onKeyDown={onKeyDown}
          data-testid="search-input"
        />
        {text ? (
          <button type="button" className="topbar-search-clear" aria-label="Clear search" onClick={() => { setText(''); inputRef.current?.focus() }}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="topbar-search-close" aria-label="Close search" onClick={() => { close(); setText(''); onCollapse() }} data-testid="search-close">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      {showPanel ? (
        <div className="search-panel" data-testid="search-panel" onMouseDown={(e) => e.preventDefault()}>
          <div id={listId} role="listbox" aria-label="Search results" hidden={!listOpen}>
            {groups.map((g) => (
              <div role="group" aria-labelledby={`${listId}-${g.id}`} key={g.id} data-testid={`search-group-${g.id}`}>
                <div className="search-group-label" id={`${listId}-${g.id}`}>
                  {g.label}
                </div>
                {g.options.map((o) => {
                  const Icon = KIND_ICON[o.kind]
                  const index = options.indexOf(o)
                  return (
                    <div
                      key={o.id}
                      id={o.id}
                      role="option"
                      aria-selected={index === active}
                      className={`search-option${index === active ? ' active' : ''}`}
                      data-testid="search-option"
                      data-kind={o.kind}
                      onClick={() => go(o.to)}
                      onMouseMove={() => index !== active && setActive(index)}
                    >
                      <span className="search-option-icon" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <span className="search-option-text">
                        <span className="search-option-label">{o.label}</span>
                        {o.sub ? <span className="search-option-sub">{o.sub}</span> : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="search-status" role="status" aria-live="polite">
            {hint ? <p data-testid="search-hint">{hint}</p> : null}
            {searching ? (
              <p data-testid="search-loading" className="search-loading">
                <Loader2 size={14} aria-hidden="true" className="search-spin" /> Searching people and requests...
              </p>
            ) : null}
            {errorMessage ? (
              <p className="search-error" data-testid="search-error">
                {errorMessage}
              </p>
            ) : null}
            {noResults ? <p data-testid="search-empty">No results for &quot;{query.q}&quot;.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
