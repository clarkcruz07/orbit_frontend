// Screenshots for Performance & Check-ins and Learning & Development (real backend run, fictional demo people).
//   node tests/browser/performance-learning-screenshots.mjs        (run from frontend/, after `npm run build`)
// Writes docs/screenshots/performance-*.png and learning-*.png at desktop 1448, tablet 768 and mobile 390.
// Tall pages are captured by stretching the viewport to the document height (the sidebar is fixed and the top bar sticky).
import fs from 'node:fs'
import path from 'node:path'
import { launchBrowser } from './browser-env.mjs'
import { PEOPLE, repoRoot, startRealStack } from './real-backend.mjs'
import { actor, apiCall, apiLogin } from './e2e-helpers.mjs'

const outDir = path.join(repoRoot, 'docs', 'screenshots')
const SIZES = [
  ['desktop-1448', 1448, 1000],
  ['tablet-768', 768, 1024],
  ['mobile-390', 390, 844],
]
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

const stack = await startRealStack()
const browser = await launchBrowser()
const o = stack.origin
const written = []
try {
  const tok = Object.fromEntries(await Promise.all(Object.entries(PEOPLE).map(async ([k, v]) => [k, await apiLogin(o, v)])))
  const call = (who, method, p, body) => apiCall(o, tok[who], method, p, body)

  // ---- Performance data
  const g1 = (await call('jamie', 'POST', '/performance/goals', { title: 'Finish the onboarding handbook', description: 'Write and review the fictional onboarding handbook with Operations.', due_date: inDays(60) })).json
  await call('jamie', 'PATCH', `/performance/goals/${g1.goal_id}`, { progress: 60, version: 1 })
  const g2 = (await call('jamie', 'POST', '/performance/goals', { title: 'Shadow two client calls', description: 'Fictional goal.', due_date: inDays(20) })).json
  await call('jamie', 'POST', '/performance/goals', { title: 'Complete the safety refresher', description: '' })
  const g4 = (await call('jamie', 'POST', '/performance/goals', { title: 'Tidy the shared drive', description: 'Done last month.' })).json
  await call('jamie', 'PATCH', `/performance/goals/${g4.goal_id}`, { status: 'done', version: 1 })
  await call('miguel', 'POST', `/performance/goals/${g1.goal_id}/comments`, { text: 'Good progress. Let us review chapter three together on Friday.' })
  await call('miguel', 'POST', `/performance/goals/${g2.goal_id}/comments`, { text: 'Pick the calls on Monday.' })
  const c1 = (await call('jamie', 'POST', '/performance/checkins', { period_label: '2027-Q1', accomplishments: 'Wrote the handbook outline.', blockers: 'Waiting on the style guide.', next_steps: 'Draft chapters one to three.', mood: 4 })).json
  await call('miguel', 'POST', `/performance/checkins/${c1.checkin_id}/acknowledge`, { feedback: 'Thanks, the outline looks solid.' })
  await call('miguel', 'POST', '/performance/checkins/request', { employee_id: 'EMP-0005', period_label: '2027-Q2' })
  await call('paolo', 'POST', '/performance/checkins', { period_label: '2027-Q2', accomplishments: 'Closed the month-end checklist (fictional).', mood: 3 })
  await call('jamie', 'POST', '/performance/checkins', { period_label: 'Week 3', accomplishments: 'Closed three support tickets.', next_steps: 'Start the handbook review.' })

  // ---- Learning data
  const courses = (await call('jamie', 'GET', '/learning/courses?page_size=50')).json.items
  const cid = (t) => courses.find((c) => c.title === t).course_id
  await call('jamie', 'POST', '/learning/enrolments', { course_id: cid('Effective Communication Skills') })
  const wh = (await call('miguel', 'POST', '/learning/assignments', { course_id: cid('Workplace Health and Safety Basics'), employee_id: 'EMP-0005', due_date: inDays(3) })).json
  await call('jamie', 'PATCH', `/learning/enrolments/${wh.enrolment_id}`, { progress: 40, version: 1 })
  const dp = (await call('miguel', 'POST', '/learning/assignments', { course_id: cid('Data Privacy Essentials'), employee_id: 'EMP-0005', due_date: inDays(30) })).json
  await call('jamie', 'POST', `/learning/enrolments/${dp.enrolment_id}/complete`, { completion_note: 'Read the slides and passed the self-check (fictional).' })
  const cc = (await call('miguel', 'POST', '/learning/assignments', { course_id: cid('Code of Conduct Refresher'), employee_id: 'EMP-0004', due_date: inDays(14) })).json
  await call('paolo', 'POST', `/learning/enrolments/${cc.enrolment_id}/complete`, { completion_note: 'Done.' })
  await call('miguel', 'POST', `/learning/enrolments/${cc.enrolment_id}/confirm`)
  await call('anna', 'POST', '/learning/assignments', { course_id: cid('Leading Your First Team'), employee_id: 'EMP-0008', due_date: inDays(45) })
  await call('carla', 'POST', '/learning/assignments', { course_id: cid('Introduction to Project Planning'), employee_id: 'EMP-0008' })

  const shot = async (page, name, w, h) => {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(500)
    const full = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
    await page.setViewportSize({ width: w, height: Math.min(Math.max(h, full), 2400) })
    await page.waitForTimeout(250)
    const file = path.join(outDir, name)
    await page.screenshot({ path: file })
    written.push(path.basename(file))
  }

  const jobs = (who) => ({
    jamie: PEOPLE.jamie,
    miguel: PEOPLE.miguel,
    anna: PEOPLE.anna,
  })[who]

  const plan = [
    ['jamie', 'performance-goals', '/performance', '[data-testid=goal-row]', null],
    ['jamie', 'performance-goal-detail', `/performance/goals/${g1.goal_id}`, '[data-testid=comment]', null],
    ['jamie', 'performance-checkin-form', '/performance?tab=checkins', '[data-testid=checkin-row]', async (p) => { await p.click('[data-testid=new-checkin]'); await p.fill('[data-testid=checkin-period]', '2027-Q3'); await p.fill('[data-testid=checkin-accomplishments]', 'Finished chapter one of the handbook.'); await p.check('[data-testid=mood-4]') }],
    ['miguel', 'performance-team', '/performance?tab=team', '[data-testid=checkin-row]', null],
    ['anna', 'performance-overview', '/performance?tab=overview', '[data-testid=overview-period-card]', null],
    ['jamie', 'learning-catalog', '/learning', '[data-testid=course-card]', null],
    ['jamie', 'learning-my-learning', '/learning?tab=mine', '[data-testid=enrolment-row]', null],
    ['jamie', 'learning-enrolment', `/learning/enrolments/${wh.enrolment_id}`, '[data-testid=enrolment-detail]', null],
    ['miguel', 'learning-team', '/learning?tab=team', '[data-testid=review-queue] [data-testid=enrolment-row]', null],
    ['anna', 'learning-hr', '/learning?tab=hr', '[data-testid=compliance-course-card]', null],
  ]
  for (const [who, name, route, ready, act] of plan) {
    const a = await actor(browser, o, jobs(who), { width: 1448, height: 1000 })
    try {
      await a.page.goto(`${o}${route}`)
      await a.page.waitForSelector(ready)
      if (act) await act(a.page)
      for (const [suffix, w, h] of SIZES) await shot(a.page, `${name}-${suffix}.png`, w, h)
    } finally {
      await a.close()
    }
  }
  console.log(`wrote ${written.length} screenshots to ${outDir}:\n${written.join('\n')}`)
} finally {
  await browser.close()
  await stack.close()
}
