import { useState } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { EmptyState } from '@/ui/EmptyState'
import { Alert } from '@/ui/Feedback'
import { documentsApi, type DocumentType, type EmployeeDocument, type Page } from './api'
import { DocumentRow } from './DocumentRow'
import { useLoad } from './hooks'
import { ErrorBlock, LoadingCard, Pager } from './parts'
import { UploadForm } from './UploadForm'
import { expirySummaryText, summariseExpiry } from './logic'

const PAGE_SIZE = 20

export type UploadTarget = 'self' | { employee_id: string; name: string } | null

interface Props {
  /** Restrict the listing to one employee. Omitted = everything the caller may see. */
  employeeId?: string
  showEmployee: boolean
  /** Who a new upload is for. `null` = uploading is not possible right now (explained in `uploadHelp`). */
  upload: UploadTarget
  uploadHelp?: string
  emptyTitle: string
  emptyBody: string
}

export function DocumentList({ employeeId, showEmployee, upload, uploadHelp, emptyTitle, emptyBody }: Props) {
  const [page, setPage] = useState(1)
  const [typeId, setTypeId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const types = useLoad(() => documentsApi.types().then((r) => r.data.items), [], 'The document types could not be loaded.')
  const list = useLoad<Page<EmployeeDocument>>(
    () => documentsApi.list({ employee_id: employeeId, type_id: typeId || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
    [employeeId, typeId, page],
    'The documents could not be loaded.',
  )

  const items = list.data?.items ?? []
  const summary = expirySummaryText(summariseExpiry(items))
  const typeList: DocumentType[] = types.data ?? []

  function patchRow(next: EmployeeDocument) {
    list.setData((prev) => (prev ? { ...prev, items: prev.items.map((d) => (d.doc_id === next.doc_id ? { ...d, ...next, versions: undefined } : d)) } : prev))
  }

  function created(doc: EmployeeDocument) {
    setUploading(false)
    setDone(`Uploaded "${doc.title}" (version ${doc.version}).`)
    if (page !== 1) setPage(1)
    list.reload()
  }

  return (
    <div data-testid="doc-list">
      <div className="dc-toolbar">
        <label className="dc-filter">
          <span className="dc-visually-hidden">Filter by type</span>
          <select className="dc-input" value={typeId} onChange={(e) => { setTypeId(e.target.value); setPage(1) }} aria-label="Filter by type" data-testid="type-filter">
            <option value="">All types</option>
            {typeList.map((t) => (
              <option key={t.type_id} value={t.type_id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {upload ? (
          <button type="button" className="btn btn-primary" onClick={() => { setUploading((v) => !v); setDone(null) }} aria-expanded={uploading} data-testid="upload-open">
            <Upload size={16} aria-hidden="true" /> Upload document
          </button>
        ) : null}
      </div>
      {!upload && uploadHelp ? <p className="dc-fine" data-testid="upload-help">{uploadHelp}</p> : null}

      {done ? (
        <div data-testid="upload-done">
          <Alert tone="info">{done}</Alert>
        </div>
      ) : null}

      {uploading && upload ? (
        <UploadForm types={typeList} employee={upload === 'self' ? null : upload} onCreated={created} onCancel={() => setUploading(false)} />
      ) : null}

      {summary ? (
        <div data-testid="expiry-summary">
          <Alert tone="warning">
            {summary}
            {(list.data?.total ?? 0) > PAGE_SIZE ? ' (on this page)' : ''}.
          </Alert>
        </div>
      ) : null}

      {list.error ? (
        <ErrorBlock message={list.error.status === 403 ? 'You do not have access to these documents.' : list.error.detail} onRetry={list.reload} testId="list-error" />
      ) : list.loading && !list.data ? (
        <LoadingCard testId="list-loading" />
      ) : items.length === 0 ? (
        <EmptyState icon={<FolderOpen size={28} />} title={typeId ? 'No documents of this type' : emptyTitle} body={typeId ? 'Try another type, or clear the filter.' : emptyBody} />
      ) : (
        <>
          <ul className="dc-list" data-testid="doc-rows" aria-busy={list.loading}>
            {items.map((d) => (
              <DocumentRow key={d.doc_id} doc={d} showEmployee={showEmployee} onChanged={patchRow} />
            ))}
          </ul>
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  )
}
