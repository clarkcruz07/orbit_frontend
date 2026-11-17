import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { listSrc, readSrc } from './helpers/load-ts.mjs'

const root = path.join(process.cwd(), 'src')
const rel = (f) => path.relative(root, f).replace(/\\/g, '/')
const files = listSrc('modules/performance', ['.tsx', '.ts']).map(rel)
const tsx = files.filter((f) => f.endsWith('.tsx') && !f.endsWith('routes.tsx'))
const ROLE_LITERAL = /['"`](Employee|Manager|HRAdmin|Finance)['"`]/
// The only two places allowed to look at roles: they decide which tabs/scopes to OFFER (navigation), never a permission.
const ROLE_READERS = new Set(['modules/performance/PerformancePage.tsx', 'modules/performance/TeamView.tsx'])

test('the module is wired through routes.tsx with the deep-link paths', () => {
  const routes = readSrc('modules/performance/routes.tsx')
  for (const p of ["'performance'", "'performance/goals/:id'", "'performance/checkins/:id'", "'performance/probation/:id'"]) assert.ok(routes.includes(p), p)
  assert.ok(/export default routes/.test(routes))
  assert.ok(/^import type \{ ModuleRoute \} from '\.\.\/registry'/m.test(routes))
})

test('no role-name literal in any component; only logic.ts navigation hints may name roles', () => {
  const offenders = tsx.filter((f) => ROLE_LITERAL.test(readSrc(f)))
  assert.deepEqual(offenders, [])
  const logic = readSrc('modules/performance/logic.ts')
  const outside = logic.replace(/export function performanceTabs[\s\S]*?\n}\n/, '').replace(/export function teamScopes[\s\S]*?\n}\n/, '')
  assert.ok(!ROLE_LITERAL.test(outside), 'role names in logic.ts are confined to performanceTabs and teamScopes')
})

test('components never read user roles, except the two navigation-hint readers', () => {
  const offenders = tsx.filter((f) => !ROLE_READERS.has(f) && /\.roles\b|roles\s*[:=]|hasAnyRole|useAuthStore\(\(s\) => s\.user\?\.roles/.test(readSrc(f)))
  assert.deepEqual(offenders, [])
  for (const f of ROLE_READERS) {
    const src = readSrc(f)
    assert.ok(/performanceTabs\(roles\)|teamScopes\(roles\)/.test(src), `${f} only feeds roles to the hint helpers`)
  }
})

test('controls are driven by the server allowed_actions', () => {
  const goal = readSrc('modules/performance/GoalDetail.tsx')
  assert.ok(/canEditGoal\(goal\)/.test(goal))
  assert.ok(/canCommentGoal\(goal\)/.test(goal))
  assert.ok(/\{editable \? \(\s*<GoalControls/.test(goal), 'edit controls render only inside the editable condition')
  assert.ok(/\{may \? \(\s*<form/.test(goal), 'the comment form renders only when comment is allowed')
  const checkin = readSrc('modules/performance/CheckinDetail.tsx')
  assert.ok(/canSubmitCheckin\(c\)/.test(checkin))
  assert.ok(/canAcknowledgeCheckin\(c\)/.test(checkin))
  assert.ok(/\{mayFill \? \(/.test(checkin))
  assert.ok(/\{mayAck \? \(/.test(checkin))
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

test('every in-app Link points to a real route (performance routes, back links, the existing check-in link)', () => {
  const routes = [
    /^\/performance\?tab=(goals|checkins|team|probation)(&view=goals)?$/,
    /^\/performance\/goals\/\$\{[\w.()]+\}$/,
    /^\/performance\/checkins\/\$\{[\w.()]+\}$/,
    /^\/performance\/probation\/\$\{[\w.()]+\}$/,
  ]
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
  // back links are passed as plain props
  for (const m of readSrc('modules/performance/GoalDetail.tsx').matchAll(/to="(\/[^"]+)"/g)) {
    seen += 1
    if (!routes.some((r) => r.test(m[1]))) bad.push(`GoalDetail: ${m[1]}`)
  }
  assert.ok(seen >= 6, 'links were actually found')
  assert.deepEqual(bad, [])
})

test('no ratings, scores or rankings in any control or label', () => {
  const offenders = []
  for (const f of tsx) {
    const src = readSrc(f)
    if (/\b(star rating|rate (this|your)|performance score|ranking|leaderboard|bonus|promotion decision|salary)\b/i.test(src)) offenders.push(f)
  }
  assert.deepEqual(offenders, [])
  assert.ok(!/<Notice text=/.test(readSrc('modules/performance/PerformancePage.tsx')))
})

test('only GET, POST and PATCH are used; no token, storage or HTML injection in the module', () => {
  const api = readSrc('modules/performance/api.ts')
  assert.ok(!/api\.(put|delete|head|options)\(/.test(api))
  assert.ok(/api\.patch</.test(api) && /api\.post</.test(api) && /api\.get</.test(api))
  // The probation client is the one place with a DELETE (drafts only, allowed by the server's CORS); still no PUT/HEAD/OPTIONS.
  const prob = readSrc('modules/performance/probationApi.ts')
  assert.equal((prob.match(/api\.delete\(/g) ?? []).length, 1)
  assert.ok(!/api\.(put|head|options)\(/.test(prob))
  for (const f of files.filter((x) => !x.endsWith('test-entry.ts'))) {
    const src = readSrc(f)
    assert.ok(!/accessToken|access_token|refreshToken|localStorage|sessionStorage/.test(src), `${f} must not touch tokens or storage`)
    assert.ok(!/dangerouslySetInnerHTML|innerHTML\s*=/.test(src), `${f} must not inject HTML`)
    assert.ok(!/[?&]token=/.test(src), `${f} must not put a token in a URL`)
  }
})

test('mood is only shown when the server says it is visible; nothing assumes HR can see it', () => {
  const detail = readSrc('modules/performance/CheckinDetail.tsx')
  assert.ok(/c\.mood_visible \? moodLabel\(c\.mood\) : 'Not shared with you'/.test(detail))
  const overview = readSrc('modules/performance/HrOverview.tsx')
  assert.ok(!/\bmood\b\s*[:=]\s*\w+\.mood/.test(overview))
  assert.ok(/hrCanSeeMood/.test(overview), 'the note reflects the server config, not an assumption')
})

test('user text is rendered as text (React children), never as HTML', () => {
  for (const f of ['GoalDetail', 'CheckinDetail']) {
    const src = readSrc(`modules/performance/${f}.tsx`)
    assert.ok(/className="pf-text"/.test(src))
  }
})
