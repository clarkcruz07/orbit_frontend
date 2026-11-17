// API helpers for the Documents and HR Requests real-backend specs (multipart through the proxy, like the browser).
// Fictional data only. A "file" field value is `{name, mimeType, buffer}` (see documents-fixtures.mjs `upload`).
import fs from 'node:fs'

export async function multipart(origin, token, method, path, fields) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'object' && v.buffer) form.append(k, new Blob([v.buffer], { type: v.mimeType }), v.name)
    else form.append(k, String(v))
  }
  const r = await fetch(`${origin}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body: form })
  let json = null
  try {
    json = await r.json()
  } catch {
    /* no body */
  }
  return { status: r.status, json }
}

export async function rawGet(origin, token, path) {
  const r = await fetch(`${origin}/api${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), headers: r.headers }
}

export async function jsonCall(origin, token, method, path, body) {
  const r = await fetch(`${origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await r.json()
  } catch {
    /* no body */
  }
  return { status: r.status, json }
}

/** Looks a document type up by name (HR sees all, others the visible ones). */
export async function typeId(origin, token, name) {
  const { json } = await jsonCall(origin, token, 'GET', '/documents/types')
  const t = json.items.find((x) => x.name === name)
  if (!t) throw new Error(`no document type named ${name}`)
  return t.type_id
}

export async function apiUploadDocument(origin, token, { type, title, file, expires, employeeId }) {
  const type_id = await typeId(origin, token, type)
  const res = await multipart(origin, token, 'POST', '/documents/employee', { type_id, title, file, expires_on: expires, employee_id: employeeId })
  if (res.status !== 201) throw new Error(`document upload failed: ${res.status} ${JSON.stringify(res.json)}`)
  return res.json
}

export async function apiPublishPolicy(origin, token, { title, summary, effective, file }) {
  const res = await multipart(origin, token, 'POST', '/documents/policies', { title, summary, effective_date: effective, file })
  if (res.status !== 201) throw new Error(`policy publish failed: ${res.status} ${JSON.stringify(res.json)}`)
  return res.json
}

export async function employeeIdOf(origin, token) {
  const { json } = await jsonCall(origin, token, 'GET', '/auth/me')
  return json.employee_id
}

export function readDownload(download) {
  return download.path().then((p) => fs.readFileSync(p))
}
