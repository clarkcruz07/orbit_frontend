import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { entraSyncApi, parseFailure } from './api'
import {
  NOT_CONNECTED_ASK,
  POLL_MS,
  SYNC_ERROR_TEXT,
  SYNC_TITLE,
  canSync,
  lastAttemptText,
  lastSyncSummary,
  nextSyncText,
  shouldPoll,
  syncErrorMessage,
  syncView,
  type SyncState,
  type SyncStatus,
} from './entraSync'
import { failureMessage } from './logic'
import { ErrorBlock, Spinner } from './parts'
import './peoplemgmt.css'

type Load = { kind: 'loading' } | { kind: 'ready'; status: SyncStatus } | { kind: 'error'; message: string } | { kind: 'denied' }

/**
 * HR: the Microsoft directory sync. Shows when the people list was last brought in from Microsoft Entra, lets HR run it now, and
 * follows a running sync (every few seconds, for at most two minutes) until it is done, then asks the page to reload its list.
 * A 403 (not HR) shows nothing at all. The server decides everything: this card only reads its status and starts a run.
 */
export function EntraSyncCard({ onFinished }: { onFinished: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const [pollKey, setPollKey] = useState(0)
  const alive = useRef(true)
  const runStart = useRef<number | null>(null)
  const prevState = useRef<SyncState | null>(null)
  const finished = useRef(onFinished)
  finished.current = onFinished

  const status = load.kind === 'ready' ? load.status : null
  const running = status?.state === 'running'

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    const ctl = new AbortController()
    entraSyncApi
      .status(ctl.signal)
      .then((s) => {
        if (!ctl.signal.aborted) setLoad({ kind: 'ready', status: s })
      })
      .catch((err) => {
        if (ctl.signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return
        const f = parseFailure(err)
        if (f.status === 403) setLoad({ kind: 'denied' })
        else setLoad({ kind: 'error', message: failureMessage(f, 'The Microsoft directory status could not be loaded.') })
      })
    return () => ctl.abort()
  }, [attempt])

  // While a run is going: ask again every few seconds, stop at the limit, and clean up when the run ends or the page closes.
  useEffect(() => {
    if (!running) {
      runStart.current = null
      return
    }
    if (runStart.current === null) runStart.current = Date.now()
    setStalled(false)
    const ctl = new AbortController()
    const id = window.setInterval(() => {
      const elapsed = Date.now() - (runStart.current ?? Date.now())
      if (!shouldPoll('running', elapsed)) {
        window.clearInterval(id)
        setStalled(true)
        return
      }
      entraSyncApi
        .status(ctl.signal)
        .then((s) => {
          if (!ctl.signal.aborted) setLoad({ kind: 'ready', status: s })
        })
        .catch(() => undefined)
    }, POLL_MS)
    return () => {
      ctl.abort()
      window.clearInterval(id)
    }
  }, [running, pollKey])

  // A run that was going and is now idle: bring the people list up to date.
  useEffect(() => {
    const now = status?.state ?? null
    if (prevState.current === 'running' && now === 'idle') finished.current()
    prevState.current = now
  }, [status?.state])

  async function runNow() {
    if (busy || !status) return
    setBusy(true)
    setNotice(null)
    try {
      await entraSyncApi.run()
      if (alive.current) setLoad({ kind: 'ready', status: { ...status, state: 'running' } })
    } catch (err) {
      if (!alive.current) return
      const f = parseFailure(err)
      if (f.status === 409 && f.code === 'already_running') setLoad({ kind: 'ready', status: { ...status, state: 'running' } })
      else if (f.status === 409 && f.code === 'not_configured') setLoad({ kind: 'ready', status: { ...status, configured: false, setup_hint: f.detail ?? status.setup_hint } })
      else if (f.status === 403) setLoad({ kind: 'denied' })
      else setNotice(failureMessage(f, 'The sync could not be started.'))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (load.kind === 'denied') return null

  const shell = (children: ReactNode, view: string, testId = 'entra-sync') => (
    <section className="card card-pad pm-sync" aria-labelledby="pm-sync-h" data-testid={testId} data-view={view}>
      {children}
    </section>
  )

  if (load.kind === 'loading') {
    return shell(
      <>
        <h2 className="pm-h2" id="pm-sync-h">
          {SYNC_TITLE}
        </h2>
        <Spinner label="Checking the Microsoft directory" />
      </>,
      'loading',
      'sync-loading',
    )
  }
  if (load.kind === 'error') {
    return shell(
      <>
        <h2 className="pm-h2" id="pm-sync-h">
          {SYNC_TITLE}
        </h2>
        <ErrorBlock message={load.message} onRetry={() => setAttempt((n) => n + 1)} testId="sync-load-error" />
      </>,
      'error',
    )
  }

  const s = load.status
  const view = syncView(s)
  const now = new Date()
  const next = nextSyncText(s, now)

  return shell(
    <>
      <div className="pm-sync-head">
        <div className="pm-sync-text">
          <h2 className="pm-h2" id="pm-sync-h">
            {SYNC_TITLE}
          </h2>
          {view === 'running' ? (
            <Spinner label="Syncing with Microsoft..." />
          ) : view === 'not_configured' ? (
            <div role="status" data-testid="sync-status">
              <p className="pm-sync-line">{SYNC_ERROR_TEXT.not_configured}</p>
              {s.setup_hint ? (
                <p className="pm-sub pm-wrap" data-testid="sync-hint">
                  {s.setup_hint}
                </p>
              ) : null}
              <p className="pm-sub">{NOT_CONNECTED_ASK}</p>
            </div>
          ) : view === 'failed' ? (
            <div role="status" data-testid="sync-status">
              <Alert tone="danger">
                <span data-testid="sync-error">{syncErrorMessage(s.last?.error_code)}</span>
              </Alert>
              {lastAttemptText(s.last, now) ? <p className="pm-sub">{lastAttemptText(s.last, now)}</p> : null}
            </div>
          ) : (
            <p className="pm-sync-line" role="status" data-testid="sync-status">
              {lastSyncSummary(s.last, now)}
            </p>
          )}
          {view !== 'not_configured' && next ? (
            <p className="pm-sub" data-testid="sync-next">
              {next}
            </p>
          ) : null}
          {view !== 'not_configured' && !s.enabled ? <p className="pm-sub">Automatic sync is off. Press Sync now to bring in changes.</p> : null}
        </div>
        {view !== 'not_configured' ? (
          <button type="button" className="btn btn-secondary pm-sync-btn" onClick={() => void runNow()} disabled={!canSync(s, busy)} data-testid="sync-now">
            <RefreshCw size={16} aria-hidden="true" /> {running || busy ? 'Syncing...' : 'Sync now'}
          </button>
        ) : null}
      </div>
      {notice ? (
        <div className="pm-sync-notice" data-testid="sync-notice">
          <Alert tone="danger">{notice}</Alert>
        </div>
      ) : null}
      {stalled && running ? (
        <p className="pm-sub pm-sync-stalled" data-testid="sync-stalled">
          This is taking longer than usual.{' '}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              runStart.current = null
              setStalled(false)
              setPollKey((n) => n + 1)
              setAttempt((n) => n + 1)
            }}
            data-testid="sync-check-again"
          >
            Check again
          </button>
        </p>
      ) : null}
    </>,
    view,
  )
}
