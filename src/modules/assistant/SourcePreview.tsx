import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { assistantApi, parseFailure, type AssistantFile, type ChatSource } from '@/api/assistant'
import { Modal } from '@/modules/peoplemgmt/parts'
import { NO_PREVIEW_TEXT, downloadName, fileErrorText, previewKind, safeFileName, sourceFilePath, sourceLabel, type PreviewKind } from './logic'

type Loaded = { data: Blob; headers?: Record<string, unknown> }

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: PreviewKind; url: string; text: string; name: string }
  | { kind: 'error'; message: string }

/**
 * The preview window. `load` fetches the file through the signed-in client (the server decides whether this person may open it);
 * without `load` it shows `articleText`. The temporary file address is revoked when the preview closes.
 */
function PreviewModal({
  title,
  snippet,
  load,
  articleText,
  fallbackName,
  errorText,
  onClose,
}: {
  title: string
  snippet: string
  load: (() => Promise<Loaded>) | null
  articleText?: string
  fallbackName: string
  errorText: (status: number | null) => string
  onClose: () => void
}) {
  const [view, setView] = useState<View>(() => (load ? { kind: 'loading' } : { kind: 'ready', preview: 'none', url: '', text: '', name: '' }))

  useEffect(() => {
    if (!load) return
    let live = true
    let objectUrl = ''
    load()
      .then(async (res) => {
        if (!live) return
        const blob = res.data
        const mime = blob.type || String(res.headers?.['content-type'] ?? '')
        const preview = previewKind(mime)
        const text = preview === 'text' ? (await blob.text()).slice(0, 200_000) : ''
        if (!live) return
        objectUrl = URL.createObjectURL(blob) // used for the preview and for Download; revoked on close
        setView({ kind: 'ready', preview, url: objectUrl, text, name: downloadName(String(res.headers?.['content-disposition'] ?? ''), fallbackName, mime) })
      })
      .catch((err) => {
        if (!live) return
        setView({ kind: 'error', message: errorText(parseFailure(err).status) })
      })
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // `load` is rebuilt on every render of the parent; the modal is keyed by its source, so it only needs to run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasFile = Boolean(load)
  return (
    <Modal title={title} onClose={onClose} testId="source-preview">
      <div className="or-preview" data-testid="preview-body">
        {view.kind === 'loading' ? (
          <p className="or-preview-note" role="status" data-testid="preview-loading">
            Loading the document...
          </p>
        ) : null}
        {view.kind === 'error' ? (
          <p className="or-preview-note" role="alert" data-testid="preview-error">
            {view.message}
          </p>
        ) : null}
        {view.kind === 'ready' && !hasFile ? (
          <>
            <p className="or-preview-kind">From the Knowledge Base</p>
            <p className="or-preview-text" data-testid="preview-article">
              {articleText || 'No text to show.'}
            </p>
          </>
        ) : null}
        {view.kind === 'ready' && hasFile && view.preview === 'pdf' ? <iframe className="or-preview-frame" src={view.url} title={`Preview of ${title}`} data-testid="preview-frame" /> : null}
        {view.kind === 'ready' && hasFile && view.preview === 'image' ? <img className="or-preview-image" src={view.url} alt={`Preview of ${title}`} data-testid="preview-image" /> : null}
        {view.kind === 'ready' && hasFile && view.preview === 'text' ? (
          <pre className="or-preview-pre" data-testid="preview-text">
            {view.text}
          </pre>
        ) : null}
        {view.kind === 'ready' && hasFile && view.preview === 'none' ? (
          <p className="or-preview-note" data-testid="preview-none">
            {NO_PREVIEW_TEXT}
          </p>
        ) : null}
        {view.kind === 'ready' && hasFile && snippet ? (
          <p className="or-preview-snippet" data-testid="preview-snippet">
            <strong>Relevant part:</strong> {snippet}
          </p>
        ) : null}
      </div>
      <div className="pm-dialog-actions">
        {view.kind === 'ready' && hasFile ? (
          <a className="btn btn-secondary" href={view.url} download={view.name} data-testid="preview-download">
            <Download size={16} aria-hidden="true" /> Download
          </a>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus data-testid="preview-close">
          Close
        </button>
      </div>
    </Modal>
  )
}

const sourceError = (status: number | null): string =>
  status === 403 || status === 404 ? 'You cannot open this document, or it is no longer available.' : status === null ? 'The document could not be loaded. Check your connection and try again.' : NO_PREVIEW_TEXT

/**
 * In-app preview of one source. A policy source fetches the real file; an article source shows its text.
 */
export function SourcePreview({ source, onClose }: { source: ChatSource; onClose: () => void }) {
  const path = sourceFilePath(source)
  return (
    <PreviewModal
      title={sourceLabel(source)}
      snippet={source.snippet}
      load={path ? () => assistantApi.file(path) : null}
      articleText={source.snippet}
      fallbackName={source.title}
      errorText={sourceError}
      onClose={onClose}
    />
  )
}

/** Preview of a file Orbit generated (for example the Certificate of Employment PDF). */
export function FilePreview({ file, onClose }: { file: AssistantFile; onClose: () => void }) {
  return (
    <PreviewModal
      title={safeFileName(file.filename)}
      snippet=""
      load={() => assistantApi.generatedFile(file.file_id)}
      fallbackName={safeFileName(file.filename)}
      errorText={(status) => fileErrorText({ status, code: null, detail: null, retryAfter: null })}
      onClose={onClose}
    />
  )
}
