// Responsive sweep for the Performance and Learning routes at 1440, 1024, 768, 390 and 320 px (mock APIs, fictional data).
// Per route (with its forms and panels opened) and width it asserts:
//   * no horizontal page overflow and no element wider than the viewport (very long unbroken titles included),
//   * the sticky header never covers content,
//   * no text smaller than 11px and no text spilling out of buttons and pills,
//   * at <= 768px every primary control (buttons, inputs, selects, tabs, steps, chips, checkboxes) is visible, inside the
//     viewport and at least 44px tall.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANNA, BEN, CARLA, enabled, launchBrowser, opts, signIn, withLearnMock, withPerfMock } from './performance-learning-helpers.mjs'
import { PROBATION_KEYS, completeRatings, makeCheckin, makeEvaluation, makeGoal } from './performance-mock.mjs'
import { makeEnrolment } from './learning-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const WIDTHS = [1440, 1024, 768, 390, 320]
const HEIGHT = (w) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800)
const LONG = 'Supercalifragilisticexpialidocious-Title-Without-Any-Spaces-To-Wrap-0123456789-0123456789'

/** Runs inside the page: returns a list of problems for the current route at the current width. */
const AUDIT = ({ narrow }) => {
  const problems = []
  const vw = document.documentElement.clientWidth
  const note = (kind, el, extra = '') => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    problems.push(`${kind}: <${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${el.dataset?.testid ? ` data-testid=${el.dataset.testid}` : ''}> ${extra}`.trim())
  }
  const hiddenByAncestor = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.display === 'none' || cs.visibility === 'hidden') return true
    }
    return false
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && !hiddenByAncestor(el)
  }

  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`)

  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, .pf-visually-hidden, .ln-visually-hidden, svg *')) continue
    if (hiddenByAncestor(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right <= vw + 1 && r.left >= -1) continue
    let clipped = false
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible') {
        const ar = a.getBoundingClientRect()
        if (ar.right <= vw + 1 && ar.left >= -1) clipped = true
        break
      }
    }
    if (!clipped) note('wider than viewport', el, `left=${Math.round(r.left)} right=${Math.round(r.right)} vw=${vw}`)
  }

  const header = document.querySelector('.topbar')
  if (header) {
    const hb = header.getBoundingClientRect()
    const main = document.querySelector('.app-content')
    if (main && main.getBoundingClientRect().top < hb.bottom - 1) note('content under header', main)
    const h1 = document.querySelector('.app-content h1')
    if (h1 && h1.getBoundingClientRect().top < hb.bottom - 1) note('title under header', h1)
  }

  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.sr-only, .pf-visually-hidden, .ln-visually-hidden, svg')) continue
    if (hiddenByAncestor(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (own && parseFloat(getComputedStyle(el).fontSize) < 11) note('text smaller than 11px', el, getComputedStyle(el).fontSize)
  }
  for (const el of document.querySelectorAll('button, .btn, .pf-pill, .ln-pill, .ln-tag')) {
    if (hiddenByAncestor(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 1) note('text spills out', el, `${el.scrollWidth} > ${el.clientWidth}`)
  }

  if (narrow) {
    const sel = [
      '.app-content .btn',
      '.app-content button.pf-tab',
      '.app-content button.ln-tab',
      '.app-content .pf-step',
      '.app-content .ln-chip',
      '.app-content .ln-result',
      '.app-content .pf-back-link',
      '.app-content .ln-back-link',
      '.app-content .ln-iconbtn',
      '.app-content .pf-mood-option',
      '.app-content .pb-chip',
      '.app-content .pb-rate',
      '.app-content .pb-reco-option',
      '.app-content .pb-guide-toggle',
      '.app-content .ln-check',
      '.app-content input[type=range]',
      '.app-content input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range])',
      '.app-content select',
      '.app-content textarea',
    ].join(', ')
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height < 43.5) note('target shorter than 44px', el, `${Math.round(r.height * 10) / 10}px`)
      if (r.right > vw + 1 || r.left < -1) note('control outside viewport', el)
    }
  }
  return problems
}

async function audit(page, width, label, problems) {
  await page.evaluate(() => window.scrollTo(0, 0)) // an action may have scrolled; the header check needs the top of the page
  await page.waitForTimeout(250)
  const found = await page.evaluate(AUDIT, { narrow: width <= 768 })
  for (const p of found) problems.push(`${label}: ${p}`)
}

async function visit(page, mock, r, width, problems) {
  await page.goto(`${mock.origin}${r.path}`)
  try {
    await page.waitForSelector(r.ready, { timeout: 15000, state: 'attached' })
  } catch {
    problems.push(`${r.name} (${r.path}): never became ready (${r.ready})`)
    return
  }
  if (r.act) {
    try {
      await r.act(page)
    } catch (e) {
      problems.push(`${r.name}: action failed: ${String(e).split('\n')[0]}`)
      return
    }
  }
  await audit(page, width, `${r.name} (${r.path})`, problems)
}

function seedProbation(state) {
  // [0] draft (editable, long text, an extension, development rows), [1] submitted (read-only), [2] another draft for the list
  const long = LONG.repeat(3)
  state.probation.push(
    makeEvaluation({
      ratings: { ...completeRatings(4), quality: { rating: 2, comments: long }, role: { rating: 5, comments: 'Solid.' } },
      strengths: long,
      development_comments: long,
      development_rows: [
        { area: LONG, actions: long, target_completion: LONG },
        { area: 'Reports', actions: 'Course', target_completion: '2027-01-31' },
      ],
      summary: long,
      recommendation: 'extend',
      extension: { reasons: long, objectives: long, review_date: '2027-02-01' },
    }),
    makeEvaluation({ employee_id: 'EMP-0004', status: 'submitted', ratings: completeRatings(5), summary: 'Ready.', recommendation: 'confirm', submitted_at: '2026-11-15T09:00:00.000Z', submitted_by_name: 'Ben Cruz' }),
  )
  void PROBATION_KEYS
}

function seedPerf(state) {
  seedProbation(state)
  state.goals.push(makeGoal({ title: LONG, description: LONG.repeat(4), status: 'in_progress', progress: 45, due_date: '2026-10-01' }))
  state.goals.push(makeGoal({ title: 'Complete the compliance refresher' }))
  state.goals[0].comments.push({ comment_id: 'c1', by: { employee_id: 'EMP-0002', name: 'Ben Cruz' }, text: LONG.repeat(3), at: '2026-11-10T10:00:00.000Z' })
  state.checkins.push(makeCheckin({ period_label: LONG.slice(0, 60), accomplishments: LONG.repeat(4), blockers: LONG, next_steps: LONG }))
  state.checkins.push(makeCheckin({ period_label: '2027-Q2', status: 'requested', origin: 'manager', requested_by: { employee_id: 'EMP-0002', name: 'Ben Cruz' }, requested_at: '2026-11-12T10:00:00.000Z', accomplishments: '', blockers: '', next_steps: '', mood: null, submitted_at: null }))
  state.checkins.push(makeCheckin({ employee_id: 'EMP-0004', period_label: '2027-Q1', status: 'acknowledged', acknowledged_at: '2026-11-11T09:00:00.000Z', acknowledged_by: { employee_id: 'EMP-0002', name: 'Ben Cruz', kind: 'manager' }, feedback: LONG }))
}

for (const width of WIDTHS) {
  test(`responsive @${width}px: Performance routes fit, forms stack, controls are tappable`, opts, async () => {
    const problems = []
    await withPerfMock(
      browser,
      async ({ mock, state }) => {
        const goalId = state.goals[0].goal_id
        const requestedId = state.checkins[1].checkin_id
        const submittedId = state.checkins[0].checkin_id
        const draftEvalId = state.probation[0].evaluation_id
        const doneEvalId = state.probation[1].evaluation_id
        const open = async (email) => {
          const c = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
          const p = await c.newPage()
          p.on('pageerror', (e) => problems.push(`[${email}] page error: ${e}`))
          await signIn(p, mock.origin, email)
          await p.waitForSelector('.app-content')
          return { c, p }
        }
        const carla = await open(CARLA)
        const ben = await open(BEN)
        const anna = await open(ANNA)
        try {
          const routes = [
            { who: carla, name: 'goals list', path: '/performance', ready: '[data-testid=goal-row]' },
            { who: carla, name: 'goals list + new goal form', path: '/performance', ready: '[data-testid=goal-row]', act: async (p) => { await p.click('[data-testid=new-goal]'); await p.fill('[data-testid=goal-title]', LONG + LONG); await p.click('[data-testid=goal-save]'); await p.waitForSelector('#goal-title-error') } },
            { who: carla, name: 'check-ins + new form with errors', path: '/performance?tab=checkins', ready: '[data-testid=checkin-row]', act: async (p) => { await p.click('[data-testid=new-checkin]'); await p.click('[data-testid=checkin-submit]'); await p.waitForSelector('[data-testid=checkin-form] .pf-field-error') } },
            { who: carla, name: 'goal detail (owner)', path: `/performance/goals/${goalId}`, ready: '[data-testid=goal-detail]', act: async (p) => { await p.click('[data-testid=goal-edit]'); await p.waitForSelector('[data-testid=goal-edit-form]') } },
            { who: carla, name: 'requested check-in (fill form)', path: `/performance/checkins/${requestedId}`, ready: '[data-testid=checkin-fill-form]' },
            { who: carla, name: 'submitted check-in (read)', path: `/performance/checkins/${submittedId}`, ready: '[data-testid=checkin-detail]' },
            { who: ben, name: 'team: to acknowledge', path: '/performance?tab=team', ready: '[data-testid=checkin-row]' },
            { who: ben, name: 'team: request form', path: '/performance?tab=team&view=checkins', ready: '[data-testid=team-filters]', act: async (p) => { await p.click('[data-testid=request-checkin]'); await p.waitForSelector('[data-testid=request-card] form') } },
            { who: ben, name: 'team: goals', path: '/performance?tab=team&view=goals', ready: '[data-testid=goal-row]' },
            { who: ben, name: 'goal detail (manager comment form)', path: `/performance/goals/${goalId}`, ready: '[data-testid=comment-form]' },
            { who: ben, name: 'check-in detail (acknowledge)', path: `/performance/checkins/${submittedId}`, ready: '[data-testid=ack-panel]' },
            { who: anna, name: 'HR overview', path: '/performance?tab=overview', ready: '[data-testid=overview-period-card]' },
            { who: ben, name: 'probation: list', path: '/performance?tab=probation', ready: '[data-testid=probation-row]' },
            { who: ben, name: 'probation: new evaluation picker', path: '/performance?tab=probation', ready: '[data-testid=new-evaluation]', act: async (p) => { await p.click('[data-testid=new-evaluation]'); await p.waitForSelector('[data-testid=eligible-list]') } },
            { who: ben, name: 'probation: draft form (long text, extension, development rows)', path: `/performance/probation/${draftEvalId}`, ready: '[data-testid=eval-form]', act: async (p) => { await p.click('[data-testid=rating-guide-toggle]') } },
            { who: ben, name: 'probation: missing checklist', path: `/performance/probation/${draftEvalId}`, ready: '[data-testid=eval-form]', act: async (p) => { await p.click('[data-testid=rating-quality-4]'); await p.fill('[data-testid=summary]', ''); await p.click('[data-testid=submit-evaluation]'); await p.waitForSelector('[data-testid=missing-list]') } },
            { who: ben, name: 'probation: submit confirm', path: `/performance/probation/${draftEvalId}`, ready: '[data-testid=eval-form]', act: async (p) => { await p.click('[data-testid=submit-evaluation]'); await p.waitForSelector('[data-testid=submit-dialog]') } },
            { who: ben, name: 'probation: submitted (read-only)', path: `/performance/probation/${doneEvalId}`, ready: '[data-testid=probation-detail][data-mode=read]' },
            { who: anna, name: 'probation: HR list', path: '/performance?tab=probation', ready: '[data-testid=probation-row]' },
            { who: anna, name: 'probation: HR reopen dialog', path: `/performance/probation/${doneEvalId}`, ready: '[data-testid=reopen]', act: async (p) => { await p.click('[data-testid=reopen]'); await p.waitForSelector('[data-testid=reopen-dialog]') } },
          ]
          for (const r of routes) {
            const page = r.who.p
            await visit(page, mock, r, width, problems)
          }
        } finally {
          await carla.c.close()
          await ben.c.close()
          await anna.c.close()
        }
      },
      { seed: seedPerf, viewport: { width, height: HEIGHT(width) } },
    )
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
  })

  test(`responsive @${width}px: Learning routes fit, forms stack, controls are tappable`, opts, async () => {
    const problems = []
    await withLearnMock(
      browser,
      async ({ mock, state }) => {
        const enrolmentId = state.enrolments[0].enrolment_id
        const pendingId = state.enrolments[1].enrolment_id
        const open = async (email) => {
          const c = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
          const p = await c.newPage()
          p.on('pageerror', (e) => problems.push(`[${email}] page error: ${e}`))
          await signIn(p, mock.origin, email)
          await p.waitForSelector('.app-content')
          return { c, p }
        }
        const carla = await open(CARLA)
        const ben = await open(BEN)
        const anna = await open(ANNA)
        try {
          const routes = [
            { who: carla, name: 'catalog', path: '/learning', ready: '[data-testid=course-card]' },
            { who: carla, name: 'my learning', path: '/learning?tab=mine', ready: '[data-testid=enrolment-row]' },
            { who: carla, name: 'enrolment (owner, certificate form)', path: `/learning/enrolments/${enrolmentId}`, ready: '[data-testid=certificate-upload]', act: async (p) => { await p.setInputFiles('[data-testid=certificate-input]', { name: `${LONG}.png`, mimeType: 'image/png', buffer: Buffer.from('89504e47', 'hex') }); await p.waitForSelector('[data-testid=certificate-chosen]') } },
            { who: ben, name: 'catalog with assign panel', path: '/learning', ready: '[data-testid=course-assign]', act: async (p) => { await p.locator('[data-testid=course-assign]').first().click(); await p.waitForSelector('[data-testid=assign-panel]'); await p.click('[data-testid=assign-submit]'); await p.waitForSelector('#assign-person-error, [data-testid=assign-panel] .ln-field-error') } },
            { who: ben, name: 'team', path: '/learning?tab=team', ready: '[data-testid=team-row]' },
            { who: ben, name: 'team: assign panel', path: '/learning?tab=team', ready: '[data-testid=team-assign]', act: async (p) => { await p.click('[data-testid=team-assign]'); await p.waitForSelector('[data-testid=assign-panel]') } },
            { who: ben, name: 'enrolment (confirm card, manage)', path: `/learning/enrolments/${pendingId}`, ready: '[data-testid=confirm-card]' },
            { who: anna, name: 'HR compliance', path: '/learning?tab=hr', ready: '[data-testid=overdue-row]' },
            { who: anna, name: 'HR courses + form', path: '/learning?tab=hr&section=courses', ready: '[data-testid=admin-course-row]', act: async (p) => { await p.click('[data-testid=admin-new-course]'); await p.click('[data-testid=course-save]'); await p.waitForSelector('[data-testid=course-form-card] .ln-field-error') } },
            { who: anna, name: 'HR all enrolments', path: '/learning?tab=hr&section=enrolments', ready: '[data-testid=enrolment-row]' },
          ]
          for (const r of routes) await visit(r.who.p, mock, r, width, problems)
        } finally {
          await carla.c.close()
          await ben.c.close()
          await anna.c.close()
        }
      },
      {
        viewport: { width, height: HEIGHT(width) },
        seed: (state) => {
          const c = (t) => state.courses.find((x) => x.title === t).course_id
          state.enrolments.push(
            makeEnrolment({ course_id: c('Workplace Health and Safety Basics'), due_date: '2026-11-10', status: 'in_progress', progress: 30 }),
            makeEnrolment({ course_id: c('Data Privacy Essentials'), status: 'completed', progress: 100, confirmation_status: 'pending', completed_at: '2026-11-15T00:00:00.000Z', completion_note: LONG.repeat(2), certificates: [{ certificate_id: 'cert-1', filename: `${LONG}.png`, content_type: 'image/png', size_bytes: 70, uploaded_at: '2026-11-15T00:00:00.000Z', is_current: true }] }),
            makeEnrolment({ course_id: c('Introduction to Project Planning'), due_date: '2026-11-19', status: 'assigned', mandatory: false }),
          )
          state.courses[0].title = LONG
          state.courses[1].category = LONG.slice(0, 55)
          state.courses[2].description = LONG.repeat(3)
        },
      },
    )
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
  })
}

// The sweep is only worth something if it can fail: inject known defects and check each is reported.
test('responsive audit self-check: it reports sideways overflow and a short tap target on a Performance page', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock }) => {
      await page.goto(`${mock.origin}/performance`)
      await page.waitForSelector('[data-testid=goal-row]')
      const clean = await page.evaluate(AUDIT, { narrow: true })
      assert.deepEqual(clean, [])
      await page.evaluate(() => {
        const wide = document.createElement('div')
        wide.style.cssText = 'width:900px;height:10px;background:red'
        wide.dataset.testid = 'injected-wide'
        document.querySelector('.app-content').appendChild(wide)
        const b = document.createElement('button')
        b.className = 'btn'
        b.style.minHeight = '0'
        b.style.height = '28px'
        b.textContent = 'tiny'
        document.querySelector('.app-content').appendChild(b)
      })
      const found = (await page.evaluate(AUDIT, { narrow: true })).join('\n')
      assert.match(found, /page scrolls sideways/)
      assert.match(found, /wider than viewport: <div data-testid=injected-wide>/)
      assert.match(found, /target shorter than 44px: <button\.btn>/)
    },
    { signInAs: CARLA, seed: seedPerf, viewport: { width: 390, height: 800 } },
  )
})
