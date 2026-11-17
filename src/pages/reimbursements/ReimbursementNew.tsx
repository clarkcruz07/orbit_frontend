import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { reimbursementsApi } from '@/api/reimbursements'
import { Alert } from '@/ui/Feedback'
import { PaydayNotice } from '@/ui/Payday'
import { normalisePayCalendar, type PayCalendar } from '@/lib/payday'
import { PageTitle } from '../PageTitle'
import { MAX_PURPOSE, parseServerError } from './logic'
import '../pages.css'
import './reimbursements.css'

export function ReimbursementNew() {
  const navigate = useNavigate()
  const [purpose, setPurpose] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calendar, setCalendar] = useState<PayCalendar | null>(null)
  const trimmed = purpose.trim()

  useEffect(() => {
    let live = true
    reimbursementsApi
      .config()
      .then((r) => live && setCalendar(normalisePayCalendar(r.data.pay_calendar)))
      .catch(() => undefined) // the notice is informational: without it the form works as before
    return () => {
      live = false
    }
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await reimbursementsApi.create(trimmed)
      navigate(`/reimbursements/${res.data.request_id}`, { replace: true })
    } catch (err) {
      setError(parseServerError(err, 'The request could not be created.').detail)
      setBusy(false)
    }
  }

  return (
    <div className="page r-page">
      <PageTitle title="New reimbursement" subtitle="Tell us what the expense was for. You will add the receipt next." />
      <PaydayNotice calendar={calendar} noun="request" />
      <form className="card card-pad r-new-card" onSubmit={onSubmit} noValidate data-testid="new-form">
        <label className="r-label" htmlFor="purpose">
          What is this expense for?
        </label>
        <input
          id="purpose"
          className="r-input"
          value={purpose}
          maxLength={MAX_PURPOSE}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="e.g. Client lunch, taxi to the venue, printing"
          autoFocus
          data-testid="purpose-input"
          aria-describedby="purpose-help"
        />
        <div className="r-help-row" id="purpose-help">
          <span>A short title so you and your reviewers can recognise it.</span>
          <span className="r-counter">
            {purpose.length}/{MAX_PURPOSE}
          </span>
        </div>
        {error ? (
          <div data-testid="new-error">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
        <div className="r-actions">
          <Link to="/reimbursements" className="btn btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={!trimmed || busy} data-testid="create-draft" title={!trimmed ? 'Enter a purpose first' : undefined}>
            {busy ? 'Creating...' : 'Create draft'}
          </button>
        </div>
      </form>
    </div>
  )
}
