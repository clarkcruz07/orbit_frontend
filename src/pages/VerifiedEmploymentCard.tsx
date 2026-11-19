import { useEffect, useRef, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { verifiedIdApi, type VerifiedIdIssuance, type VerifiedIdMe, type VerifiedIdState } from '@/api/verifiedId'
import { formatDate } from '@/lib/dates'
import { Alert } from '@/ui/Feedback'

const POLL_MS = 2500
const GIVE_UP_MS = 5 * 60 * 1000

/**
 * "Verified employment": add a Bluedge Employment card (Microsoft Entra Verified ID) to the Microsoft Authenticator app.
 * Shows nothing at all when the server has the feature switched off. The details on the card come from the HR record on the server.
 */
export function VerifiedEmploymentCard() {
  const [me, setMe] = useState<VerifiedIdMe | null>(null)
  const [issuance, setIssuance] = useState<VerifiedIdIssuance | null>(null)
  const [state, setState] = useState<VerifiedIdState>('created')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let live = true
    verifiedIdApi.me().then((m) => live && setMe(m))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function watch(requestId: string) {
    const startedAt = Date.now()
    const tick = async () => {
      try {
        const p = await verifiedIdApi.progress(requestId)
        setState(p.status)
        if (p.status === 'issued') {
          setMe((m) => (m ? { ...m, last_issued_at: new Date().toISOString() } : m))
          return
        }
        if (p.status === 'failed') return
      } catch {
        /* keep trying until the time is up */
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setStale(true)
        return
      }
      timer.current = window.setTimeout(tick, POLL_MS)
    }
    timer.current = window.setTimeout(tick, POLL_MS)
  }

  async function start() {
    window.clearTimeout(timer.current)
    setBusy(true)
    setError(null)
    setStale(false)
    setState('created')
    try {
      const i = await verifiedIdApi.start()
      setIssuance(i)
      watch(i.request_id)
    } catch (e) {
      const r = (e as { response?: { status?: number; data?: { detail?: string } } }).response
      setError(r?.data?.detail ?? "Can't reach the Bluedge People service.")
    } finally {
      setBusy(false)
    }
  }

  if (!me?.available) return null

  const done = state === 'issued'
  return (
    <section className="card card-pad" aria-labelledby="vid-h" data-testid="verified-employment">
      <h2 id="vid-h" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BadgeCheck size={20} aria-hidden="true" /> Verified employment
      </h2>
      <p className="r-muted">
        Add a Bluedge Employment card to the Microsoft Authenticator app on your phone. It proves you work at Bluedge, and you choose who sees it.
        It stays valid for {me.valid_days} days.
        {me.last_issued_at ? ` Last added ${formatDate(me.last_issued_at.slice(0, 10))}.` : ''}
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {issuance && !done && state !== 'failed' ? (
        <div data-testid="verified-employment-qr" style={{ display: 'grid', gap: 12, justifyItems: 'start', margin: '12px 0' }}>
          {issuance.qr_code ? <img src={issuance.qr_code} alt="QR code to add your Bluedge Employment card" width={200} height={200} style={{ background: '#fff', padding: 8, borderRadius: 8 }} /> : null}
          <ol className="r-muted" style={{ margin: 0, paddingLeft: 20 }}>
            <li>Open Microsoft Authenticator on your phone and sign in with your work account.</li>
            <li>Go to the Verified IDs tab and tap the scan button.</li>
            <li>Scan this code and accept the card.</li>
          </ol>
          <a className="r-row-link" href={issuance.url}>
            On your phone? Open Authenticator
          </a>
          <p role="status" className="r-sub">
            {stale
              ? 'Nothing yet. If you already added it, check the Verified IDs tab in Authenticator. Otherwise start again.'
              : state === 'scanned'
                ? 'Scanned. Accept the card on your phone.'
                : 'Waiting for your phone...'}
          </p>
        </div>
      ) : null}
      {done ? <Alert tone="info">Added. Open Microsoft Authenticator and look in the Verified IDs tab.</Alert> : null}
      {state === 'failed' ? <Alert tone="danger">Your phone could not add the card. Please try again.</Alert> : null}

      <button type="button" className={`btn ${issuance && !done ? 'btn-secondary' : 'btn-primary'}`} onClick={start} disabled={busy} data-testid="verified-employment-start">
        {busy ? 'Starting...' : issuance ? 'Start again' : me.last_issued_at ? 'Add it again' : 'Add to Authenticator'}
      </button>
    </section>
  )
}
