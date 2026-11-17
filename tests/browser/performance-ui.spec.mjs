// Performance & Check-ins UI states against a self-contained MOCK of /performance (performance-mock.mjs): loading,
// error + retry, empty, pagination, server-driven allowed_actions, conflicts, validation, overdue flag, mood visibility,
// no-manager wording, the HR overview. The real-backend flows live in e2e-performance.spec.mjs.
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). Fictional mock data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANNA, BEN, CARLA, DAN, enabled, launchBrowser, noOverflow, opts, signIn, text, until, visit, withPerfMock } from './performance-learning-helpers.mjs'
import { makeCheckin, makeGoal } from './performance-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const PERF = '[data-testid=performance-page]'
const seedGoals = (state) => {
  state.goals.push(makeGoal({ title: 'Complete the compliance refresher', status: 'in_progress', progress: 40 }))
  state.goals.push(makeGoal({ title: 'Overdue fictional task', due_date: '2026-10-01', status: 'not_started' }))
}

test('goals list: loading skeleton first, rows with status, progress, due date and the overdue pill (computed by the server)', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state, errors }) => {
      state.delayMs = 400
      await page.goto(`${mock.origin}/performance`)
      await page.waitForSelector('[data-testid=loading]')
      await page.waitForSelector('[data-testid=goal-row]')
      assert.equal(await page.locator('[data-testid=goal-row]').count(), 2)
      const rows = await page.$$eval('[data-testid=goal-row]', (els) => els.map((e) => e.innerText))
      const refresher = rows.find((r) => r.includes('compliance refresher'))
      assert.match(refresher, /In progress/)
      assert.match(refresher, /40%/)
      assert.match(refresher, /Due 31 Mar 2027/)
      const overdue = rows.find((r) => r.includes('Overdue fictional task'))
      assert.match(overdue, /Overdue/)
      assert.equal(await page.locator('[data-testid=goal-overdue]').count(), 1, 'only the late goal is flagged')
      assert.equal(await page.locator('[data-testid=placeholder-notice]').count(), 0)
      assert.deepEqual(errors, [])
    },
    { signInAs: CARLA, seed: seedGoals },
  )
})

test('goals list: a failed load shows the error with Try again, which recovers', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      state.failures.set('/performance/goals', { status: 500, times: 1 })
      await page.goto(`${mock.origin}/performance`)
      await page.waitForSelector('[data-testid=load-error]')
      assert.match(await text(page, '[data-testid=load-error]'), /Server error|could not be loaded/)
      await page.click('[data-testid=load-error] button')
      await page.waitForSelector('[data-testid=goal-row]')
      assert.equal(await page.locator('[data-testid=load-error]').count(), 0)
    },
    { signInAs: CARLA, seed: seedGoals },
  )
})

test('empty states: no goals, no check-ins, and a filter with no match each say what to do', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock }) => {
      await visit(page, mock, '/performance', '[data-testid=my-goals] [data-testid=empty-state]')
      assert.match(await text(page, '[data-testid=empty-state]'), /You have no goals yet/)
      assert.equal(await page.locator('[data-testid=new-goal-empty]').count(), 1)
      await page.click('[data-testid=tab-checkins]')
      await page.waitForSelector('[data-testid=my-checkins] [data-testid=empty-state]')
      assert.match(await text(page, '[data-testid=empty-state]'), /You have no check-ins yet/)
      await page.selectOption('[data-testid=checkin-status-filter]', 'acknowledged')
      await page.waitForFunction(() => /No check-ins with this status/.test(document.querySelector('[data-testid=empty-state]')?.textContent || ''))
    },
    { signInAs: CARLA },
  )
})

test('pagination: 45 goals are 3 pages of at most 20; Next and Previous fetch the right page', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/performance', '[data-testid=goal-row]')
      assert.equal(await page.locator('[data-testid=goal-row]').count(), 20)
      assert.match(await text(page, '[data-testid=pager-label]'), /Page 1 of 3/)
      assert.equal(await page.locator('[data-testid=pager-prev]').isDisabled(), true)
      await page.click('[data-testid=pager-next]')
      await page.waitForFunction(() => /Page 2 of 3/.test(document.querySelector('[data-testid=pager-label]')?.textContent || ''))
      await page.click('[data-testid=pager-next]')
      await page.waitForFunction(() => /Page 3 of 3/.test(document.querySelector('[data-testid=pager-label]')?.textContent || ''))
      assert.equal(await page.locator('[data-testid=goal-row]').count(), 5)
      assert.equal(await page.locator('[data-testid=pager-next]').isDisabled(), true)
      assert.ok(state.log.some((l) => /page=3/.test(l)))
      await page.click('[data-testid=pager-prev]')
      await page.waitForFunction(() => /Page 2 of 3/.test(document.querySelector('[data-testid=pager-label]')?.textContent || ''))
    },
    {
      signInAs: CARLA,
      seed: (state) => {
        for (let i = 0; i < 45; i++) state.goals.push(makeGoal({ title: `Fictional goal ${String(i).padStart(2, '0')}`, updated_at: `2026-11-${String(10 + (i % 5)).padStart(2, '0')}T10:00:00.000Z` }))
      },
    },
  )
})

test('goal detail: controls follow allowed_actions only. The owner with [] sees read-only; a forced "comment" shows the comment form even for the owner', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      const id = state.goals[0].goal_id
      state.forceGoalActions = []
      await visit(page, mock, `/performance/goals/${id}`, '[data-testid=goal-detail]')
      assert.equal(await page.locator('[data-testid=goal-readonly]').count(), 1)
      for (const t of ['progress-slider', 'progress-save', 'status-select', 'goal-edit', 'comment-form']) assert.equal(await page.locator(`[data-testid=${t}]`).count(), 0, t)
      state.forceGoalActions = ['comment']
      await page.reload()
      await page.waitForSelector('[data-testid=comment-form]')
      assert.equal(await page.locator('[data-testid=goal-edit]').count(), 0)
      state.forceGoalActions = ['edit']
      await page.reload()
      await page.waitForSelector('[data-testid=progress-slider]')
      assert.equal(await page.locator('[data-testid=comment-form]').count(), 0)
      assert.equal(await page.locator('[data-testid=comment-readonly]').count(), 1)
    },
    { signInAs: CARLA, seed: seedGoals },
  )
})

test('goal editing: progress steps and slider, derived status, stale version (409) reloads with a banner, server 422 shows next to the field', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      const goal = state.goals[0]
      await visit(page, mock, `/performance/goals/${goal.goal_id}`, '[data-testid=goal-detail]')
      assert.match(await text(page, '[data-testid=progress-value]'), /40%/)
      assert.equal(await page.locator('[data-testid=progress-save]').isDisabled(), true, 'nothing to save yet')
      await page.fill('[data-testid=progress-slider]', '70')
      assert.match(await text(page, '[data-testid=progress-value]'), /70%/)
      await page.click('[data-testid=progress-save]')
      await page.waitForFunction(() => /Progress saved: 70%/.test(document.querySelector('[data-testid=goal-banner]')?.textContent || ''))
      assert.equal(goal.progress, 70)
      await page.click('[data-testid=progress-step-100]')
      assert.match(await text(page, '[data-testid=progress-preview]'), /Done/)
      await page.click('[data-testid=progress-save]')
      await page.waitForFunction(() => /\(Done\)/.test(document.querySelector('[data-testid=goal-banner]')?.textContent || ''))
      assert.match(await text(page, '[data-testid=goal-status]'), /Done/)

      // stale version: someone else changed the goal in between
      goal.version += 5
      goal.title = 'Changed elsewhere'
      await page.click('[data-testid=progress-step-50]')
      await page.click('[data-testid=progress-save]')
      await page.waitForFunction(() => /latest version has been loaded/.test(document.querySelector('[data-testid=goal-banner]')?.textContent || ''))
      await page.waitForFunction(() => /Changed elsewhere/.test(document.querySelector('h1')?.textContent || ''))

      // server-side validation message lands next to the field
      await page.click('[data-testid=goal-edit]')
      await page.fill('[data-testid=goal-title]', 'A fine title')
      state.failures.set('/performance/goals/', { status: 422, times: 1, body: { detail: 'Invalid request', errors: [{ loc: ['body', 'title'], msg: 'Title is not allowed by the server' }] } })
      await page.click('[data-testid=goal-save]')
      await page.waitForSelector('#goal-title-error')
      assert.match(await text(page, '#goal-title-error'), /not allowed by the server/)
    },
    { signInAs: CARLA, seed: seedGoals },
  )
})

test('goal create: client validation blocks a bad title and an impossible date; a good goal is posted and listed', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/performance', '[data-testid=my-goals]')
      await page.click('[data-testid=new-goal]')
      await page.fill('[data-testid=goal-title]', 'x'.repeat(125))
      assert.match(await page.locator('[data-testid=goal-create-card] .pf-counter').first().innerText(), /125\/120/)
      await page.click('[data-testid=goal-save]')
      assert.match(await text(page, '#goal-title-error'), /at most 120/)
      assert.equal(state.goals.length, 0, 'nothing was sent')
      await page.fill('[data-testid=goal-title]', 'Run the fictional safety drill')
      await page.click('[data-testid=goal-save]')
      await page.waitForSelector('[data-testid=goal-flash]')
      assert.equal(state.goals.length, 1)
      assert.equal(await page.locator('[data-testid=goal-row]').count(), 1)
      await page.click('[data-testid=new-goal]')
      await page.click('[data-testid=goal-cancel]')
      assert.equal(await page.locator('[data-testid=goal-create-card]').count(), 0)
    },
    { signInAs: CARLA },
  )
})

test('check-ins: mood is shown only when the server says it is visible (owner and manager yes, HR no until the switch is on)', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      const c = state.checkins[0]
      await visit(page, mock, `/performance/checkins/${c.checkin_id}`, '[data-testid=checkin-detail]')
      assert.match(await text(page, '[data-testid=checkin-mood]'), /4 of 5 \(Good\)/, 'the owner sees it')
      assert.match(await text(page, '[data-testid=checkin-reviewer]'), /Ben Cruz/)

      // HR needs its own session: a fresh browser context
      const hrCtx = await browser.newContext({ viewport: { width: 1448, height: 1000 } })
      const hr = await hrCtx.newPage()
      await hr.clock.setFixedTime(new Date('2026-11-16T10:00:00'))
      await signIn(hr, mock.origin, ANNA)
      await hr.waitForSelector('.app-content')
      await hr.goto(`${mock.origin}/performance/checkins/${c.checkin_id}`)
      await hr.waitForSelector('[data-testid=checkin-detail]')
      assert.match(await text(hr, '[data-testid=checkin-mood]'), /Not shared with you/)
      assert.ok(!(await text(hr, '[data-testid=checkin-detail]')).includes('4 of 5'))
      assert.equal(await hr.locator('[data-testid=ack-panel]').count(), 0, 'HR has no acknowledge action while a manager is reachable')
      state.hrCanSeeMood = true
      await hr.reload()
      await hr.waitForSelector('[data-testid=checkin-detail]')
      assert.match(await text(hr, '[data-testid=checkin-mood]'), /4 of 5 \(Good\)/)
      await hrCtx.close()
    },
    { signInAs: CARLA, seed: (state) => state.checkins.push(makeCheckin({ period_label: '2027-Q1', mood: 4 })) },
  )
})

test('check-in with no reachable manager: the reviewer is HR, shown in plain words, and HR gets the acknowledge panel', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      const c = state.checkins[0]
      await visit(page, mock, `/performance/checkins/${c.checkin_id}`, '[data-testid=checkin-detail]')
      assert.match(await text(page, '[data-testid=checkin-reviewer]'), /HR \(no manager is set up for this person\)/)
      assert.match(await text(page, '[data-testid=checkin-hint]'), /Waiting for HR/)
      await page.waitForSelector('[data-testid=ack-panel]')
      await page.fill('[data-testid=ack-feedback]', 'f'.repeat(2005))
      await page.click('[data-testid=ack-submit]')
      assert.match(await text(page, '#ack-error'), /at most 2000/)
      assert.equal(c.status, 'submitted', 'nothing was sent')
      await page.fill('[data-testid=ack-feedback]', 'Noted, thank you.')
      await page.click('[data-testid=ack-submit]')
      await page.waitForFunction(() => /acknowledged/i.test(document.querySelector('[data-testid=checkin-banner]')?.textContent || ''))
      assert.match(await text(page, '[data-testid=checkin-ack-by]'), /Acknowledged by HR/)
    },
    {
      signInAs: ANNA,
      seed: (state) => {
        state.noManager.add('EMP-0003')
        state.checkins.push(makeCheckin({ period_label: '2027-Q1' }))
      },
    },
  )
})

test('manager: tabs, the to-acknowledge badge, filters, requesting a check-in from a direct report, a duplicate request and an acknowledge conflict', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/performance', PERF)
      assert.equal(await page.locator('[data-testid^=tab-]').count(), 4)
      await page.waitForFunction(() => /\b1\b/.test(document.querySelector('[data-testid=tab-team]')?.innerText || ''))
      await page.click('[data-testid=tab-team]')
      await page.waitForSelector('[data-testid=checkin-row]')
      assert.equal(await page.locator('[data-testid=team-scope]').count(), 0, 'one scope: no selector')
      assert.match(new URL(page.url()).search, /tab=team/)

      // filters
      await page.click('[data-testid=team-view-checkins]')
      await page.waitForSelector('[data-testid=team-filters]')
      assert.equal(await page.locator('[data-testid=checkin-row]').count(), 2)
      await page.selectOption('[data-testid=team-status-filter]', 'acknowledged')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=checkin-row]').length === 1)
      await page.selectOption('[data-testid=team-status-filter]', '')
      await page.fill('[data-testid=team-period-filter]', '2027-q2')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=checkin-row]').length === 1)
      await page.fill('[data-testid=team-period-filter]', 'nothing')
      await page.waitForSelector('[data-testid=team-view] [data-testid=empty-state]')
      assert.match(await text(page, '[data-testid=team-view] [data-testid=empty-state]'), /No check-ins match these filters/)
      await page.fill('[data-testid=team-period-filter]', '')
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=checkin-row]').length === 2)

      // request a check-in from Carla
      await page.click('[data-testid=request-checkin]')
      await page.waitForSelector('[data-testid=request-card] form')
      await page.selectOption('[data-testid=request-who]', 'EMP-0003')
      await page.fill('[data-testid=request-period]', '2027-Q3')
      await page.click('[data-testid=request-submit]')
      await page.waitForSelector('[data-testid=team-flash]')
      assert.match(await text(page, '[data-testid=team-flash]'), /requested from Carla Dizon: 2027-Q3/)
      assert.ok(state.checkins.some((c) => c.period_label === '2027-Q3' && c.status === 'requested'))
      // duplicate
      await page.click('[data-testid=request-checkin]')
      await page.selectOption('[data-testid=request-who]', 'EMP-0003')
      await page.fill('[data-testid=request-period]', ' 2027-q3 ')
      await page.click('[data-testid=request-submit]')
      await page.waitForSelector('[data-testid=request-error]')
      assert.match(await text(page, '[data-testid=request-error]'), /already exists/)
      await page.click('[data-testid=request-cancel]')

      // goals view shows the owner and links to the detail with a comment form
      await page.click('[data-testid=team-view-goals]')
      await page.waitForSelector('[data-testid=goal-row]')
      await page.locator('[data-testid=goal-row]').first().click()
      await page.waitForSelector('[data-testid=comment-form]')
      await page.fill('[data-testid=comment-text]', 'Looks good.')
      await page.click('[data-testid=comment-submit]')
      await page.waitForSelector('[data-testid=comment]')
      assert.equal(state.goals[0].comments.length, 1)

      // an acknowledge that the server refuses (someone acknowledged it first) reloads the check-in with a banner
      const pending = state.checkins.find((c) => c.status === 'submitted')
      await page.goto(`${mock.origin}/performance/checkins/${pending.checkin_id}`)
      await page.waitForSelector('[data-testid=ack-panel]')
      pending.status = 'acknowledged'
      pending.acknowledged_at = '2026-11-16T09:00:00.000Z'
      pending.acknowledged_by = { employee_id: 'EMP-0002', name: 'Ben Cruz', kind: 'manager' }
      await page.click('[data-testid=ack-submit]')
      await page.waitForFunction(() => /changed in the meantime/.test(document.querySelector('[data-testid=checkin-banner]')?.textContent || ''))
      await page.waitForFunction(() => !document.querySelector('[data-testid=ack-panel]'))
    },
    {
      signInAs: BEN,
      seed: (state) => {
        state.goals.push(makeGoal({ title: 'Complete the compliance refresher' }))
        state.checkins.push(makeCheckin({ period_label: '2027-Q1' }))
        state.checkins.push(makeCheckin({ employee_id: 'EMP-0004', period_label: '2027-Q2', status: 'acknowledged', acknowledged_at: '2026-11-10T00:00:00.000Z', acknowledged_by: { employee_id: 'EMP-0002', name: 'Ben Cruz', kind: 'manager' }, feedback: 'Great.' }))
      },
    },
  )
})

test('employee: no Team or HR tabs, a forced ?tab=team falls back to My goals, the server refusal of a forced scope is not shown as data', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock }) => {
      await visit(page, mock, '/performance?tab=team', PERF)
      assert.equal(await page.locator('[data-testid^=tab-]').count(), 2)
      assert.equal(await page.getAttribute(PERF, 'data-tab'), 'goals')
      await page.goto(`${mock.origin}/performance?tab=overview`)
      await page.waitForSelector(PERF)
      assert.equal(await page.getAttribute(PERF, 'data-tab'), 'goals')
    },
    { signInAs: DAN },
  )
})

test('HR overview: counts per period and department, filters, no names or text, the mood note follows the server config', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/performance?tab=overview', '[data-testid=overview-period-card]')
      assert.equal(await page.locator('[data-testid=tab-overview]').count(), 1)
      const q1 = page.locator('[data-testid=overview-period-card][data-period="2027-Q1"]')
      assert.equal(await q1.locator('[data-testid=period-total]').innerText(), '2')
      assert.equal(await q1.locator('[data-testid=period-submitted]').innerText(), '1')
      assert.equal(await q1.locator('[data-testid=period-acknowledged]').innerText(), '1')
      assert.match(await q1.locator('[data-testid=period-pct]').innerText(), /100% complete/)
      assert.match(await q1.innerText(), /Compliance[\s\S]*Finance|Finance[\s\S]*Compliance/)
      const body = await text(page, '[data-testid=hr-overview]')
      for (const secret of ['Carla', 'Dan Ocampo', 'Closed the audit', 'Waiting for the policy owner', 'Great']) assert.ok(!body.includes(secret), secret)
      assert.match(await text(page, '[data-testid=overview-note]'), /it is currently off/)
      const q2 = page.locator('[data-testid=overview-period-card][data-period="2027-Q2"]')
      assert.equal(await q2.locator('[data-testid=period-requested]').innerText(), '1')
      assert.match(await q2.locator('[data-testid=period-pct]').innerText(), /0% complete/)
      await page.selectOption('[data-testid=overview-department]', 'Finance')
      await page.waitForFunction(() => document.querySelector('[data-testid=overview-period-card][data-period="2027-Q1"] [data-testid=period-total]')?.innerText === '1')
      assert.equal(await page.locator('[data-testid=overview-period-card]').count(), 2, 'only Finance counts remain')
      assert.equal(await page.locator('[data-testid=overview-department] option').count(), 3, 'the department list does not collapse after filtering')
      state.hrCanSeeMood = true
      await page.reload()
      await page.waitForSelector('[data-testid=overview-note]')
      assert.match(await text(page, '[data-testid=overview-note]'), /currently visible to HR/)
    },
    {
      signInAs: ANNA,
      seed: (state) => {
        state.goals.push(makeGoal({ status: 'done', progress: 100 }), makeGoal({ status: 'in_progress', progress: 20 }))
        state.checkins.push(makeCheckin({ period_label: '2027-Q1' }))
        state.checkins.push(makeCheckin({ employee_id: 'EMP-0004', period_label: '2027-Q1', status: 'acknowledged', feedback: 'Great.' }))
        state.checkins.push(makeCheckin({ employee_id: 'EMP-0004', period_label: '2027-Q2', status: 'requested', accomplishments: '', blockers: '', next_steps: '', mood: null }))
      },
    },
  )
})

test('deep links: a goal or check-in the caller cannot see (404) and a malformed id show an honest not-found; a 500 shows an error with retry', opts, async () => {
  await withPerfMock(
    browser,
    async ({ page, mock, state }) => {
      await visit(page, mock, '/performance/goals/00000000-0000-4000-8000-0000000000ff', '[data-testid=goal-detail-error]')
      assert.match(await text(page, '[data-testid=goal-detail-error] [data-testid=empty-state]'), /Goal not found/)
      await visit(page, mock, '/performance/checkins/nope', '[data-testid=checkin-detail-error]')
      assert.match(await text(page, '[data-testid=checkin-detail-error] [data-testid=empty-state]'), /Check-in not found/)
      state.failures.set('/performance/goals/', { status: 500, times: 1 })
      await visit(page, mock, `/performance/goals/${state.goals[0].goal_id}`, '[data-testid=load-error]')
      await page.click('[data-testid=load-error] button')
      await page.waitForSelector('[data-testid=goal-detail]')
    },
    { signInAs: CARLA, seed: seedGoals },
  )
})

test('responsive: the goal and check-in pages never scroll sideways, even with very long unbroken titles and text', opts, async () => {
  const long = 'Supercalifragilisticexpialidocious-Goal-Title-Without-Any-Spaces-To-Wrap-0123456789-0123456789'
  for (const width of [1440, 768, 390, 320]) {
    await withPerfMock(
      browser,
      async ({ page, mock, state }) => {
        for (const path of ['/performance', '/performance?tab=checkins', `/performance/goals/${state.goals[0].goal_id}`, `/performance/checkins/${state.checkins[0].checkin_id}`]) {
          await page.goto(`${mock.origin}${path}`)
          await page.waitForSelector('[data-testid=goal-row], [data-testid=checkin-row], [data-testid=goal-detail], [data-testid=checkin-detail]')
          assert.ok(await noOverflow(page), `${path} @${width}`)
        }
      },
      {
        signInAs: CARLA,
        viewport: { width, height: 900 },
        seed: (state) => {
          state.goals.push(makeGoal({ title: long, description: long.repeat(3) }))
          state.checkins.push(makeCheckin({ period_label: long.slice(0, 60), accomplishments: long.repeat(4), blockers: long, next_steps: long }))
        },
      },
    )
  }
  await until(() => true)
})
