import { Alert } from './Feedback'
import { DEFERRED_MARKER, cutoffNotice, formatPayday, landedSentence, type PayCalendar, type Payday } from '@/lib/payday'
import './ui.css'

/** Info notice shown before submitting: where the cutoff is and which payday a submission made today lands on. Informational only. */
export function PaydayNotice({ calendar, noun = 'request' }: { calendar: PayCalendar | null; noun?: 'request' | 'correction' }) {
  const n = cutoffNotice(calendar, noun)
  if (!n) return null
  return (
    <div className="payday-notice" data-testid="payday-notice" data-variant={n.variant}>
      <Alert tone={n.variant === 'deferred' ? 'warning' : 'info'}>
        <span data-testid="payday-notice-text">{n.text}</span>
        {n.countdown ? ' ' : null}
        {n.countdown ? (
          <span className="payday-countdown" data-testid="payday-countdown">
            {n.countdown}
          </span>
        ) : null}
      </Alert>
    </div>
  )
}

/** "Payday: Fri, 27 Nov", plus the word marker "Next payday (submitted after the cutoff)" when it was pushed to the next one. */
export function PaydayBadge({ payday, testId = 'payday-badge' }: { payday: Payday | null; testId?: string }) {
  if (!payday) return null
  return (
    <span className="payday-badges" data-testid={testId} data-deferred={payday.deferred ? '1' : '0'}>
      <span className="payday-pill" title={payday.cutoff ? `Cutoff: ${formatPayday(payday.cutoff)}` : undefined}>
        Payday: {formatPayday(payday.date)}
      </span>
      {payday.deferred ? (
        <span className="payday-pill payday-pill-deferred" data-testid="payday-deferred">
          {DEFERRED_MARKER}
        </span>
      ) : null}
    </span>
  )
}

/** A full sentence for detail pages and success states. */
export function PaydayLanded({ payday, noun = 'request' }: { payday: Payday | null; noun?: 'request' | 'correction' }) {
  const s = landedSentence(payday, noun)
  if (!s) return null
  return (
    <p className="payday-landed" data-testid="payday-landed" data-deferred={payday?.deferred ? '1' : '0'}>
      {s}
    </p>
  )
}
