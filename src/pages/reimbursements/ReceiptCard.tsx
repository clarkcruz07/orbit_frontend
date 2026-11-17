import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Download, FileText, RefreshCw, UploadCloud } from 'lucide-react'
import { reimbursementsApi, type ReceiptMeta, type Reimbursement, type ReimbursementConfig } from '@/api/reimbursements'
import { Alert } from '@/ui/Feedback'
import { Spinner } from './parts'
import { MANUAL_ENTRY_TEXT, extractionErrorText, formatBytes, formatDateTime, parseServerError, typeLabel, uploadHint } from './logic'

export interface UploadState {
  phase: 'idle' | 'uploading' | 'extracting'
  fraction: number
}

export function currentReceipt(req: Reimbursement): ReceiptMeta | null {
  return req.receipts.find((r) => r.is_current) ?? null
}

/** Fetches an image receipt through the authorised client (Bearer header) and exposes it as a blob URL. */
function useReceiptPreview(requestId: string, receipt: ReceiptMeta | null): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const receiptId = receipt?.receipt_id
  const isImage = Boolean(receipt && receipt.content_type.startsWith('image/'))
  useEffect(() => {
    setUrl(null)
    setFailed(false)
    if (!receiptId || !isImage) return
    let live = true
    let objectUrl: string | null = null
    reimbursementsApi
      .receiptBlob(requestId, receiptId)
      .then((r) => {
        if (!live) return
        objectUrl = URL.createObjectURL(r.data)
        setUrl(objectUrl)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [requestId, receiptId, isImage])
  return { url, failed }
}

interface Props {
  req: Reimbursement
  config: ReimbursementConfig | null
  canUpload: boolean
  upload: UploadState
  uploadError: string | null
  receiptError: string | null
  extracting: boolean
  onFile: (file: File) => void
  onReExtract: () => void
}

export function ReceiptCard({ req, config, canUpload, upload, uploadError, receiptError, extracting, onFile, onReExtract }: Props) {
  const receipt = currentReceipt(req)
  const preview = useReceiptPreview(req.request_id, receipt)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const busy = upload.phase !== 'idle'
  const hint = config ? uploadHint(config.allowed_types, config.max_receipt_mb) : 'PNG, JPEG or PDF'
  const ocrOff = config ? !config.ocr.enabled : false

  function pick(files: FileList | null) {
    const f = files?.[0]
    if (f) onFile(f)
    if (inputRef.current) inputRef.current.value = '' // allow choosing the same file again
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (!canUpload || busy) return
    pick(e.dataTransfer.files)
  }

  async function download(r: ReceiptMeta) {
    setDownloadError(null)
    try {
      const res = await reimbursementsApi.receiptBlob(req.request_id, r.receipt_id)
      const href = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = href
      a.download = r.filename || 'receipt'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 2000)
    } catch (err) {
      setDownloadError(parseServerError(err, 'The receipt could not be downloaded.').detail)
    }
  }

  return (
    <section className="card card-pad r-section" aria-labelledby="r-receipt-h" data-testid="receipt-card">
      <h2 id="r-receipt-h">Receipt</h2>

      {receipt ? (
        <div className="r-receipt-row" data-testid="receipt-current">
          <div className="r-receipt-thumb" data-testid="receipt-preview">
            {preview.url ? (
              <img src={preview.url} alt="Receipt preview" />
            ) : receipt.content_type.startsWith('image/') ? (
              <span className="r-muted">{preview.failed ? 'Preview unavailable' : 'Loading preview...'}</span>
            ) : (
              <span className="r-pdf-tile">
                <FileText size={32} aria-hidden="true" />
                <span>{typeLabel(receipt.content_type)}</span>
              </span>
            )}
          </div>
          <div className="r-receipt-meta">
            <div className="r-receipt-name" data-testid="receipt-name">
              {receipt.filename}
            </div>
            <div className="r-sub">
              {typeLabel(receipt.content_type)} - {formatBytes(receipt.size_bytes)} - uploaded {formatDateTime(receipt.uploaded_at)}
            </div>
            {req.receipts.length > 1 ? <div className="r-sub">{req.receipts.length} files uploaded; the newest is used. Earlier files are kept.</div> : null}
            <div className="r-receipt-actions">
              <button type="button" className="btn btn-secondary" onClick={() => void download(receipt)} data-testid="receipt-download">
                <Download size={16} aria-hidden="true" /> Download receipt
              </button>
            </div>
            {downloadError ? <Alert tone="danger">{downloadError}</Alert> : null}
          </div>
        </div>
      ) : (
        <p className="r-muted" data-testid="receipt-none">
          {canUpload ? 'No receipt yet. Upload one to continue.' : 'No receipt was uploaded.'}
        </p>
      )}

      {receiptError ? (
        <div data-testid="receipt-required">
          <Alert tone="danger">{receiptError}</Alert>
        </div>
      ) : null}

      {canUpload ? (
        <>
          <div
            className={`r-drop${dragging ? ' dragging' : ''}${busy ? ' busy' : ''}`}
            data-testid="receipt-dropzone"
            onDragOver={(e) => {
              e.preventDefault()
              if (!busy) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <UploadCloud size={28} aria-hidden="true" />
            <div className="r-drop-text">
              <strong>{receipt ? 'Replace the receipt' : 'Drop a receipt here'}</strong>
              <span>or choose a file. {hint}. A photo of a paper receipt, a screenshot or an e-receipt PDF all work.</span>
            </div>
            <input
              ref={inputRef}
              id="receipt-file"
              type="file"
              className="r-visually-hidden"
              accept={(config?.allowed_types ?? ['application/pdf', 'image/png', 'image/jpeg']).join(',')}
              onChange={(e) => pick(e.target.files)}
              disabled={busy}
              data-testid="receipt-input"
              aria-label="Choose a receipt file"
            />
            <button type="button" className="btn btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy} data-testid="receipt-choose">
              Choose file
            </button>
          </div>
          <p className="r-fine">Only a hint: the service checks the real file type and size when you upload. A file that fails is not stored.</p>
        </>
      ) : null}

      {busy ? (
        <div className="r-upload-status" data-testid="upload-status" data-phase={upload.phase}>
          {upload.phase === 'uploading' ? (
            <>
              <Spinner label={`Uploading receipt... ${Math.round(upload.fraction * 100)}%`} />
              <div className="r-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(upload.fraction * 100)}>
                <span style={{ width: `${Math.round(upload.fraction * 100)}%` }} />
              </div>
            </>
          ) : (
            <>
              <Spinner label="Reading the receipt to suggest values..." />
              <div className="r-progress indeterminate" aria-hidden="true">
                <span />
              </div>
            </>
          )}
        </div>
      ) : null}

      {uploadError ? (
        <div data-testid="upload-error">
          <Alert tone="danger">{uploadError}</Alert>
        </div>
      ) : null}

      {receipt && req.extraction ? (
        <div className="r-extraction" data-testid="extraction-line">
          <span className="r-sub">
            Values suggested by {req.extraction.model_label} ({req.extraction.provider}) - {req.extraction.status === 'ok' ? 'all values found' : req.extraction.status === 'partial' ? 'some values found' : 'nothing could be read'}
          </span>
        </div>
      ) : null}

      {canUpload && receipt ? (
        <div className="r-rerun">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onReExtract}
            disabled={busy || extracting || ocrOff}
            title={ocrOff ? 'Automatic reading is turned off in this environment' : 'Suggest values again from the stored receipt'}
            data-testid="rerun-extraction"
          >
            <RefreshCw size={16} aria-hidden="true" /> {extracting ? 'Re-running...' : 'Re-run extraction'}
          </button>
          <span className="r-fine">Only suggests values. Anything you typed or edited is kept, and nothing is submitted.</span>
        </div>
      ) : null}
    </section>
  )
}

export function ExtractionBanner({ req }: { req: Reimbursement }) {
  const ex = req.extraction
  if (!ex) return null
  if (ex.status === 'failed') {
    return (
      <div data-testid="extraction-banner" data-kind="failed">
        <Alert tone="warning">
          <strong>We couldn&apos;t read this receipt.</strong> {extractionErrorText(ex.error_code)} {MANUAL_ENTRY_TEXT}
        </Alert>
      </div>
    )
  }
  if (ex.status === 'partial') {
    return (
      <div data-testid="extraction-banner" data-kind="partial">
        <Alert tone="info">
          <strong>Some values were not found.</strong> They are left empty rather than guessed. Please check every value and fill in the empty ones from the receipt.
        </Alert>
      </div>
    )
  }
  return (
    <div data-testid="extraction-banner" data-kind="ok">
      <Alert tone="info">
        <strong>Values were suggested from the receipt.</strong> They are suggestions only: check each one against the receipt before you submit.
      </Alert>
    </div>
  )
}
