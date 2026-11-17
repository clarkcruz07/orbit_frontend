import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const files = listSrc('modules/learning', ['.tsx', '.ts']).map(rel)
const tsx = files.filter((f) => f.endsWith('.tsx') && !f.endsWith('routes.tsx'))
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/
// The only place allowed to look at roles: it decides which tabs to OFFER (navigation), never a permission.
const ROLE_READERS = new Set(['modules/learning/LearningPage.tsx'])

test('the module is wired through routes.tsx with the deep-link paths', () => {
  const routes = readSrc('modules/learning/routes.tsx')
  for (const p of ["'learning'", "'learning/enrolments/:id'"]) assert.ok(routes.includes(p), p)
  assert.ok(/export default routes/.test(routes))
  assert.ok(/^import type \{ ModuleRoute \} from '\.\.\/registry'/m.test(routes))
})

test('no role-name literal in any component; only logic.ts learningTabs may name roles', () => {
  assert.deepEqual(tsx.filter((f) => ROLE_LITERAL.test(readSrc(f))), [])
  const logic = readSrc('modules/learning/logic.ts')
  const outside = logic.replace(/export function learningTabs[\s\S]*?\n}\n/, '')
  assert.ok(!ROLE_LITERAL.test(outside), 'role names in logic.ts are confined to learningTabs')
})

test('components never read user roles, except the one navigation-hint reader', () => {
  const offenders = tsx.filter((f) => !ROLE_READERS.has(f) && /\.roles\b|roles\s*[:=]|hasAnyRole/.test(readSrc(f)))
  assert.deepEqual(offenders, [])
  for (const f of ROLE_READERS) assert.ok(/learningTabs\(roles\)/.test(readSrc(f)), `${f} only feeds roles to learningTabs`)
})

test('every enrolment control is gated by its own server allowed_action', () => {
  const detail = readSrc('modules/learning/EnrolmentDetail.tsx')
  for (const a of ['start', 'update_progress', 'complete', 'upload_certificate', 'update_due_date', 'cancel', 'confirm', 'return']) {
    assert.ok(new RegExp(`enrolmentCan\\(e, '${a}'\\)`).test(detail + readSrc('modules/learning/lists.tsx')), `${a} is gated`)
  }
  assert.ok(/\{reviewing \? \(/.test(detail), 'the confirm card renders only when the server allows confirm/return')
  assert.ok(/\{mayUpload \? \(/.test(detail), 'the upload form renders only when upload_certificate is allowed')
  const catalog = readSrc('modules/learning/Catalog.tsx')
  assert.ok(/courseCan\(c, 'enrol'\)/.test(catalog))
  assert.ok(/courseCan\(c, 'assign'\)/.test(catalog))
  const team = readSrc('modules/learning/TeamTab.tsx')
  assert.ok(/allowed_actions\.includes\('assign'\)/.test(team), 'the course list for assigning is filtered by allowed_actions')
})

test('every button has a handler, a submit type or a disabled state; no raw anchors, empty handlers or dead links', () => {
  const bad = []
  for (const f of tsx) {
    const src = readSrc(f)
    for (const m of src.matchAll(/<button\b([\s\S]*?)>/g)) if (!/onClick\s*=|type=["']submit["']|\bdisabled\b/.test(m[1])) bad.push(`${f}: ${m[1].trim().slice(0, 60)}`)
    if (/<a\b/.test(src)) bad.push(`${f}: raw <a>`)
    if (/onClick=\{\s*\(\)\s*=>\s*(\{\s*\}|undefined|null)\s*\}/.test(src)) bad.push(`${f}: empty onClick`)
    if (/onClick=\{undefined\}|href=["']#["']|to=["']#["']/.test(src)) bad.push(`${f}: dead link`)
    if (/\bTODO\b|coming soon/i.test(src)) bad.push(`${f}: TODO / coming soon text`)
  }
  assert.deepEqual(bad, [])
})

test('every in-app Link points to a real route', () => {
  const routes = [/^\/learning$/, /^\/learning\?tab=(mine|team)$/, /^\/learning\/enrolments\/\$\{[\w.()]+\}$/]
  const bad = []
  let seen = 0
  for (const f of tsx) {
    const src = readSrc(f)
    for (const m of src.matchAll(/<(?:Link|BackLink)[^>]*\sto=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      seen += 1
      const target = m[1] ?? m[2]
      if (!routes.some((r) => r.test(target))) bad.push(`${f}: ${target}`)
    }
  }
  for (const m of readSrc('modules/learning/EnrolmentDetail.tsx').matchAll(/'(\/learning[^']*)'/g)) {
    seen += 1
    if (!routes.some((r) => r.test(m[1]))) bad.push(`EnrolmentDetail: ${m[1]}`)
  }
  assert.ok(seen >= 6, 'links were actually found')
  assert.deepEqual(bad, [])
})

test('no grades, costs or payment vocabulary in any control', () => {
  const offenders = []
  for (const f of tsx) if (/\b(grade|score|price|cost|invoice|pay now|payroll|tuition|budget)\b/i.test(readSrc(f))) offenders.push(f)
  assert.deepEqual(offenders, [])
  assert.ok(!/Placeholder - set by HR/.test(readSrc('modules/learning/Catalog.tsx')))
})

test('only GET, POST and PATCH are used; no token, storage or HTML injection in the module', () => {
  const api = readSrc('modules/learning/api.ts')
  assert.ok(!/api\.(put|delete|head|options)\(/.test(api))
  assert.ok(/api\.patch</.test(api) && /api\.post</.test(api) && /api\.get</.test(api))
  for (const f of files.filter((x) => !x.endsWith('test-entry.ts'))) {
    const src = readSrc(f)
    assert.ok(!/accessToken|access_token|refreshToken|localStorage|sessionStorage/.test(src), `${f} must not touch tokens or storage`)
    assert.ok(!/dangerouslySetInnerHTML|innerHTML\s*=/.test(src), `${f} must not inject HTML`)
    assert.ok(!/[?&]token=/.test(src), `${f} must not put a token in a URL`)
  }
})

test('the certificate file is fetched through the authorised client and saved from a blob; nothing opens a bare /api URL', () => {
  const detail = readSrc('modules/learning/EnrolmentDetail.tsx')
  assert.ok(/certificateBlob\(/.test(detail))
  assert.ok(/URL\.createObjectURL/.test(detail))
  assert.ok(/URL\.revokeObjectURL/.test(detail), 'object URLs are released')
  assert.ok(/downloadName\(/.test(detail), 'the saved name comes from the server header')
  assert.ok(!/window\.open|src=\{?["'`]\/api|href=\{?["'`]\/api/.test(detail))
})

test('uploads are not blocked client-side: the type/size hint is advisory, the server validates and its errors are shown inline', () => {
  const detail = readSrc('modules/learning/EnrolmentDetail.tsx')
  assert.ok(!/file\.size\s*>|file\.type\s*(===|!==)|files\[0\]\.(size|type)/.test(detail))
  assert.ok(/uploadErrorText\(info/.test(detail))
  assert.ok(/certHint\(/.test(detail))
})

test('My learning loads the summary (which triggers the server due-soon notifications)', () => {
  const mine = readSrc('modules/learning/MyLearning.tsx')
  assert.ok(/learningApi\.mySummary\(\)/.test(mine))
})

test('overdue and due-soon flags are rendered from server fields, never computed from the browser clock', () => {
  for (const f of tsx) {
    const src = readSrc(f)
    assert.ok(!/new Date\(\)\.getTime|Date\.now\(\)|e\.due_date\s*<|due_date\s*[<>]/.test(src.replace(/addDays\(todayIso\(new Date\(\)\), -1\)/g, '')), `${f} must not compare dates to decide overdue`)
  }
})
