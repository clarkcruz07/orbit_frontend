import { useId, useRef, useState, type DragEvent } from 'react'
import { FileUp } from 'lucide-react'
import { Alert } from '@/ui/Feedback'
import { assistantApi, parseFailure } from '@/api/assistant'
import { Field } from '@/modules/peoplemgmt/parts'
import { KB_ACCEPT, KB_TITLE_MAX, kbFailureText, validateUpload } from './logic'

function sizeText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Upload a file (PDF, Word .docx, .txt or .md, up to 10 MB). The type (by extension) and the size are checked here first, with a friendly
 * message and no request; the server still has the last word and its reason is shown as it is.
 */
export function KbUploadCard({ onUploaded, onCancel }: { onUploaded: (message: string) => void; onCancel: () => void }) {
  const uid = useId().replace(/:/g, '')
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  function pick(f: File | undefined | null) {
    if (!f || busy) return
    setBanner(null)
    const problem = validateUpload(f)
    if (problem) {
      setFile(null)
      setError(problem)
      if (input.current) input.current.value = ''
      return
    }
    setError(null)
    setFile(f)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files?.[0])
  }

  async function upload() {
    if (!file || busy) return
    const problem = validateUpload(file)
    if (problem) {
      setError(problem)
      return
    }
    if (title.trim().length > KB_TITLE_MAX) {
      setError(`The title can have at most ${KB_TITLE_MAX} characters.`)
      return
    }
    setBusy(true)
    setBanner(null)
    setProgress(0)
    try {
      await assistantApi.kb.upload(file, title, setProgress)
      onUploaded(`${file.name} was uploaded. Orbit is reading it now.`)
    } catch (err) {
      setBanner(kbFailureText(parseFailure(err), 'The file could not be uploaded.'))
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <section className="card card-pad or-kb-form" aria-label="Upload a file" data-testid="upload-card">
      <h2 className="or-kb-form-title">Upload a file</h2>
      {banner ? (
        <div className="pm-dialog-error" data-testid="upload-banner">
          <Alert tone="danger">{banner}</Alert>
        </div>
      ) : null}
      <div
        className={`or-drop${dragging ? ' or-drop-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="upload-drop"
      >
        <FileUp size={26} aria-hidden="true" />
        <p className="or-drop-text">Drag a file here, or</p>
        <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()} disabled={busy} data-testid="upload-choose">
          Choose a file
        </button>
        <p className="or-drop-hint">PDF, Word (.docx), .txt or .md. Up to 10 MB.</p>
        <input
          ref={input}
          id={`${uid}-file`}
          className="sr-only"
          type="file"
          accept={KB_ACCEPT}
          tabIndex={-1}
          aria-label="File to upload"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])}
          data-testid="kb-file-input"
        />
      </div>
      {error ? (
        <p className="pm-field-error" role="alert" data-testid="upload-error">
          {error}
        </p>
      ) : null}
      {file ? (
        <p className="or-upload-file" data-testid="upload-file">
          <strong className="pm-wrap">{file.name}</strong> <span className="pm-muted">({sizeText(file.size)})</span>
        </p>
      ) : null}
      <Field id={`${uid}-title`} label="Title" optional help="Leave it blank to use the file name." testId="field-upload-title">
        {(a) => <input {...a} className="pm-input" type="text" maxLength={KB_TITLE_MAX} value={title} disabled={busy} autoComplete="off" onChange={(e) => setTitle(e.target.value)} data-testid="upload-title" />}
      </Field>
      {busy ? (
        <div className="or-progress" role="status" data-testid="upload-progress">
          <progress max={100} value={progress ?? 0} aria-label="Upload progress" />
          <span>{progress !== null && progress >= 100 ? 'Reading the file...' : `Uploading ${progress ?? 0}%`}</span>
        </div>
      ) : null}
      <div className="pm-actions">
        <button type="button" className="btn btn-primary" onClick={() => void upload()} disabled={!file || busy} data-testid="upload-submit">
          {busy ? 'Uploading...' : 'Upload'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} data-testid="upload-cancel">
          Cancel
        </button>
      </div>
    </section>
  )
}
