import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const reimbFiles = listSrc('pages/reimbursements', ['.tsx', '.ts']).map(rel)
const uiFiles = [...reimbFiles.filter((f) => f.endsWith('.tsx')), 'pages/Home.tsx']
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/

test('reimbursement screens exist and the placeholders are gone', () => {
  for (const f of ['ReimbursementsList.tsx', 'ReimbursementNew.tsx', 'ReimbursementDetail.tsx', 'ReviewerPanel.tsx', 'ReceiptCard.tsx', 'FieldsForm.tsx', 'Timeline.tsx', 'logic.ts']) {
    assert.ok(reimbFiles.includes(`pages/reimbursements/${f}`), f)
  }
  assert.ok(!reimbFiles.some((f) => /Placeholders/.test(f)))
  assert.ok(!/Placeholders/.test(readSrc('App.tsx')))
})

test('no role-name literal drives anything in the reimbursement pages (only logic.ts availableScopes may name roles, as a nav hint)', () => {
  const offenders = []
  for (const f of uiFiles) if (ROLE_LITERAL.test(readSrc(f))) offenders.push(f)
  assert.deepEqual(offenders, [])
  const logic = readSrc('pages/reimbursements/logic.ts')
  const outside = logic.replace(/export function availableScopes[\s\S]*?\n}\n/, '')
  assert.ok(!ROLE_LITERAL.test(outside), 'role names in logic.ts are confined to availableScopes')
})

test('the detail page, editor, receipt card, reviewer panel and timeline never read user roles at all', () => {
  for (const f of ['ReimbursementDetail', 'FieldsForm', 'ReceiptCard', 'ReviewerPanel', 'Timeline', 'ReimbursementNew']) {
    const src = readSrc(`pages/reimbursements/${f}.tsx`)
    assert.ok(!/\.roles\b|roles\s*[:=]|hasAnyRole|roleLabel/.test(src), `${f} must not look at roles`)
  }
})

test('modes and the reviewer panel are gated by the server allowed_actions', () => {
  const src = readSrc('pages/reimbursements/ReimbursementDetail.tsx')
  assert.ok(/isEditorMode\(req\.allowed_actions\)/.test(src))
  assert.ok(/isReviewerMode\(req\.allowed_actions\)/.test(src))
  assert.ok(/hasAction\(req\.allowed_actions, 'upload'\)/.test(src))
  assert.ok(/hasAction\(req\.allowed_actions, 'submit'\)/.test(src))
  assert.ok(/hasAction\(req\.allowed_actions, 'edit'\)/.test(src))
  assert.ok(/\{reviewer \? \(\s*<ReviewerPanel/.test(src), 'ReviewerPanel renders only inside the reviewer condition')
  const panel = readSrc('pages/reimbursements/ReviewerPanel.tsx')
  for (const a of ['approve', 'reject', 'clarify']) assert.ok(new RegExp(`can\\('${a}'\\)`).test(panel), `${a} button is gated by allowed_actions`)
  assert.ok(/Approving does not trigger any payment/.test(panel))
})

test('every button has a handler, a submit type or a disabled state; no anchors, no empty handlers, no dead links', () => {
  const bad = []
  for (const f of uiFiles) {
    const src = readSrc(f)
    let m
    const re = /<button\b([\s\S]*?)>/g
    while ((m = re.exec(src))) if (!/onClick\s*=|type=["']submit["']|\bdisabled\b/.test(m[1])) bad.push(`${f}: ${m[1].trim().slice(0, 60)}`)
    if (/<a\b/.test(src)) bad.push(`${f}: raw <a>`)
    if (/onClick=\{\s*\(\)\s*=>\s*(\{\s*\}|undefined|null)\s*\}/.test(src)) bad.push(`${f}: empty onClick`)
    if (/onClick=\{undefined\}|href=["']#["']|to=["']#["']/.test(src)) bad.push(`${f}: dead link`)
    if (/\bTODO\b|coming soon/i.test(src)) bad.push(`${f}: TODO / coming soon text`)
  }
  assert.deepEqual(bad, [])
})

test('every in-app Link in the reimbursement pages points to a real route', () => {
  const routes = [/^\/reimbursements$/, /^\/reimbursements\/new$/, /^\/reimbursements\/\$\{[\w.]+\}$/, /^\/reimbursements\?tab=review$/]
  const bad = []
  let seen = 0
  for (const f of uiFiles) {
    const src = readSrc(f)
    for (const m of src.matchAll(/<Link[^>]*\sto=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      const target = m[1] ?? m[2]
      seen += 1
      if (!routes.some((r) => r.test(target))) bad.push(`${f}: ${target}`)
    }
  }
  assert.ok(seen >= 6, 'links were actually found')
  assert.deepEqual(bad, [])
})

test('no payment/accounting vocabulary in any control: approval never pays or posts', () => {
  const offenders = []
  for (const f of uiFiles) {
    const src = readSrc(f)
    if (/\b(Pay now|Mark as paid|Send payment|Release payment|Post to (the )?(ledger|accounting)|Export (to )?bank|Payroll)\b/i.test(src)) offenders.push(f)
  }
  assert.deepEqual(offenders, [])
  assert.ok(/Approving does not trigger any payment/.test(readSrc('pages/reimbursements/ReviewerPanel.tsx')))
  assert.ok(/does not pay or post anything/.test(readSrc('pages/reimbursements/ReimbursementDetail.tsx')))
  assert.ok(!/Placeholder|PlaceholderNotice/.test(readSrc('pages/reimbursements/parts.tsx')), 'no placeholder notice')
})

test('tokens never reach a URL, storage or HTML injection from the reimbursement code', () => {
  for (const f of [...reimbFiles, 'api/reimbursements.ts', 'pages/Home.tsx']) {
    const src = readSrc(f)
    assert.ok(!/accessToken|access_token|refreshToken|localStorage|sessionStorage/.test(src), `${f} must not touch tokens or storage`)
    assert.ok(!/dangerouslySetInnerHTML|innerHTML\s*=/.test(src), `${f} must not inject HTML`)
    assert.ok(!/[?&]token=/.test(src), `${f} must not put a token in a URL`)
  }
})

test('the receipt file is fetched through the authorised client, not a plain <img src=/api/...> or window.open', () => {
  const card = readSrc('pages/reimbursements/ReceiptCard.tsx')
  assert.ok(/receiptBlob\(/.test(card))
  assert.ok(/URL\.createObjectURL/.test(card))
  assert.ok(!/src=\{?["'`]\/api/.test(card))
  assert.ok(!/window\.open/.test(card))
  assert.ok(/URL\.revokeObjectURL/.test(card), 'object URLs are released')
})

test('uploads are not blocked client-side: the file type/size hint is advisory, the server validates', () => {
  const card = readSrc('pages/reimbursements/ReceiptCard.tsx')
  const detail = readSrc('pages/reimbursements/ReimbursementDetail.tsx')
  assert.ok(/service checks the real file type and size/i.test(card))
  assert.ok(!/file\.size\s*>|file\.type\s*(===|!==)/.test(card + detail))
})

test('provenance copy is present: Not found hint, Extracted/Edited/Entered labels, original extracted value, low confidence', () => {
  const form = readSrc('pages/reimbursements/FieldsForm.tsx')
  assert.ok(/Not found on receipt - please enter/.test(form))
  assert.ok(/Extracted: /.test(form))
  assert.ok(/Low confidence/.test(form))
  assert.ok(/Extracted vs final/.test(form))
  const logic = readSrc('pages/reimbursements/logic.ts')
  for (const l of ['Extracted', 'Edited by you', 'Entered by you', 'Not found']) assert.ok(logic.includes(`'${l}'`), l)
})

test('submit requires the explicit confirmation and sends confirm_fields true', () => {
  const detail = readSrc('pages/reimbursements/ReimbursementDetail.tsx')
  assert.ok(/I have checked these values against the receipt\./.test(detail))
  assert.ok(/disabled=\{!confirmed/.test(detail))
  assert.ok(/reimbursementsApi\.submit\(saved\.request_id, true\)/.test(detail))
  assert.ok(/version: req\.version/.test(detail), 'PATCH carries the version')
})
