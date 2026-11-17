// REAL-BACKEND end-to-end suite for Performance & Check-ins. Starts the real backend (in-memory DB, demo auth,
// temp storage, random port) behind a node server that serves frontend/dist and proxies /api, then drives real
// system Chrome through goals, check-ins, the manager request flow and the HR overview with the six fictional
// demo people (Anna = HR, Miguel = Jamie's manager, Carla = Lia's manager, Jamie, Lia, Paolo).
// Gated: RUN_BROWSER_TESTS=1 (use `npm run test:browser`). No external service is contacted.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, startRealStack } from './real-backend.mjs'
import { actor, apiCall, apiLogin, pageApi, text, waitGone } from './e2e-helpers.mjs'

const enabled = process.env.RUN_BROWSER_TESTS === '1'
const opts = { skip: enabled ? false : 'set RUN_BROWSER_TESTS=1 to run real-browser tests' }

let browser
let stack
let origin
const open = []

before(async () => {
  if (!enabled) return
  stack = await startRealStack()
  origin = stack.origin
  browser = await launchBrowser()
})
after(async () => {
  for (const a of open.splice(0)) await a.close().catch(() => undefined)
  await browser?.close()
  await stack?.close()
})

async function as(email, viewport) {
  const a = await actor(browser, origin, email, viewport)
  open.push(a)
  return a
}
async function done(...actors) {
  for (const a of actors) {
    assert.deepEqual(a.pageErrors, [], 'no uncaught page errors')
    await a.close()
    open.splice(open.indexOf(a), 1)
  }
}

const goto = async (page, path, ready) => {
  await page.goto(`${origin}${path}`)
  await page.waitForSelector(ready)
}
const perf = (page, qs = '') => goto(page, `/performance${qs}`, '[data-testid=performance-page]')
const goalPath = (id) => `/performance/goals/${id}`
const checkinPath = (id) => `/performance/checkins/${id}`
const idFromUrl = (page) => new URL(page.url()).pathname.split('/').pop()

async function apiGoal(email, title, extra = {}) {
  const t = await apiLogin(origin, email)
  const r = await apiCall(origin, t, 'POST', '/performance/goals', { title, description: '', ...extra })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  return r.json
}
async function apiCheckin(email, period, extra = {}) {
  const t = await apiLogin(origin, email)
  const r = await apiCall(origin, t, 'POST', '/performance/checkins', { period_label: period, accomplishments: 'Finished the onboarding docs.', ...extra })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  return r.json
}

// ------------------------------------------------------------------------------------------------ goals
test('E2E goals: Jamie starts empty, creates a goal, sets progress and status, edits details', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const p = jamie.page
  await perf(p)
  assert.equal(await p.locator('[data-testid=placeholder-notice]').count(), 0)
  assert.equal(await p.locator('[data-testid^=tab-]').count(), 2, 'an employee has two tabs')
  await p.waitForSelector('[data-testid=my-goals] [data-testid=empty-state]')
  assert.match(await text(p, '[data-testid=empty-state]'), /You have no goals yet/)

  // validation first: nothing is sent for a blank title
  await p.click('[data-testid=new-goal-empty]')
  await p.waitForSelector('[data-testid=goal-create-card]')
  await p.click('[data-testid=goal-save]')
  assert.match(await text(p, '#goal-title-error'), /Give the goal a title/)

  await p.fill('[data-testid=goal-title]', 'Finish the onboarding handbook (E2E)')
  await p.fill('[data-testid=goal-description]', 'Fictional goal: write and review the handbook.\nSecond line.')
  await p.fill('[data-testid=goal-due]', '2027-03-31')
  await p.click('[data-testid=goal-save]')
  await p.waitForSelector('[data-testid=goal-flash]')
  assert.match(await text(p, '[data-testid=goal-flash]'), /Goal created: Finish the onboarding handbook/)
  const row = p.locator('[data-testid=goal-row]', { hasText: 'Finish the onboarding handbook (E2E)' })
  assert.equal(await row.count(), 1)
  assert.match(await row.innerText(), /Not started/)
  assert.match(await row.innerText(), /Due 31 Mar 2027/)

  await row.click()
  await p.waitForSelector('[data-testid=goal-detail]')
  assert.match(p.url(), /\/performance\/goals\/[0-9a-f-]{36}$/)
  const id = idFromUrl(p)
  assert.match(await text(p, '[data-testid=goal-description-text]'), /Second line/)
  assert.equal(await p.locator('[data-testid=goal-readonly]').count(), 0)

  // progress by step: 50 -> in progress
  await p.click('[data-testid=progress-step-50]')
  assert.match(await text(p, '[data-testid=progress-preview]'), /In progress/)
  await p.click('[data-testid=progress-save]')
  await p.waitForSelector('[data-testid=goal-banner]')
  assert.match(await text(p, '[data-testid=goal-banner]'), /Progress saved: 50%/)
  assert.match(await text(p, '[data-testid=goal-progress]'), /50%/)
  assert.match(await text(p, '[data-testid=goal-status]'), /In progress/)
  // the server really stored it
  assert.equal((await pageApi(p, origin, 'GET', `/performance/goals/${id}`)).json.progress, 50)

  // status offered only per the state machine: from in_progress with progress 50 there is no "Not started"
  const choices = await p.$$eval('[data-testid=status-select] option', (o) => o.map((x) => x.textContent))
  assert.deepEqual(choices, ['In progress', 'Done', 'Dropped'])
  await p.selectOption('[data-testid=status-select]', 'done')
  await p.click('[data-testid=status-save]')
  await p.waitForFunction(() => /Status saved: Done/.test(document.querySelector('[data-testid=goal-banner]')?.textContent || ''))
  assert.match(await text(p, '[data-testid=goal-progress]'), /100%/)
  // reopening a done goal gives 99 (server rule) and the page shows what the server returned
  await p.selectOption('[data-testid=status-select]', 'in_progress')
  await p.click('[data-testid=status-save]')
  await p.waitForFunction(() => /Status saved: In progress/.test(document.querySelector('[data-testid=goal-banner]')?.textContent || ''))
  assert.match(await text(p, '[data-testid=goal-progress]'), /99%/)

  // edit details
  await p.click('[data-testid=goal-edit]')
  await p.fill('[data-testid=goal-title]', 'Finish the onboarding handbook v2 (E2E)')
  await p.fill('[data-testid=goal-due]', '')
  await p.click('[data-testid=goal-save]')
  await p.waitForFunction(() => /Goal details saved/.test(document.querySelector('[data-testid=goal-banner]')?.textContent || ''))
  assert.match(await text(p, 'h1'), /v2 \(E2E\)/)
  assert.match(await text(p, '[data-testid=goal-due-date]'), /No due date/)

  // a dropped goal cannot have its progress changed until it is reopened
  await p.selectOption('[data-testid=status-select]', 'dropped')
  await p.click('[data-testid=status-save]')
  await p.waitForSelector('[data-testid=goal-dropped-note]')
  assert.equal(await p.locator('[data-testid=progress-save]').isDisabled(), true)
  assert.equal(await p.locator('[data-testid=progress-slider]').isDisabled(), true)
  await p.selectOption('[data-testid=status-select]', 'in_progress')
  await p.click('[data-testid=status-save]')
  await waitGone(p, '[data-testid=goal-dropped-note]')
  await done(jamie)
})

test('E2E goals: Miguel (manager) sees Jamie\'s goal, comments, cannot edit it; Jamie sees the comment but cannot reply; Lia cannot see it', opts, async () => {
  const goal = await apiGoal(PEOPLE.jamie, 'Shadow two client calls (E2E)', { description: 'Fictional.' })

  const miguel = await as(PEOPLE.miguel)
  const m = miguel.page
  await perf(m, '?tab=team&view=goals')
  await m.waitForSelector('[data-testid=goal-row]')
  assert.equal(await m.locator('[data-testid=tab-team]').count(), 1)
  const row = m.locator('[data-testid=goal-row]', { hasText: 'Shadow two client calls (E2E)' })
  assert.equal(await row.count(), 1)
  assert.match(await row.locator('[data-testid=goal-owner]').innerText(), /Jamie Dela Cruz/)
  await row.click()
  await m.waitForSelector('[data-testid=goal-detail]')
  assert.equal(idFromUrl(m), goal.goal_id)
  assert.equal(await m.locator('[data-testid=goal-readonly]').count(), 1, 'the manager gets a read-only goal')
  for (const sel of ['progress-save', 'status-save', 'goal-edit', 'progress-slider']) assert.equal(await m.locator(`[data-testid=${sel}]`).count(), 0, `${sel} must not exist for the manager`)
  // the server agrees: the manager may not edit
  assert.equal((await pageApi(m, origin, 'PATCH', `/performance/goals/${goal.goal_id}`, { title: 'Hacked', version: 1 })).status, 403)

  // comment: empty is refused locally, then posted
  await m.click('[data-testid=comment-submit]')
  assert.match(await text(m, '#comment-error'), /Write a comment first/)
  await m.fill('[data-testid=comment-text]', 'Great start - let us pick the calls on Monday.')
  await m.click('[data-testid=comment-submit]')
  await m.waitForSelector('[data-testid=comment]')
  assert.match(await text(m, '[data-testid=comment]'), /Miguel Santos[\s\S]*Great start/)
  assert.equal(await m.inputValue('[data-testid=comment-text]'), '')
  await done(miguel)

  const jamie = await as(PEOPLE.jamie)
  const j = jamie.page
  // the in-app notification links to the goal and opens it
  const notes = (await pageApi(j, origin, 'GET', '/notifications')).json.items.filter((n) => n.kind === 'goal.commented')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].link, goalPath(goal.goal_id))
  assert.ok(!notes[0].body.includes('Great start'), 'the comment text is never copied into the notification')
  await j.goto(`${origin}/`)
  await j.waitForSelector('[data-testid=bell]')
  await j.click('[data-testid=bell]')
  await j.waitForSelector('[data-testid=bell-item]')
  await j.click('[data-testid=bell-item]:has-text("commented on")')
  await j.waitForSelector('[data-testid=goal-detail]')
  assert.equal(idFromUrl(j), goal.goal_id)
  assert.match(await text(j, '[data-testid=comment]'), /Great start/)
  assert.equal(await j.locator('[data-testid=comment-form]').count(), 0, 'the owner cannot reply in this version')
  assert.match(await text(j, '[data-testid=comment-readonly]'), /Only the owner's manager can comment/)
  assert.equal(await j.locator('[data-testid=goal-readonly]').count(), 0, 'the owner can still edit')
  assert.equal((await pageApi(j, origin, 'POST', `/performance/goals/${goal.goal_id}/comments`, { text: 'reply' })).status, 403)
  await done(jamie)

  // Lia reports to Carla: Jamie's goal is invisible to her, by id and in every list
  const lia = await as(PEOPLE.lia)
  assert.equal((await pageApi(lia.page, origin, 'GET', `/performance/goals/${goal.goal_id}`)).status, 404)
  await lia.page.goto(`${origin}${goalPath(goal.goal_id)}`)
  await lia.page.waitForSelector('[data-testid=goal-detail-error]')
  assert.match(await text(lia.page, '[data-testid=goal-detail-error] [data-testid=empty-state]'), /Goal not found/)
  await perf(lia.page)
  await lia.page.waitForSelector('[data-testid=my-goals] [data-testid=empty-state]')
  assert.equal(await lia.page.locator('[data-testid=goal-row]').count(), 0)
  assert.equal(await lia.page.locator('[data-testid=tab-team]').count(), 0, 'an employee is not offered the Team tab')
  assert.equal((await pageApi(lia.page, origin, 'GET', '/performance/goals?scope=team')).status, 403, 'and the server refuses a forced team scope')
  await lia.page.goto(`${origin}/performance?tab=team`)
  await lia.page.waitForSelector('[data-testid=performance-page][data-tab=goals]')
  await done(lia)
})

// ------------------------------------------------------------------------------------------------ check-ins
test('E2E check-in: Jamie submits with a mood, a duplicate period is refused, Miguel acknowledges with feedback, Jamie sees it', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const j = jamie.page
  await perf(j, '?tab=checkins')
  await j.waitForSelector('[data-testid=my-checkins] [data-testid=empty-state]')
  await j.click('[data-testid=new-checkin-empty]')
  await j.waitForSelector('[data-testid=checkin-form]')

  // validation: period and at least one text
  await j.click('[data-testid=checkin-submit]')
  assert.match(await text(j, '[data-testid=checkin-form]'), /Name the period/)
  assert.match(await text(j, '[data-testid=checkin-form]'), /at least one of accomplishments, blockers or next steps/)

  await j.fill('[data-testid=checkin-period]', '2027-Q1')
  await j.fill('[data-testid=checkin-accomplishments]', 'Wrote the handbook outline.')
  await j.fill('[data-testid=checkin-blockers]', 'Waiting on the style guide.')
  await j.fill('[data-testid=checkin-next_steps]', 'Draft chapters 1 to 3.')
  await j.check('[data-testid=mood-4]')
  await j.click('[data-testid=checkin-submit]')
  await j.waitForSelector('[data-testid=checkin-flash]')
  assert.match(await text(j, '[data-testid=checkin-flash]'), /Check-in submitted: 2027-Q1/)
  const row = j.locator('[data-testid=checkin-row]', { hasText: '2027-Q1' })
  assert.equal(await row.count(), 1)
  assert.match(await row.innerText(), /Submitted/)
  assert.match(await row.innerText(), /Reviewer: Miguel Santos/)

  // the same period again (different case and spacing) is refused with a link to the existing one
  await j.click('[data-testid=new-checkin]')
  await j.fill('[data-testid=checkin-period]', '  2027-q1 ')
  await j.fill('[data-testid=checkin-blockers]', 'Duplicate attempt.')
  await j.click('[data-testid=checkin-submit]')
  await j.waitForSelector('[data-testid=checkin-form-error]')
  assert.match(await text(j, '[data-testid=checkin-form-error]'), /already/i)
  await j.click('[data-testid=existing-checkin-link]')
  await j.waitForSelector('[data-testid=checkin-detail]')
  const id = idFromUrl(j)
  assert.match(await text(j, '[data-testid=checkin-status]'), /Submitted/)
  assert.match(await text(j, '[data-testid=checkin-mood]'), /4 of 5 \(Good\)/)
  assert.match(await text(j, '[data-testid=checkin-text-blockers]'), /style guide/)
  assert.equal(await j.locator('[data-testid=ack-panel]').count(), 0, 'nobody acknowledges their own check-in')
  assert.equal(await j.locator('[data-testid=checkin-fill-card]').count(), 0, 'a submitted check-in is immutable')
  assert.match(await text(j, '[data-testid=checkin-readonly]'), /nothing for you to do/)
  assert.match(await text(j, '[data-testid=checkin-reviewer]'), /Miguel Santos/)
  await done(jamie)

  const miguel = await as(PEOPLE.miguel)
  const m = miguel.page
  await perf(m, '?tab=team')
  await m.waitForSelector('[data-testid=checkin-row]')
  assert.match(await text(m, '[data-testid=tab-team]'), /\b1\b/, 'the Team tab badge shows the waiting review')
  const mrow = m.locator('[data-testid=checkin-row]', { hasText: '2027-Q1' })
  assert.match(await mrow.locator('[data-testid=checkin-owner]').innerText(), /Jamie Dela Cruz/)
  await mrow.click()
  await m.waitForSelector('[data-testid=checkin-detail]')
  assert.equal(idFromUrl(m), id)
  assert.match(await text(m, '[data-testid=checkin-mood]'), /4 of 5/, 'the direct manager sees the mood')
  await m.fill('[data-testid=ack-feedback]', 'Thanks - the outline looks solid. Send the style guide request to me.')
  await m.click('[data-testid=ack-submit]')
  await m.waitForFunction(() => /acknowledged/i.test(document.querySelector('[data-testid=checkin-banner]')?.textContent || ''))
  assert.match(await text(m, '[data-testid=checkin-status]'), /Acknowledged/)
  assert.match(await text(m, '[data-testid=checkin-feedback]'), /outline looks solid/)
  assert.equal(await m.locator('[data-testid=ack-panel]').count(), 0)
  // acknowledging twice is a server 409
  assert.equal((await pageApi(m, origin, 'POST', `/performance/checkins/${id}/acknowledge`, {})).status, 409)
  await done(miguel)

  const jamie2 = await as(PEOPLE.jamie)
  const j2 = jamie2.page
  await goto(j2, checkinPath(id), '[data-testid=checkin-detail]')
  assert.match(await text(j2, '[data-testid=checkin-status]'), /Acknowledged/)
  assert.match(await text(j2, '[data-testid=checkin-ack-by]'), /Acknowledged by Miguel Santos/)
  assert.match(await text(j2, '[data-testid=checkin-feedback]'), /outline looks solid/)
  const notes = (await pageApi(j2, origin, 'GET', '/notifications')).json.items.filter((n) => n.kind === 'checkin.acknowledged')
  assert.equal(notes.length, 1)
  assert.equal(notes[0].link, checkinPath(id))
  assert.ok(!notes[0].body.includes('outline looks solid'), 'feedback never appears in a notification')
  await done(jamie2)
})

test('E2E check-in: Miguel requests one from Jamie, Jamie fills it in, Miguel acknowledges; a second request for the period is refused', opts, async () => {
  const miguel = await as(PEOPLE.miguel)
  const m = miguel.page
  await perf(m, '?tab=team')
  await m.click('[data-testid=request-checkin]')
  await m.waitForSelector('[data-testid=request-card] form')
  const people = await m.$$eval('[data-testid=request-who] option', (o) => o.map((x) => x.textContent.trim()))
  assert.ok(people.some((x) => x.startsWith('Jamie Dela Cruz')) && people.some((x) => x.startsWith('Paolo Cruz')), `direct reports only: ${people}`)
  assert.ok(!people.some((x) => x.startsWith('Lia Ramos')), "Carla's report is not offered")
  await m.click('[data-testid=request-submit]')
  assert.match(await text(m, '[data-testid=request-card]'), /Name the period/)
  await m.selectOption('[data-testid=request-who]', { label: people.find((x) => x.startsWith('Jamie')) })
  await m.fill('[data-testid=request-period]', 'Week 3 (E2E)')
  await m.click('[data-testid=request-submit]')
  await m.waitForSelector('[data-testid=team-flash]')
  assert.match(await text(m, '[data-testid=team-flash]'), /Check-in requested from Jamie Dela Cruz: Week 3 \(E2E\)/)

  // asking again for the same period is a server conflict, shown inline with a link
  await m.click('[data-testid=request-checkin]')
  await m.waitForSelector('[data-testid=request-card] form')
  await m.selectOption('[data-testid=request-who]', { label: people.find((x) => x.startsWith('Jamie')) })
  await m.fill('[data-testid=request-period]', 'week 3 (e2e)')
  await m.click('[data-testid=request-submit]')
  await m.waitForSelector('[data-testid=request-error]')
  assert.match(await text(m, '[data-testid=request-error]'), /already exists for this person/)
  await done(miguel)

  const jamie = await as(PEOPLE.jamie)
  const j = jamie.page
  await perf(j, '?tab=checkins')
  await j.waitForSelector('[data-testid=requested-of-me]')
  assert.match(await text(j, '[data-testid=tab-checkins]'), /\b1\b/, 'the tab badge counts the request')
  assert.match(await text(j, '[data-testid=requested-of-me]'), /Week 3 \(E2E\)/)
  await j.locator('[data-testid=requested-of-me] [data-testid=checkin-row]').click()
  await j.waitForSelector('[data-testid=checkin-fill-form]')
  const id = idFromUrl(j)
  assert.match(await text(j, '[data-testid=checkin-status]'), /Requested/)
  assert.equal(await j.locator('[data-testid=checkin-period]').count(), 0, 'the period is fixed by the request')
  await j.click('[data-testid=checkin-submit]')
  assert.match(await text(j, '[data-testid=checkin-fill-form]'), /at least one of/)
  await j.fill('[data-testid=checkin-accomplishments]', 'Closed three support tickets.')
  await j.click('[data-testid=mood-5]')
  await j.click('[data-testid=mood-clear]')
  await j.click('[data-testid=checkin-submit]')
  await j.waitForFunction(() => /now waiting to be acknowledged/.test(document.querySelector('[data-testid=checkin-banner]')?.textContent || ''))
  assert.match(await text(j, '[data-testid=checkin-status]'), /Submitted/)
  assert.match(await text(j, '[data-testid=checkin-mood]'), /Not given/)
  assert.equal(await j.locator('[data-testid=checkin-fill-form]').count(), 0)
  await done(jamie)

  const miguel2 = await as(PEOPLE.miguel)
  await goto(miguel2.page, checkinPath(id), '[data-testid=ack-panel]')
  await miguel2.page.click('[data-testid=ack-submit]')
  await miguel2.page.waitForFunction(() => /acknowledged/i.test(document.querySelector('[data-testid=checkin-banner]')?.textContent || ''))
  assert.match(await text(miguel2.page, '[data-testid=checkin-no-feedback]'), /No written feedback/)
  await done(miguel2)
})

// ------------------------------------------------------------------------------------------------ HR
test('E2E HR: overview shows counts only; mood is hidden from HR by default and appears only when the API returns it; oversight is read-only', opts, async () => {
  const anna = await as(PEOPLE.anna)
  const a = anna.page
  await perf(a, '?tab=overview')
  await a.waitForSelector('[data-testid=hr-overview]')
  await a.waitForSelector('[data-testid=overview-period-card]')
  assert.equal(await a.locator('[data-testid^=tab-]').count(), 5, 'HR has five tabs (the new Probation Evaluation tab sits right after HR overview)')
  const page = await text(a, '[data-testid=hr-overview]')
  assert.match(page, /Counts only/)
  assert.match(page, /currently off|it is currently off/)
  for (const name of ['Jamie', 'Miguel', 'Lia', 'Dela Cruz', 'handbook', 'outline', 'style guide', 'Closed three support tickets']) assert.ok(!page.includes(name), `the overview must not show "${name}"`)
  const card = a.locator('[data-testid=overview-period-card][data-period="2027-Q1"]')
  assert.equal(await card.locator('[data-testid=period-acknowledged]').innerText(), '1')
  assert.equal(await card.locator('[data-testid=period-total]').innerText(), '1')
  assert.match(await card.locator('[data-testid=period-pct]').innerText(), /100% complete/)
  assert.match(await card.innerText(), /Operations/)
  // the goals block counts statuses
  assert.match(await text(a, '[data-testid=overview-goals]'), /Goals \(\d+\)/)
  // filters narrow server-side
  await a.fill('[data-testid=overview-period]', 'week  3 (e2e)')
  await a.waitForFunction(() => document.querySelectorAll('[data-testid=overview-period-card]').length === 1 && document.querySelector('[data-testid=overview-period-card]').dataset.period === 'Week 3 (E2E)')
  await a.fill('[data-testid=overview-period]', 'No such period')
  await a.waitForSelector('[data-testid=overview-periods], [data-testid=empty-state]')
  await a.waitForSelector('[data-testid=hr-overview] [data-testid=empty-state]')
  await a.fill('[data-testid=overview-period]', '')
  await a.waitForSelector('[data-testid=overview-period-card]')

  // HR oversight (read-only): Team tab offers "Everyone (read-only)" only
  await perf(a, '?tab=team&view=checkins')
  await a.waitForSelector('[data-testid=checkin-row]')
  assert.match(await text(a, '[data-testid=team-readonly-note]'), /read-only/)
  assert.equal(await a.locator('[data-testid=request-checkin]').count(), 0, 'HR cannot request check-ins')
  const ackRow = a.locator('[data-testid=checkin-row]', { hasText: '2027-Q1' })
  await ackRow.click()
  await a.waitForSelector('[data-testid=checkin-detail]')
  const id = idFromUrl(a)
  assert.match(await text(a, '[data-testid=checkin-mood]'), /Not shared with you/)
  const hidden = (await pageApi(a, origin, 'GET', `/performance/checkins/${id}`)).json
  assert.equal(hidden.mood, null)
  assert.equal(hidden.mood_visible, false)
  assert.equal(await a.locator('[data-testid=ack-panel]').count(), 0, 'HR only acknowledges when the owner has no reachable manager')
  assert.match(await text(a, '[data-testid=checkin-readonly]'), /nothing for you to do/)

  // HR goals are read-only, no comment form
  await perf(a, '?tab=team&view=goals')
  await a.waitForSelector('[data-testid=goal-row]')
  await a.locator('[data-testid=goal-row]').first().click()
  await a.waitForSelector('[data-testid=goal-detail]')
  assert.equal(await a.locator('[data-testid=goal-readonly]').count(), 1)
  assert.equal(await a.locator('[data-testid=comment-form]').count(), 0)

  // flip the Settings switch through the API (HR only): now the API returns the mood, and the UI shows exactly that
  const on = await pageApi(a, origin, 'PUT', '/settings', { hr_can_see_mood: true })
  assert.equal(on.status, 200, JSON.stringify(on.json))
  await goto(a, checkinPath(id), '[data-testid=checkin-detail]')
  assert.match(await text(a, '[data-testid=checkin-mood]'), /4 of 5 \(Good\)/)
  await perf(a, '?tab=overview')
  await a.waitForSelector('[data-testid=overview-note]')
  assert.match(await text(a, '[data-testid=overview-note]'), /currently visible to HR/)
  assert.ok(!(await text(a, '[data-testid=hr-overview]')).match(/4 of 5|mood: 4/i), 'the overview never carries mood values')
  const off = await pageApi(a, origin, 'PUT', '/settings', { hr_can_see_mood: false })
  assert.equal(off.status, 200)
  await goto(a, checkinPath(id), '[data-testid=checkin-detail]')
  assert.match(await text(a, '[data-testid=checkin-mood]'), /Not shared with you/)
  await done(anna)

  // others cannot read the overview
  const paolo = await as(PEOPLE.paolo)
  assert.equal((await pageApi(paolo.page, origin, 'GET', '/performance/overview')).status, 403)
  await perf(paolo.page, '?tab=overview')
  await paolo.page.waitForSelector('[data-testid=performance-page][data-tab=goals]')
  await done(paolo)
})

test('E2E deep links: unknown and malformed ids give an honest not-found state; the list pages recover from a reload', opts, async () => {
  const jamie = await as(PEOPLE.jamie)
  const j = jamie.page
  for (const [path, sel] of [
    ['/performance/goals/00000000-0000-4000-8000-000000000000', '[data-testid=goal-detail-error]'],
    ['/performance/goals/not-an-id', '[data-testid=goal-detail-error]'],
    ['/performance/checkins/00000000-0000-4000-8000-000000000000', '[data-testid=checkin-detail-error]'],
  ]) {
    await goto(j, path, sel)
    assert.match(await text(j, `${sel} [data-testid=empty-state]`), /not found/i)
    assert.ok((await j.locator(`${sel} a[href^="/performance"]`).count()) >= 1, 'a way back is offered')
  }
  await perf(j, '?tab=checkins')
  await j.reload()
  await j.waitForSelector('[data-testid=my-checkins]')
  assert.equal(new URL(j.url()).search, '?tab=checkins', 'the tab is URL-synced')
  await j.click('[data-testid=tab-goals]')
  await j.waitForSelector('[data-testid=my-goals]')
  assert.equal(new URL(j.url()).search, '')
  await j.goBack()
  await j.waitForSelector('[data-testid=my-checkins]')
  await done(jamie)
})

test('E2E check-in with no manager: HR is the fallback reviewer; with a single HR admin nobody can acknowledge it', opts, async () => {
  // Anna reports to the COO, who has no account, so her check-ins have no reachable manager.
  const c = await apiCheckin(PEOPLE.anna, '2027-Q2', { accomplishments: 'HR housekeeping.' })
  assert.deepEqual(c.reviewer, { kind: 'hr', employee_id: null, name: null })
  const anna = await as(PEOPLE.anna)
  await goto(anna.page, checkinPath(c.checkin_id), '[data-testid=checkin-detail]')
  assert.match(await text(anna.page, '[data-testid=checkin-reviewer]'), /HR \(no manager is set up/)
  assert.equal(await anna.page.locator('[data-testid=ack-panel]').count(), 0, 'HR never acknowledges their own check-in')
  assert.match(await text(anna.page, '[data-testid=checkin-mood]'), /Not given/, 'the owner always sees their own mood field')
  await done(anna)
})
