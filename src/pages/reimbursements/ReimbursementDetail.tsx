import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileX } from 'lucide-react'
import { reimbursementsApi, type PatchBody, type Reimbursement, type ReimbursementConfig } from '@/api/reimbursements'
import { Alert, Skeleton } from '@/ui/Feedback'
import { EmptyState } from '@/ui/EmptyState'
import { PaydayBadge, PaydayNotice } from '@/ui/Payday'
import { landedSentence, normalisePayCalendar, normalisePayday } from '@/lib/payday'
import { StatusPill } from './parts'
import { ExtractionBanner, ReceiptCard, currentReceipt, type UploadState } from './ReceiptCard'
import { FieldsForm, ReadOnlyFields } from './FieldsForm'
import { ReviewerPanel } from './ReviewerPanel'
import { AuditTrail, DecisionTimeline } from './Timeline'
import {
  FIELD_DEFS,
  MAX_PURPOSE,
  buildFieldsPatch,
  fieldLabel,
  formatDateTime,
  hasAction,
  isEditorMode,
  isReviewerMode,
  parseServerError,
  textsFromFields,
  validateForm,
  type FieldKey,
  type FormTexts,
} from './logic'
import '../pages.css'
import './reimbursements.css'

type LoadState = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'ready' }

const IDLE: UploadState = { phase: 'idle', fraction: 0 }

export function ReimbursementDetail() {
  const { id = '' } = useParams()
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [req, setReq] = useState<Reimbursement | null>(null)
  const [config, setConfig] = useState<ReimbursementConfig | null>(null)

  const [texts, setTexts] = useState<FormTexts>(() => textsFromFields(emptyFields()))
  const [purpose, setPurpose] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<null | 'save' | 'submit' | 'extract'>(null)
  const [upload, setUpload] = useState<UploadState>(IDLE)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const applyServer = useCallback((r: Reimbursement) => {
    setReq(r)
    setTexts(textsFromFields(r.fields))
    setPurpose(r.purpose)
    setNotes(r.notes ?? '')
    setErrors({})
  }, [])

  const reload = useCallback(async (): Promise<Reimbursement | null> => {
    try {
      const res = await reimbursementsApi.get(id)
      applyServer(res.data)
      setLoad({ kind: 'ready' })
      return res.data
    } catch (err) {
      const info = parseServerError(err, 'The request could not be loaded.')
      setLoad(info.status === 404 || info.status === 403 ? { kind: 'missing' } : { kind: 'error', message: info.detail })
      return null
    }
  }, [id, applyServer])

  useEffect(() => {
    setLoad({ kind: 'loading' })
    setReq(null)
    setNotice(null)
    setConflict(null)
    setConfirmed(false)
    void reload()
  }, [reload])

  useEffect(() => {
    let live = true
    reimbursementsApi
      .config()
      .then((r) => live && setConfig(r.data))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const savedTexts = useMemo(() => (req ? textsFromFields(req.fields) : null), [req])
  const fieldsPatch = useMemo(() => (savedTexts ? buildFieldsPatch(texts, savedTexts) : {}), [texts, savedTexts])
  const purposeChanged = req ? purpose.trim() !== req.purpose : false
  const notesChanged = req ? notes.trim() !== (req.notes ?? '') : false
  const dirty = Object.keys(fieldsPatch).length > 0 || purposeChanged || notesChanged

  const currencies = config?.allowed_currencies ?? []

  // ------------------------------------------------------------------------------------------------ actions
  /** A 409 means someone else changed the request. Reload the latest and say so; never overwrite silently. */
  async function handleConflict(message: string) {
    await reload()
    setConfirmed(false)
    setConflict(`${message} We reloaded the latest version, so any unsaved edits on this page were discarded. Please check the values again.`)
  }

  /** Returns the saved request, or null when nothing was saved (an error is shown). */
  async function saveDraft(): Promise<Reimbursement | null> {
    if (!req) return null
    setFormError(null)
    setConflict(null)
    setNotice(null)
    const local: Partial<Record<string, string>> = { ...validateForm(texts, currencies) }
    if (!purpose.trim()) local.purpose = 'A purpose is required.'
    if (Object.keys(local).length > 0) {
      setErrors(local)
      setFormError('Some values need attention before they can be saved.')
      return null
    }
    const body: PatchBody = { version: req.version }
    if (purposeChanged) body.purpose = purpose.trim()
    if (notesChanged) body.notes = notes.trim() ? notes.trim() : null
    if (Object.keys(fieldsPatch).length > 0) body.fields = fieldsPatch
    setBusy('save')
    try {
      const res = await reimbursementsApi.patch(req.request_id, body)
      applyServer(res.data)
      return res.data
    } catch (err) {
      const info = parseServerError(err, 'The draft could not be saved.')
      if (info.status === 409) await handleConflict(info.detail)
      else {
        setErrors(info.fieldErrors)
        setFormError(Object.keys(info.fieldErrors).length ? 'Some values need attention before they can be saved.' : info.detail)
      }
      return null
    } finally {
      setBusy(null)
    }
  }

  async function onSave() {
    const saved = await saveDraft()
    if (saved) setNotice('Draft saved.')
  }

  async function onSubmit() {
    if (!req || !confirmed) return
    setFormError(null)
    setReceiptError(null)
    setConflict(null)
    setNotice(null)
    // Early, friendly feedback; the server checks the same things again.
    const missing = FIELD_DEFS.filter((d) => d.required && !texts[d.key].trim()).map((d) => d.key)
    const hasReceipt = currentReceipt(req) !== null
    if (!hasReceipt || missing.length > 0) {
      const next: Partial<Record<string, string>> = {}
      for (const k of missing) next[k] = 'Required before you can submit.'
      setErrors(next)
      if (!hasReceipt) setReceiptError('Upload a receipt before submitting.')
      setFormError('Please fill in the required values before submitting.')
      return
    }
    const saved = dirty ? await saveDraft() : req
    if (!saved) return
    setBusy('submit')
    try {
      const res = await reimbursementsApi.submit(saved.request_id, true)
      applyServer(res.data)
      setConfirmed(false)
      const landed = landedSentence(normalisePayday(res.data.payday), 'request')
      setNotice(`Submitted. Your request is now with the reviewer. You can follow its progress here.${landed ? ` ${landed}` : ''}`)
      window.scrollTo({ top: 0 })
    } catch (err) {
      const info = parseServerError(err, 'The request could not be submitted.')
      if (info.status === 409) {
        await handleConflict(info.detail)
      } else {
        const next: Partial<Record<string, string>> = { ...info.fieldErrors }
        for (const k of info.missingFields) {
          if (k === 'receipt') setReceiptError('Upload a receipt before submitting.')
          else next[k] = `${fieldLabel(k)} is missing or not valid.`
        }
        setErrors(next)
        setFormError(info.confirmRequired ? 'Please tick the confirmation before submitting.' : info.detail)
      }
    } finally {
      setBusy(null)
    }
  }

  async function onFile(file: File) {
    if (!req) return
    setUploadError(null)
    setReceiptError(null)
    setFormError(null)
    setNotice(null)
    setConflict(null)
    if (dirty) {
      const saved = await saveDraft()
      if (!saved) {
        setUploadError('Fix or save your unsaved changes first, then upload the receipt.')
        return
      }
    }
    setUpload({ phase: 'uploading', fraction: 0 })
    try {
      const res = await reimbursementsApi.uploadReceipt(req.request_id, file, (f) =>
        setUpload({ phase: f >= 1 ? 'extracting' : 'uploading', fraction: f }),
      )
      applyServer(res.data.request)
      setConfirmed(false)
    } catch (err) {
      const info = parseServerError(err, 'The receipt could not be uploaded.')
      if (info.status === 409) await handleConflict(info.detail)
      else setUploadError(`${info.detail} Nothing was stored.`)
    } finally {
      setUpload(IDLE)
    }
  }

  async function onReExtract() {
    if (!req) return
    setUploadError(null)
    setFormError(null)
    setNotice(null)
    setConflict(null)
    if (dirty) {
      const saved = await saveDraft()
      if (!saved) {
        setUploadError('Fix or save your unsaved changes first, then re-run extraction.')
        return
      }
    }
    setBusy('extract')
    setUpload({ phase: 'extracting', fraction: 1 })
    try {
      const res = await reimbursementsApi.extract(req.request_id)
      applyServer(res.data.request)
      setConfirmed(false)
    } catch (err) {
      const info = parseServerError(err, 'Extraction could not be re-run.')
      if (info.status === 409) await handleConflict(info.detail)
      else setUploadError(info.detail)
    } finally {
      setBusy(null)
      setUpload(IDLE)
    }
  }

  function onText(key: FieldKey, value: string) {
    setTexts((t) => ({ ...t, [key]: value }))
    setErrors((e) => {
      if (!e[key]) return e
      const { [key]: _drop, ...rest } = e
      return rest
    })
    setNotice(null)
  }

  // ------------------------------------------------------------------------------------------------ render
  if (load.kind === 'loading') {
    return (
      <div className="page r-page" aria-busy="true" data-testid="detail-loading">
        <div className="card card-pad">
          <Skeleton style={{ height: 22, width: '45%', marginBottom: 16 }} />
          <Skeleton style={{ height: 14, width: '85%', marginBottom: 10 }} />
          <Skeleton style={{ height: 14, width: '70%' }} />
        </div>
      </div>
    )
  }
  if (load.kind === 'missing') {
    return (
      <div className="page r-page" data-testid="detail-missing">
        <EmptyState
          icon={<FileX size={28} />}
          title="We can't find that request"
          body="It may not exist, or you may not have access to it."
          action={
            <Link to="/reimbursements" className="btn btn-primary">
              Back to reimbursements
            </Link>
          }
        />
      </div>
    )
  }
  if (load.kind === 'error' || !req) {
    return (
      <div className="page r-page" data-testid="detail-error">
        <Alert tone="danger">{load.kind === 'error' ? load.message : 'The request could not be loaded.'}</Alert>
        <button type="button" className="btn btn-secondary r-retry" onClick={() => void reload()}>
          Try again
        </button>
      </div>
    )
  }

  const editor = isEditorMode(req.allowed_actions)
  const reviewer = isReviewerMode(req.allowed_actions)
  const canEdit = hasAction(req.allowed_actions, 'edit')
  const canUpload = hasAction(req.allowed_actions, 'upload')
  const canSubmit = hasAction(req.allowed_actions, 'submit')
  const clarification = req.status === 'clarification_requested' ? [...req.decisions].reverse().find((d) => d.action === 'clarify') : undefined
  const errorCount = Object.keys(errors).length

  return (
    <div className="page r-page" data-testid="reimb-detail" data-mode={editor ? 'editor' : 'readonly'} data-status={req.status}>
      <div className="r-back">
        <Link to="/reimbursements" className="r-back-link">
          <ArrowLeft size={16} aria-hidden="true" /> Reimbursements
        </Link>
      </div>
      <div className="r-detail-head">
        <div>
          <h1 className="r-detail-title" data-testid="detail-title">
            {req.purpose}
          </h1>
          <p className="r-detail-meta">
            {req.employee.name ?? 'Unknown employee'}
            {req.employee.department ? ` - ${req.employee.department}` : ''} - created {formatDateTime(req.created_at)}
            {req.submitted_at ? ` - submitted ${formatDateTime(req.submitted_at)}` : ''}
          </p>
          <PaydayBadge payday={normalisePayday(req.payday)} testId="detail-payday" />
        </div>
        <StatusPill status={req.status} />
      </div>


      {notice ? (
        <div className="r-flash" data-testid="detail-notice">
          <Alert tone="info">{notice}</Alert>
        </div>
      ) : null}
      {conflict ? (
        <div className="r-flash" data-testid="conflict-banner">
          <Alert tone="warning">{conflict}</Alert>
        </div>
      ) : null}

      {clarification ? (
        <section className="card card-pad r-clarify" data-testid="clarification-card">
          <h2>Clarification requested</h2>
          <p className="r-sub">
            {clarification.by_name ?? clarification.by_role} ({clarification.by_role}) - {formatDateTime(clarification.at)}
          </p>
          {clarification.comment ? <blockquote className="r-comment">{clarification.comment}</blockquote> : null}
          {canEdit ? <p>Update the details, then submit again. It returns to the same review stage.</p> : null}
        </section>
      ) : null}

      <div className={`r-detail-grid${reviewer ? ' r-side-first' : ''}`}>
        <div className="r-main">
          {editor ? <ExtractionBanner req={req} /> : null}
          <ReceiptCard
            req={req}
            config={config}
            canUpload={canUpload}
            upload={upload}
            uploadError={uploadError}
            receiptError={receiptError}
            extracting={busy === 'extract'}
            onFile={(f) => void onFile(f)}
            onReExtract={() => void onReExtract()}
          />

          {editor ? (
            <>
              <FieldsForm
                req={req}
                currencies={currencies}
                texts={texts}
                purpose={purpose}
                notes={notes}
                errors={{ ...validateForm(texts, currencies), ...errors }}
                canEdit={canEdit}
                onText={onText}
                onPurpose={(v) => {
                  setPurpose(v.slice(0, MAX_PURPOSE))
                  setErrors(({ purpose: _p, ...rest }) => rest)
                }}
                onNotes={setNotes}
              />
              {canSubmit || canEdit ? (
                <section className="card card-pad r-section r-submit-card" aria-labelledby="r-submit-h" data-testid="submit-card">
                  <h2 id="r-submit-h">Save or submit</h2>
                  {formError ? (
                    <div data-testid="form-error">
                      <Alert tone="danger">
                        {formError}
                        {errorCount > 0 ? ` (${errorCount} ${errorCount === 1 ? 'value' : 'values'} highlighted above)` : ''}
                      </Alert>
                    </div>
                  ) : null}
                  {canSubmit ? <PaydayNotice calendar={normalisePayCalendar(config?.pay_calendar)} noun="request" /> : null}
                  {canSubmit ? (
                    <label className="r-confirm-check">
                      <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy !== null} data-testid="confirm-check" />
                      <span>I have checked these values against the receipt.</span>
                    </label>
                  ) : null}
                  <div className="r-actions">
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void onSave()}
                        disabled={!dirty || busy !== null}
                        title={!dirty ? 'No unsaved changes' : undefined}
                        data-testid="save-draft"
                      >
                        {busy === 'save' ? 'Saving...' : 'Save draft'}
                      </button>
                    ) : null}
                    {canSubmit ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void onSubmit()}
                        disabled={!confirmed || busy !== null || upload.phase !== 'idle'}
                        title={!confirmed ? 'Tick the confirmation first' : undefined}
                        data-testid="submit-request"
                      >
                        {busy === 'submit' ? 'Submitting...' : 'Submit for review'}
                      </button>
                    ) : null}
                  </div>
                  <p className="r-fine">Submitting sends the request to review. Approval does not pay or post anything.</p>
                </section>
              ) : null}
            </>
          ) : (
            <>
              <ReadOnlyFields req={req} />
              <AuditTrail req={req} />
            </>
          )}
        </div>

        <aside className="r-side">
          {reviewer ? (
            <ReviewerPanel
              req={req}
              onDecided={(u) => {
                applyServer(u)
                setNotice('Your decision was recorded.')
              }}
              onStale={(m) => void handleConflict(m)}
            />
          ) : null}
          <DecisionTimeline req={req} />
          {editor && req.submitted_at ? <AuditTrail req={req} /> : null}
        </aside>
      </div>
    </div>
  )
}

function emptyFields() {
  const blank = { value: null, source: 'empty' as const, extracted_value: null, confidence: null, flag: null }
  return {
    merchant: blank,
    receipt_date: blank,
    currency: blank,
    total_amount: blank,
    tax_amount: blank,
    receipt_reference: blank,
  }
}
