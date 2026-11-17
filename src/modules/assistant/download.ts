import { assistantApi, type AssistantFile } from '@/api/assistant'
import { safeFileName } from './logic'

/** Saves a blob under a safe name from a temporary object URL, released right after the browser has started the download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = safeFileName(filename)
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * Saves a file Orbit generated. The endpoint needs the bearer token, so it is fetched as a blob through the signed-in client and
 * saved from a temporary object URL (never a bare link).
 */
export async function downloadGeneratedFile(file: AssistantFile): Promise<void> {
  const res = await assistantApi.generatedFile(file.file_id)
  saveBlob(res.data, file.filename)
}

/** Saves the original of a Knowledge Base file (same rules: fetched with the signed-in client as a blob). */
export async function downloadKbFile(itemId: string, filename: string): Promise<void> {
  const res = await assistantApi.file(`/assistant/kb/items/${encodeURIComponent(itemId)}/file`)
  saveBlob(res.data, filename)
}
