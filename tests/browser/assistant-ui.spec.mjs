// Bluedge Orbit (floating chat) against the mock API: mascot states, panel behaviour, answers with sources and previews, confirm-before-act leave
// cards, errors, and the HR knowledge-base page. Gated: RUN_BROWSER_TESTS=1.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { dist, enabled, opts, text } from './peoplemgmt-helpers.mjs'
import { U, withAssistant } from './assistant-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const READY = '.app-content'
const PAGE = '/nothing-here' // a plain "page not found" page inside the shell: no data calls of its own
const run = (user, fn, o) => withAssistant(browser, dist, user, fn, o)
const calls = (mock, method, route) => mock.state.calls.filter((c) => c.method === method && c.route === route)
const confirms = (mock) => mock.state.calls.filter((c) => /^\/assistant\/actions\/[^/]+\/confirm$/.test(c.route))
const bgX = (page, sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundPositionX)

async function openChat(page) {
  await page.click('[data-testid=orbit-launcher]')
  await page.waitForSelector('[data-testid=orbit-panel]')
}
async function ask(page, message) {
  const before = await page.locator('[data-testid=orbit-message]').count()
  await page.fill('[data-testid=orbit-input]', message)
  await page.keyboard.press('Enter')
  // the person's bubble plus the reply (or an error bubble)
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=orbit-message]').length >= n && !document.querySelector('[data-testid=orbit-typing]'), before + 2, { timeout: 15000 })
}

test('launcher: closed shows the closed-mouth frame, it is on every signed-in page and not on the sign-in page', opts, async () => {
  await run(U.carla, async ({ page, go, ctx, mock }) => {
    await go(PAGE, READY)
    const launcher = page.locator('[data-testid=orbit-launcher]')
    assert.equal(await launcher.count(), 1)
    assert.equal(await launcher.getAttribute('aria-label'), 'Chat with Bluedge Orbit')
    assert.equal(await launcher.getAttribute('aria-expanded'), 'false')
    assert.equal(await page.locator('[data-testid=orbit-panel]').count(), 0)
    const m = page.locator('[data-testid=orbit-mascot]')
    assert.equal(await m.getAttribute('data-state'), 'closed')
    assert.equal(await m.getAttribute('data-frame'), '0')
    assert.equal(await m.getAttribute('data-talking'), 'false')
    assert.match(await bgX(page, '[data-testid=orbit-mascot]'), /^0(px|%)$/)
    const box = await launcher.boundingBox()
    assert.ok(box.width >= 44 && box.height >= 44)
    assert.equal(calls(mock, 'GET', '/assistant/config').length, 0, 'nothing is requested until the chat is opened')
    // another page of the app has it too
    await page.goto(`${mock.origin}/directory`)
    await page.waitForSelector('[data-testid=orbit-launcher]')
    // the sign-in page has none
    const anon = await ctx.browser().newContext()
    const p2 = await anon.newPage()
    await p2.goto(`${mock.origin}/login`)
    await p2.waitForSelector('#email')
    assert.equal(await p2.locator('[data-testid=orbit-launcher]').count(), 0)
    await anon.close()
  })
})

test('opening: panel is a dialog, focus goes to the box, the mouth opens and talks for a burst, then rests open', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    const panel = page.locator('[data-testid=orbit-panel]')
    assert.equal(await panel.getAttribute('role'), 'dialog')
    assert.equal(await panel.getAttribute('aria-label'), 'Chat with Bluedge Orbit')
    assert.equal(await page.locator('[data-testid=orbit-launcher]').getAttribute('aria-expanded'), 'true')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'orbit-input')
    const m = page.locator('[data-testid=orbit-mascot]')
    assert.equal(await m.getAttribute('data-state'), 'open')
    assert.equal(await m.getAttribute('data-frame'), '1')
    assert.equal(await m.getAttribute('data-talking'), 'true')
    assert.match(await m.getAttribute('class'), /orbit-talking/)
    assert.equal(await page.locator('[data-testid=orbit-mascot-header]').getAttribute('data-talking'), 'true')
    await page.waitForTimeout(1200)
    assert.equal(await m.getAttribute('data-talking'), 'true', 'still talking inside the burst')
    await page.waitForFunction(() => document.querySelector('[data-testid=orbit-mascot]')?.getAttribute('data-talking') === 'false', null, { timeout: 5000 })
    assert.doesNotMatch(await m.getAttribute('class'), /orbit-talking/)
    assert.equal(await m.getAttribute('data-frame'), '1')
    assert.equal(await bgX(page, '[data-testid=orbit-mascot]'), '100%', 'rests on the open-mouth frame')
    assert.match(await text(page, '[data-testid=orbit-greeting]'), /Bluedge Orbit/)
    assert.equal(await page.locator('[data-testid=orbit-suggestion]').count(), 2)
    assert.equal(calls(mock, 'GET', '/assistant/config').length, 1)
  })
})

test('reduced motion: the mouth opens but never flaps', opts, async () => {
  await run(
    U.carla,
    async ({ page, go }) => {
      await go(PAGE, READY)
      await openChat(page)
      const m = page.locator('[data-testid=orbit-mascot]')
      assert.equal(await m.getAttribute('data-frame'), '1')
      assert.equal(await m.getAttribute('data-talking'), 'false')
      await ask(page, 'How many vacation days do I get?')
      assert.equal(await m.getAttribute('data-talking'), 'false')
    },
    { reducedMotion: 'reduce' },
  )
})

test('Escape and the close button close the chat, focus returns to the launcher and the mouth closes again', opts, async () => {
  await run(U.carla, async ({ page, go }) => {
    await go(PAGE, READY)
    await openChat(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-testid=orbit-panel]'))
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'orbit-launcher')
    assert.equal(await page.locator('[data-testid=orbit-mascot]').getAttribute('data-frame'), '0')
    assert.match(await bgX(page, '[data-testid=orbit-mascot]'), /^0(px|%)$/)
    assert.equal(await page.locator('[data-testid=orbit-launcher]').getAttribute('aria-expanded'), 'false')
    await openChat(page)
    await page.click('[data-testid=orbit-close]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=orbit-panel]'))
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'orbit-launcher')
    // the launcher toggles too
    await openChat(page)
    await page.click('[data-testid=orbit-launcher]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=orbit-panel]'))
  })
})

test('composer: Enter sends, Shift+Enter makes a new line, the box is limited to 2000 characters and shows a counter near it', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    const input = page.locator('[data-testid=orbit-input]')
    assert.equal(await page.locator('[data-testid=orbit-send]').isDisabled(), true, 'nothing to send yet')
    await input.fill('line one')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('line two')
    assert.equal(await input.inputValue(), 'line one\nline two')
    assert.equal(calls(mock, 'POST', '/assistant/chat').length, 0)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=orbit-message]').length >= 2)
    assert.equal(calls(mock, 'POST', '/assistant/chat').length, 1)
    assert.equal(calls(mock, 'POST', '/assistant/chat')[0].body.messages.at(-1).content, 'line one\nline two')
    assert.equal(await input.inputValue(), '')
    await input.evaluate((el) => {
      el.removeAttribute('maxlength')
    })
    assert.equal(await page.locator('[data-testid=orbit-count]').count(), 0)
    await input.fill('x'.repeat(1900))
    assert.match(await text(page, '[data-testid=orbit-count]'), /1900\/2000/)
    await input.fill('y'.repeat(2400))
    await page.click('[data-testid=orbit-send]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=orbit-message]').length >= 4)
    const sent = calls(mock, 'POST', '/assistant/chat').at(-1).body.messages.at(-1).content
    assert.equal(sent.length, 2000, 'the app never sends more than the server accepts')
  })
})

test('suggestion chips send a question; the thread keeps the person and the answer', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    await page.locator('[data-testid=orbit-suggestion]').first().click()
    await page.waitForSelector('[data-testid=source-chip]')
    assert.equal(await page.locator('[data-testid=orbit-suggestions]').count(), 0, 'chips go away once the conversation starts')
    const bubbles = await page.locator('[data-testid=orbit-message]').evaluateAll((els) => els.map((e) => e.getAttribute('data-role')))
    assert.deepEqual(bubbles, ['user', 'assistant'])
    assert.deepEqual(calls(mock, 'POST', '/assistant/chat')[0].body.messages, [{ role: 'user', content: 'How many vacation days do I get?' }])
    // the answer is plain text with bold and a list, built from elements (never HTML)
    assert.match(await text(page, '[data-testid=orbit-message][data-role=assistant] strong'), /15 vacation days/)
    assert.equal(await page.locator('[data-testid=orbit-message][data-role=assistant] li').count(), 2)
  })
})

test('answers: markup in a reply is shown as text, sources open an in-app preview (policy PDF, text, Knowledge Base file and text, no-preview file) and the file address is released on close', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    mock.state.chatQueue.push({
      status: 200,
      body: {
        reply: 'See <img src=x onerror="window.__pwned=1"> **below**.',
        sources: [
          { kind: 'policy', id: 'pol-leave', title: 'Leave Policy', version: 3, snippet: 'Full-time staff get 15 vacation days per year.' },
          { kind: 'policy', id: 'pol-conduct', title: 'Code of Conduct', version: null, snippet: '' },
          { kind: 'policy', id: 'pol-word', title: 'Travel Policy', version: 2, snippet: '' },
          { kind: 'policy', id: 'pol-gone', title: 'Old Policy', version: 1, snippet: '' },
          { kind: 'kb', id: 'kb-seed-text', title: 'Booking time off', version: null, snippet: 'Tell your manager early, then file the request in the app.', has_file: false },
          { kind: 'kb', id: 'kb-seed-file', title: 'Remote work guide', version: null, snippet: 'Staff may work remotely two days a week.', has_file: true },
          { kind: 'kb', id: 'kb-seed-docx', title: 'Onboarding checklist', version: null, snippet: '', has_file: true },
          { kind: 'article', id: 'art-old', title: 'Older article', version: null, snippet: 'An older server still says article.' },
        ],
        action: null,
      },
    })
    await page.addInitScript(() => {
      window.__revoked = []
      const orig = URL.revokeObjectURL.bind(URL)
      URL.revokeObjectURL = (u) => {
        window.__revoked.push(u)
        return orig(u)
      }
    })
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'Tell me everything')
    assert.equal(await page.evaluate(() => window.__pwned ?? null), null, 'markup in a reply never runs')
    assert.match(await text(page, '[data-testid=orbit-message][data-role=assistant]'), /<img src=x onerror=/)
    assert.equal(await page.locator('[data-testid=orbit-message] img').count(), 0)
    const chips = page.locator('[data-testid=source-chip]')
    assert.equal(await chips.count(), 8)
    assert.deepEqual(await chips.locator('.or-chip-text').allInnerTexts(), ['Leave Policy v3', 'Code of Conduct', 'Travel Policy v2', 'Old Policy v1', 'Booking time off', 'Remote work guide', 'Onboarding checklist', 'Older article'])
    // Knowledge Base chips read differently from policy chips (book icon, own style, named in the accessible label)
    assert.deepEqual(await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind'))), ['policy', 'policy', 'policy', 'policy', 'kb', 'kb', 'kb', 'kb'])
    assert.equal(await chips.nth(0).evaluate((e) => e.classList.contains('or-chip-kb')), false)
    assert.equal(await chips.nth(4).evaluate((e) => e.classList.contains('or-chip-kb')), true)
    assert.match(await chips.nth(4).getAttribute('aria-label'), /\(Knowledge Base\)/)

    // PDF: the right (versioned) file is requested with the signed-in client and shown in a frame
    await chips.nth(0).click()
    await page.waitForSelector('[data-testid=preview-frame]')
    assert.equal(calls(mock, 'GET', '/documents/policies/pol-leave/versions/3/file').length, 1)
    assert.match(await text(page, '[data-testid=source-preview] h2'), /Leave Policy v3/)
    assert.match(await text(page, '[data-testid=preview-snippet]'), /15 vacation days/)
    const dl = page.locator('[data-testid=preview-download]')
    assert.equal(await dl.getAttribute('download'), 'leave-policy.pdf')
    assert.match(await dl.getAttribute('href'), /^blob:/)
    await page.click('[data-testid=preview-close]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=source-preview]'))
    assert.ok((await page.evaluate(() => window.__revoked.length)) >= 1, 'the temporary file address is revoked on close')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'source-chip', 'focus returns to the chip')
    assert.equal(await page.locator('[data-testid=orbit-panel]').count(), 1, 'the chat stays open behind the preview')

    // current version of a text file: shown as text; Escape closes only the preview
    await chips.nth(1).click()
    await page.waitForSelector('[data-testid=preview-text]')
    assert.equal(calls(mock, 'GET', '/documents/policies/pol-conduct/file').length, 1)
    assert.match(await text(page, '[data-testid=preview-text]'), /Be kind/)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-testid=source-preview]'))
    assert.equal(await page.locator('[data-testid=orbit-panel]').count(), 1, 'Escape closed the preview first, not the chat')

    // a file that cannot be previewed still offers a download
    await chips.nth(2).click()
    await page.waitForSelector('[data-testid=preview-none]')
    assert.match(await text(page, '[data-testid=preview-none]'), /cannot be previewed/)
    assert.equal(await page.locator('[data-testid=preview-download]').count(), 1)
    await page.click('[data-testid=preview-close]')

    // a document the person cannot open (or that is gone) says so
    await chips.nth(3).click()
    await page.waitForSelector('[data-testid=preview-error]')
    assert.match(await text(page, '[data-testid=preview-error]'), /cannot open this document|no longer available/)
    assert.equal(await page.locator('[data-testid=preview-download]').count(), 0)
    await page.click('[data-testid=preview-close]')

    // a Knowledge Base text item shows its text and requests no file
    const filesBefore = mock.state.log.filter((l) => /\/file$/.test(l)).length
    await chips.nth(4).click()
    await page.waitForSelector('[data-testid=preview-article]')
    assert.match(await text(page, '[data-testid=preview-article]'), /Tell your manager early/)
    assert.equal(mock.state.log.filter((l) => /\/file$/.test(l)).length, filesBefore)
    await page.click('[data-testid=preview-close]')

    // a Knowledge Base FILE opens inline from /assistant/kb/items/{id}/file, fetched with the signed-in client
    await chips.nth(5).click()
    await page.waitForSelector('[data-testid=preview-frame]')
    assert.equal(calls(mock, 'GET', '/assistant/kb/items/kb-seed-file/file').length, 1)
    assert.match(await text(page, '[data-testid=source-preview] h2'), /Remote work guide/)
    assert.equal(await page.locator('[data-testid=preview-download]').getAttribute('download'), 'remote-work-guide.pdf')
    await page.click('[data-testid=preview-close]')

    // a Knowledge Base Word file cannot be previewed but can be downloaded
    await chips.nth(6).click()
    await page.waitForSelector('[data-testid=preview-none]')
    assert.equal(await page.locator('[data-testid=preview-download]').getAttribute('download'), 'onboarding.docx')
    await page.click('[data-testid=preview-close]')

    // the older kind "article" is read as a Knowledge Base text item without a file
    const before = mock.state.log.filter((l) => /\/file$/.test(l)).length
    await chips.nth(7).click()
    await page.waitForSelector('[data-testid=preview-article]')
    assert.match(await text(page, '[data-testid=preview-article]'), /older server still says article/)
    assert.equal(mock.state.log.filter((l) => /\/file$/.test(l)).length, before)
    await page.click('[data-testid=preview-close]')
  })
})

test('history: only the last 12 turns go to the server, and the conversation starts with the person', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    for (let i = 1; i <= 8; i += 1) await ask(page, `question number ${i}`)
    const last = calls(mock, 'POST', '/assistant/chat').at(-1).body.messages
    // 15 turns are on the screen when question 8 is sent; the last 12 would begin with an answer, which is dropped so it starts with the person
    assert.equal(last.length, 11)
    assert.equal(last[0].role, 'user')
    assert.equal(last.at(-1).content, 'question number 8')
    assert.ok(last.every((m) => m.role === 'user' || m.role === 'assistant'))
    assert.equal(await page.locator('[data-testid=orbit-message]').count(), 16, 'the screen still shows the whole conversation')
  })
})

test('leave: the reply carries a card, nothing is sent until Submit, and Submit goes exactly once (even on a double click)', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    mock.state.delay['POST /assistant/actions/act-1/confirm'] = 300
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'Please file a leave request for 21 to 24 December')
    const card = page.locator('[data-testid=action-card]')
    await card.waitFor()
    assert.equal(await card.getAttribute('data-kind'), 'file_leave')
    assert.equal(await text(page, '[data-testid=card-type]'), 'Vacation')
    assert.equal(await text(page, '[data-testid=card-dates]'), '21 Dec 2026 to 24 Dec 2026')
    assert.equal(await text(page, '[data-testid=card-days]'), '4 days')
    assert.equal(await text(page, '[data-testid=card-balance]'), '5 days left')
    assert.equal(await text(page, '[data-testid=card-reason]'), 'Family trip')
    await page.waitForTimeout(400)
    assert.equal(confirms(mock).length, 0, 'asking never submits anything')
    await page.dblclick('[data-testid=action-confirm]')
    await page.waitForSelector('[data-testid=action-status][data-phase=done]')
    assert.equal(confirms(mock).length, 1, 'exactly one submit')
    assert.match(await text(page, '[data-testid=action-status]'), /submitted for approval/)
    assert.equal(await page.locator('[data-testid=action-confirm]').isDisabled(), true)
    assert.equal(await page.locator('[data-testid=action-cancel]').isDisabled(), true)
    assert.equal(await page.locator('[data-testid=orbit-link]').getAttribute('href'), '/leave')
    assert.match(await text(page, '[data-testid=orbit-message][data-kind=notice]'), /submitted for approval/)
    assert.equal(calls(mock, 'POST', '/assistant/actions/act-1/cancel').length, 0)
    // a second look at the same card changes nothing
    await page.waitForTimeout(300)
    assert.equal(confirms(mock).length, 1)
  })
})

test('leave: Cancel withdraws the card and nothing is ever confirmed', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'File a leave request')
    await page.click('[data-testid=action-cancel]')
    await page.waitForSelector('[data-testid=action-status][data-phase=cancelled]')
    assert.match(await text(page, '[data-testid=action-status]'), /Nothing was submitted/)
    assert.equal(await page.locator('[data-testid=action-confirm]').isDisabled(), true)
    assert.equal(confirms(mock).length, 0)
    assert.equal(calls(mock, 'POST', '/assistant/actions/act-1/cancel').length, 1)
  })
})

test('leave: a refusal from the leave service closes the card with its reason; a server hiccup keeps it usable', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'File a leave request')
    mock.state.confirmQueue.push({ status: 500, body: { detail: 'boom' } })
    await page.click('[data-testid=action-confirm]')
    await page.waitForSelector('[data-testid=action-warning]')
    assert.match(await text(page, '[data-testid=action-warning]'), /wrong on our side|try again/i)
    assert.equal(await page.locator('[data-testid=action-confirm]').isDisabled(), false, 'a hiccup does not use up the card')
    mock.state.confirmQueue.push({ status: 409, body: { detail: 'You do not have enough leave left for those dates.' } })
    await page.click('[data-testid=action-confirm]')
    await page.waitForSelector('[data-testid=action-status][data-phase=failed]')
    assert.equal(await text(page, '[data-testid=action-status]'), 'You do not have enough leave left for those dates.')
    assert.equal(await page.locator('[data-testid=action-confirm]').isDisabled(), true)
    assert.equal(confirms(mock).length, 2)
  })
})

const generatedFileCalls = (mock) => calls(mock, 'GET', '/assistant/files/file-1')
const withSpies = (page) =>
  page.addInitScript(() => {
    window.__revoked = []
    const orig = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (u) => {
      window.__revoked.push(u)
      return orig(u)
    }
  })

test('COE: the card shows the four details read-only, Generate PDF goes once, then the bubble offers Download (right file name) and Preview', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    mock.state.delay['POST /assistant/actions/act-1/confirm'] = 300
    await withSpies(page)
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'Please generate my COE for visa application')
    const card = page.locator('[data-testid=action-card]')
    await card.waitFor()
    assert.equal(await card.getAttribute('data-kind'), 'generate_coe')
    assert.deepEqual(await card.locator('dt').allInnerTexts(), ['Name', 'Position', 'Employed since', 'Reason'])
    assert.equal(await text(page, '[data-testid=coe-name]'), 'Carla Dizon')
    assert.equal(await text(page, '[data-testid=coe-position]'), 'Compliance Analyst')
    assert.equal(await text(page, '[data-testid=coe-since]'), '1 Mar 2021')
    assert.equal(await text(page, '[data-testid=coe-reason]'), 'visa application')
    assert.equal(await text(page, '[data-testid=coe-issue-date]'), 'Issue date: 16 Nov 2026')
    assert.match(await card.innerText(), /Details come from your employee record\. The certificate is a draft until HR \/ the Managing Director signs it\./)
    assert.equal(await card.locator('input, textarea').count(), 0, 'the details are read-only')
    assert.equal((await text(page, '[data-testid=action-confirm]')).trim(), 'Generate PDF')
    assert.equal((await text(page, '[data-testid=action-cancel]')).trim(), 'Cancel')
    await page.waitForTimeout(400)
    assert.equal(confirms(mock).length, 0, 'asking never generates anything')
    assert.equal(await page.locator('[data-testid=orbit-file]').count(), 0)

    await page.dblclick('[data-testid=action-confirm]')
    await page.waitForSelector('[data-testid=action-status][data-phase=done]')
    assert.equal(confirms(mock).length, 1, 'exactly one confirm, even on a double click')
    assert.match(await text(page, '[data-testid=action-status]'), /Certificate of Employment is ready/)
    assert.equal(await page.locator('[data-testid=action-confirm]').isDisabled(), true)
    assert.equal(await page.locator('[data-testid=action-cancel]').isDisabled(), true)
    const bubble = page.locator('[data-testid=orbit-message][data-kind=notice]')
    assert.match(await bubble.innerText(), /Certificate of Employment is ready/)
    assert.match(await text(page, '[data-testid=orbit-file-name]'), /Certificate_of_Employment_Carla_Dizon\.pdf/)
    assert.equal(generatedFileCalls(mock).length, 0, 'the file is only fetched when asked for')

    // Download: through the signed-in client as a blob (the mock answers 401 without the bearer token), saved under the name from the response
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=orbit-file-download]')])
    assert.equal(dl.suggestedFilename(), 'Certificate_of_Employment_Carla_Dizon.pdf')
    assert.equal(generatedFileCalls(mock).length, 1)
    assert.equal(await page.locator('a[href*="assistant/files"]').count(), 0, 'no bare link to the file endpoint')
    await page.waitForFunction(() => window.__revoked.length >= 1, null, { timeout: 5000 })

    // Preview: the same file in the preview window
    await page.click('[data-testid=orbit-file-preview]')
    await page.waitForSelector('[data-testid=preview-frame]')
    assert.match(await text(page, '[data-testid=source-preview] h2'), /Certificate_of_Employment_Carla_Dizon\.pdf/)
    assert.equal(generatedFileCalls(mock).length, 2)
    assert.equal(await page.locator('[data-testid=preview-download]').getAttribute('download'), 'Certificate_of_Employment_Carla_Dizon.pdf')
    await page.click('[data-testid=preview-close]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=source-preview]'))
    assert.ok((await page.evaluate(() => window.__revoked.length)) >= 2, 'the preview releases its file address on close')

    // still there for the session: close and reopen the chat, then download again
    await page.keyboard.press('Escape')
    await openChat(page)
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=orbit-file-download]')])
    assert.equal(dl2.suggestedFilename(), 'Certificate_of_Employment_Carla_Dizon.pdf')
    assert.equal(confirms(mock).length, 1)
  })
})

test('COE: Cancel generates nothing', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'I need a certificate of employment')
    await page.click('[data-testid=action-cancel]')
    await page.waitForSelector('[data-testid=action-status][data-phase=cancelled]')
    assert.equal(confirms(mock).length, 0)
    assert.equal(await page.locator('[data-testid=orbit-file]').count(), 0)
    assert.equal(await page.locator('[data-testid=action-confirm]').isDisabled(), true)
    assert.equal(calls(mock, 'POST', '/assistant/actions/act-1/cancel').length, 1)
  })
})

test('COE: a refusal closes the card with its reason', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'generate my COE')
    mock.state.confirmQueue.push({ status: 409, body: { detail: 'Your employee record has no start date yet. Ask HR to complete it.' } })
    await page.click('[data-testid=action-confirm]')
    await page.waitForSelector('[data-testid=action-status][data-phase=failed]')
    assert.equal(await text(page, '[data-testid=action-status]'), 'Your employee record has no start date yet. Ask HR to complete it.')
    assert.equal(await page.locator('[data-testid=orbit-file]').count(), 0)
  })
})

test('COE download: a hiccup offers Try again; a missing file says to ask Orbit again and switches the buttons off', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'generate my COE')
    await page.click('[data-testid=action-confirm]')
    await page.waitForSelector('[data-testid=orbit-file]')
    // a server hiccup: friendly text and a retry
    mock.state.force['GET /assistant/files/file-1'] = 500
    await page.click('[data-testid=orbit-file-download]')
    await page.waitForSelector('[data-testid=orbit-file-error]')
    assert.match(await text(page, '[data-testid=orbit-file-error]'), /could not be downloaded/)
    assert.equal((await text(page, '[data-testid=orbit-file-download]')).trim(), 'Try again')
    assert.equal(await page.locator('[data-testid=orbit-file-download]').isDisabled(), false)
    delete mock.state.force['GET /assistant/files/file-1']
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=orbit-file-download]')])
    assert.equal(dl.suggestedFilename(), 'Certificate_of_Employment_Carla_Dizon.pdf')
    await page.waitForFunction(() => !document.querySelector('[data-testid=orbit-file-error]'))
    // the file is gone
    mock.state.missingFiles.add('file-1')
    await page.click('[data-testid=orbit-file-download]')
    await page.waitForSelector('[data-testid=orbit-file-error]')
    assert.equal(await text(page, '[data-testid=orbit-file-error]'), 'This file is no longer available. Ask Orbit to generate it again.')
    assert.equal(await page.locator('[data-testid=orbit-file-download]').isDisabled(), true)
    assert.equal(await page.locator('[data-testid=orbit-file-preview]').isDisabled(), true)
  })
})

test('COE preview: a missing file shows the same friendly message inside the preview window', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'generate my COE')
    await page.click('[data-testid=action-confirm]')
    await page.waitForSelector('[data-testid=orbit-file]')
    mock.state.missingFiles.add('file-1')
    await page.click('[data-testid=orbit-file-preview]')
    await page.waitForSelector('[data-testid=preview-error]')
    assert.equal(await text(page, '[data-testid=preview-error]'), 'This file is no longer available. Ask Orbit to generate it again.')
    assert.equal(await page.locator('[data-testid=preview-download]').count(), 0)
    await page.click('[data-testid=preview-close]')
  })
})

test('an action kind this version does not know is shown as a dismissable note and cannot be confirmed', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    mock.state.chatQueue.push({ status: 200, body: { reply: 'I can do that.', sources: [], action: { action_id: 'act-x', kind: 'file_timesheet', summary: {}, expires_at: null } } })
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'do something new')
    assert.equal(await page.locator('[data-testid=action-confirm]').count(), 0)
    assert.match(await text(page, '[data-testid=action-card]'), /cannot show here/)
    await page.click('[data-testid=action-cancel]')
    await page.waitForSelector('[data-testid=action-status]')
    assert.equal(confirms(mock).length, 0)
  })
})

test('errors: the server wording is shown, Retry resends without duplicating the question, not-configured and rate-limit have their own text', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    mock.state.chatQueue.push({ status: 502, body: { detail: 'The AI service could not be reached. Please try again.' } })
    await ask(page, 'How many vacation days do I get?')
    const err = page.locator('[data-testid=orbit-message][data-kind=error]')
    assert.match(await err.innerText(), /The AI service could not be reached/)
    await page.click('[data-testid=orbit-retry]')
    await page.waitForSelector('[data-testid=source-chip]')
    assert.equal(await page.locator('[data-testid=orbit-message][data-kind=error]').count(), 0, 'the error bubble is replaced by the answer')
    assert.equal(await page.locator('[data-testid=orbit-message][data-role=user]').count(), 1, 'the question was not duplicated')
    const sent = calls(mock, 'POST', '/assistant/chat')
    assert.equal(sent.length, 2)
    assert.deepEqual(sent[1].body.messages, sent[0].body.messages)

    mock.state.chatQueue.push({ status: 429, body: { detail: 'Too many requests' }, headers: { 'Retry-After': '17' } })
    await ask(page, 'second')
    assert.match(await page.locator('[data-testid=orbit-message][data-kind=error]').innerText(), /wait 17 seconds/)
    await page.click('[data-testid=orbit-retry]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=orbit-message][data-kind=error]'))

    mock.state.chatQueue.push({ status: 503, body: { detail: 'AI is not configured', code: 'llm_not_configured' } })
    await ask(page, 'third')
    assert.equal((await page.locator('[data-testid=orbit-message][data-kind=error]').innerText()).trim(), "The assistant isn't switched on yet. Ask your administrator.")
    assert.equal(await page.locator('[data-testid=orbit-retry]').count(), 0, 'retrying cannot help here')
    // the error is local: it is never sent back as part of the conversation
    mock.state.chatQueue.length = 0
    await ask(page, 'fourth')
    const last = calls(mock, 'POST', '/assistant/chat').at(-1).body.messages
    assert.ok(last.every((m) => !/switched on yet|wait 17 seconds|could not be reached/.test(m.content)))
  })
})

test('when the assistant is switched off the panel says so and the box is disabled', opts, async () => {
  await run(
    U.carla,
    async ({ page, go }) => {
      await go(PAGE, READY)
      await openChat(page)
      await page.waitForSelector('[data-testid=orbit-disabled]')
      assert.match(await text(page, '[data-testid=orbit-disabled]'), /switched on yet/)
      assert.equal(await page.locator('[data-testid=orbit-input]').isDisabled(), true)
      assert.equal(await page.locator('[data-testid=orbit-suggestion]').count(), 0)
    },
    { setup: (m) => (m.state.config.enabled = false) },
  )
})

test('the conversation lives in memory only: closing and reopening keeps it, a reload starts fresh', opts, async () => {
  await run(U.carla, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await openChat(page)
    await ask(page, 'How many vacation days do I get?')
    await page.keyboard.press('Escape')
    await openChat(page)
    assert.equal(await page.locator('[data-testid=orbit-message]').count(), 2)
    assert.equal(calls(mock, 'GET', '/assistant/config').length, 1, 'settings are loaded once')
    const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }))
    assert.doesNotMatch(stored, /vacation days/i)
    await page.reload()
    await page.waitForSelector(READY)
    await openChat(page)
    assert.equal(await page.locator('[data-testid=orbit-message]').count(), 0)
  })
})
