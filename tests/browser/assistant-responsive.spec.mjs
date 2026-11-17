// Responsive sweep for Bluedge Orbit at 1440, 1024, 768, 390 and 320 px against the mock API. Per state and width: the shared page audit
// (no sideways scroll, nothing wider than the viewport, no text under 11px, no text spilling out of buttons) plus Orbit's own rules:
// the launcher is at least 44px and inside the viewport, the panel is inside the viewport (full screen on phones), and at <= 768px every
// control in the chat is at least 44px tall. Long unbroken words and long source titles must wrap or be cut, never push the page wider.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { AUDIT, HEIGHT, WIDTHS, dist, enabled, opts } from './peoplemgmt-helpers.mjs'
import { PDF_BYTES, U, startAssistantMock } from './assistant-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const LONG_WORD = 'Supercalifragilisticexpialidocious'.repeat(8)
const LONG_TITLE = 'The Complete Employee Handbook On Leave, Absences And Extraordinarily Long Policy Names (2026 Edition)'

async function openChat(page) {
  await page.click('[data-testid=orbit-launcher]')
  await page.waitForSelector('[data-testid=orbit-panel]')
}
async function ask(page, message) {
  const before = await page.locator('[data-testid=orbit-message]').count()
  await page.fill('[data-testid=orbit-input]', message)
  await page.keyboard.press('Enter')
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=orbit-message]').length >= n && !document.querySelector('[data-testid=orbit-typing]'), before + 2, { timeout: 15000 })
}

/** Orbit's own checks, run in the page. */
const ORBIT_AUDIT = ({ narrow, panelOpen, kb, modalId }) => {
  const problems = []
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const inside = (r) => r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5
  const launcher = document.querySelector('[data-testid=orbit-launcher]')
  if (!launcher) problems.push('launcher missing')
  else {
    const r = launcher.getBoundingClientRect()
    if (r.width < 44 || r.height < 44) problems.push(`launcher smaller than 44px: ${r.width}x${r.height}`)
    if (!inside(r)) problems.push(`launcher outside the viewport: ${JSON.stringify(r)}`)
  }
  if (kb) {
    const modal = modalId ? document.querySelector(`[data-testid=${modalId}]`) : null
    const root = modal ?? document.querySelector('.app-content')
    if (modal) {
      const r = modal.getBoundingClientRect()
      if (!inside(r)) problems.push(`dialog outside the viewport: ${JSON.stringify(r)}`)
    }
    if (narrow) {
      const sel = '.btn, .or-switch, .or-md-tool, .or-md-tab, .pm-input, .or-md-toolbar button'
      for (const el of root.querySelectorAll(sel)) {
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
        if (el.closest('.sr-only')) continue
        if (b.height < 43.5) problems.push(`Knowledge Base control shorter than 44px: <${el.tagName.toLowerCase()} ${el.dataset.testid ?? el.className}> ${Math.round(b.height * 10) / 10}px`)
        if (b.right > vw + 1 || b.left < -1) problems.push(`Knowledge Base control outside the viewport: <${el.tagName.toLowerCase()} ${el.dataset.testid ?? el.className}>`)
      }
    }
  }
  if (panelOpen) {
    const panel = document.querySelector('[data-testid=orbit-panel]')
    const r = panel.getBoundingClientRect()
    if (!inside(r)) problems.push(`panel outside the viewport: left=${r.left} top=${r.top} right=${r.right} bottom=${r.bottom} vw=${vw} vh=${vh}`)
    if (vw <= 640 && (Math.abs(r.width - vw) > 1 || Math.abs(r.height - vh) > 1)) problems.push(`panel is not full screen on a phone: ${r.width}x${r.height} in ${vw}x${vh}`)
    const list = document.querySelector('[data-testid=orbit-messages]')
    if (list.scrollWidth > list.clientWidth + 1) problems.push(`messages scroll sideways: ${list.scrollWidth} > ${list.clientWidth}`)
    for (const el of panel.querySelectorAll('*')) {
      if (el.closest('svg')) continue
      const b = el.getBoundingClientRect()
      if (b.width > 0 && b.right > panel.getBoundingClientRect().right + 1) problems.push(`inside the panel but wider than it: <${el.tagName.toLowerCase()} class=${el.className}>`)
    }
    if (narrow) {
      for (const el of panel.querySelectorAll('button, textarea')) {
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0) continue
        if (b.height < 43.5) problems.push(`panel control shorter than 44px: <${el.tagName.toLowerCase()} ${el.dataset.testid ?? el.className}> ${Math.round(b.height * 10) / 10}px`)
      }
    }
  }
  return problems
}

/** A realistic list: a long-titled PDF, a Word file, a file with no readable text, an inactive text item and a long text item. */
function seedKb(m) {
  const base = { updated_at: '2026-11-16T02:00:00Z', updated_by_name: 'Anna Reyes', reason: null, active: true, status: 'indexed' }
  m.state.items.push(
    { ...base, item_id: 'kb-a', kind: 'file', title: LONG_TITLE, body: '', filename: `${'a-very-long-file-name-'.repeat(4)}.pdf`, content_type: 'application/pdf', size: 2_400_000 },
    { ...base, item_id: 'kb-b', kind: 'file', title: 'Onboarding', body: '', filename: 'onboarding.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 18_000 },
    { ...base, item_id: 'kb-c', kind: 'file', title: 'Scanned old policy', body: '', filename: 'scan.pdf', content_type: 'application/pdf', size: 900_000, status: 'unreadable', reason: `No text could be read from this file (it may be a scan). ${LONG_WORD}` },
    { ...base, item_id: 'kb-d', kind: 'text', title: 'Short one', body: 'Short text.', active: false, filename: null, content_type: null, size: null },
    { ...base, item_id: 'kb-e', kind: 'text', title: LONG_WORD, body: `${LONG_WORD} and some more text `.repeat(6), filename: null, content_type: null, size: null, updated_by_name: LONG_WORD },
  )
  m.state.fileBytes.set('kb-a', { mime: 'application/pdf', filename: 'handbook.pdf', bytes: PDF_BYTES })
  m.state.fileBytes.set('kb-b', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'onboarding.docx', bytes: Buffer.from('docx') })
}

const states = [
  { name: 'closed launcher', path: '/nothing-here', ready: '.app-content', as: U.carla },
  {
    name: 'open panel with greeting and suggestions',
    path: '/nothing-here',
    ready: '.app-content',
    as: U.carla,
    act: async (page) => {
      await openChat(page)
      await page.waitForSelector('[data-testid=orbit-suggestion]')
    },
    panel: true,
  },
  {
    name: 'answer with long words, long sources and a leave card',
    path: '/nothing-here',
    ready: '.app-content',
    as: U.carla,
    setup: (m) => {
      m.state.chatQueue.push({
        status: 200,
        body: {
          reply: `Here is ${LONG_WORD}\n- first point with a long word ${LONG_WORD}\n- second point\n\n**Bold ending**`,
          sources: [
            { kind: 'policy', id: 'pol-leave', title: LONG_TITLE, version: 12, snippet: 'x' },
            { kind: 'article', id: 'art-1', title: LONG_WORD, version: null, snippet: 'y' },
          ],
          action: { action_id: 'act-9', kind: 'file_leave', summary: { leave_type_id: 'lt', leave_type_name: 'Compassionate leave and bereavement', start_date: '2026-12-21', end_date: '2026-12-24', days: 4, balance_after: -1, reason: LONG_WORD }, expires_at: null },
        },
      })
    },
    act: async (page) => {
      await openChat(page)
      await ask(page, `A question with ${LONG_WORD}`)
      await page.waitForSelector('[data-testid=action-card]')
    },
    panel: true,
  },
  {
    name: 'Certificate of Employment card (long reason)',
    path: '/nothing-here',
    ready: '.app-content',
    as: U.carla,
    act: async (page) => {
      await openChat(page)
      await ask(page, `Please generate my COE for ${LONG_WORD}`)
      await page.waitForSelector('[data-testid=action-card][data-kind=generate_coe]')
    },
    panel: true,
  },
  {
    name: 'Certificate of Employment success bubble (Download and Preview)',
    path: '/nothing-here',
    ready: '.app-content',
    as: U.carla,
    act: async (page) => {
      await openChat(page)
      await ask(page, `Please generate my COE for ${LONG_WORD}`)
      await page.click('[data-testid=action-confirm]')
      await page.waitForSelector('[data-testid=orbit-file-download]')
    },
    panel: true,
  },
  {
    name: 'Certificate of Employment download problem',
    path: '/nothing-here',
    ready: '.app-content',
    as: U.carla,
    act: async (page, mock) => {
      await openChat(page)
      await ask(page, 'generate my COE')
      await page.click('[data-testid=action-confirm]')
      await page.waitForSelector('[data-testid=orbit-file-download]')
      mock.state.missingFiles.add('file-1')
      await page.click('[data-testid=orbit-file-download]')
      await page.waitForSelector('[data-testid=orbit-file-error]')
    },
    panel: true,
  },
  {
    name: 'error bubble with retry',
    path: '/nothing-here',
    ready: '.app-content',
    as: U.carla,
    setup: (m) => m.state.chatQueue.push({ status: 502, body: { detail: `The AI service could not be reached. ${LONG_WORD}` } }),
    act: async (page) => {
      await openChat(page)
      await ask(page, 'hello')
      await page.waitForSelector('[data-testid=orbit-retry]')
    },
    panel: true,
  },
  {
    name: 'source preview (PDF)',
    path: '/nothing-here',
    ready: '.app-content',
    as: U.carla,
    act: async (page) => {
      await openChat(page)
      await ask(page, 'How many vacation days do I get?')
      await page.locator('[data-testid=source-chip]').first().click()
      await page.waitForSelector('[data-testid=preview-frame]')
    },
    panel: true,
    modal: true,
  },
  // ---- the Knowledge Base page (HR)
  {
    name: 'Knowledge Base (list with long values, unreadable item, file and text items)',
    path: '/knowledge-base',
    ready: '[data-testid=kb-item]',
    as: U.anna,
    setup: seedKb,
    kb: true,
  },
  {
    name: 'Knowledge Base (empty)',
    path: '/knowledge-base',
    ready: '[data-testid=kb-empty]',
    as: U.anna,
    kb: true,
  },
  {
    name: 'Knowledge Base upload form (error and chosen file)',
    path: '/knowledge-base',
    ready: '[data-testid=kb-item]',
    as: U.anna,
    setup: seedKb,
    kb: true,
    act: async (page) => {
      await page.click('[data-testid=add-upload]')
      await page.setInputFiles('[data-testid=kb-file-input]', { name: 'installer.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') })
      await page.waitForSelector('[data-testid=upload-error]')
      await page.setInputFiles('[data-testid=kb-file-input]', { name: `${'a-very-long-file-name-'.repeat(5)}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
      await page.waitForSelector('[data-testid=upload-file]')
    },
  },
  {
    name: 'Knowledge Base text editor (toolbar, errors)',
    path: '/knowledge-base',
    ready: '[data-testid=kb-item]',
    as: U.anna,
    setup: seedKb,
    kb: true,
    act: async (page) => {
      await page.click('[data-testid=add-text]')
      await page.click('[data-testid=editor-save]')
      await page.waitForSelector('[data-testid=field-title-error]')
      await page.fill('[data-testid=editor-body]', `**${LONG_WORD}**\n- ${LONG_WORD}\n- two`)
    },
  },
  {
    name: 'Knowledge Base text editor (preview tab)',
    path: '/knowledge-base',
    ready: '[data-testid=kb-item]',
    as: U.anna,
    setup: seedKb,
    kb: true,
    act: async (page) => {
      await page.click('[data-testid=add-text]')
      await page.fill('[data-testid=editor-title]', LONG_TITLE)
      await page.fill('[data-testid=editor-body]', `**${LONG_WORD}**\n1. ${LONG_WORD}\n2. two\n\nA closing paragraph.`)
      await page.click('[data-testid=tab-preview]')
      await page.waitForSelector('[data-testid=editor-preview] ol')
    },
  },
  {
    name: 'Knowledge Base discard-changes dialog',
    path: '/knowledge-base',
    ready: '[data-testid=kb-item]',
    as: U.anna,
    setup: seedKb,
    kb: true,
    modalId: 'discard-dialog',
    act: async (page) => {
      await page.click('[data-testid=add-text]')
      await page.fill('[data-testid=editor-title]', 'Unsaved')
      await page.click('[data-testid=editor-cancel]')
      await page.waitForSelector('[data-testid=discard-dialog]')
    },
  },
  {
    name: 'Knowledge Base delete dialog',
    path: '/knowledge-base',
    ready: '[data-testid=kb-item]',
    as: U.anna,
    setup: seedKb,
    kb: true,
    modalId: 'delete-dialog',
    act: async (page) => {
      await page.locator('[data-testid=kb-delete]').first().click()
      await page.waitForSelector('[data-testid=delete-dialog]')
    },
  },
  {
    name: 'Knowledge Base file preview',
    path: '/knowledge-base',
    ready: '[data-testid=kb-item]',
    as: U.anna,
    setup: seedKb,
    kb: true,
    modalId: 'source-preview',
    act: async (page) => {
      await page.locator('[data-testid=kb-preview]').first().click()
      await page.waitForSelector('[data-testid=preview-frame]')
    },
  },
]

for (const width of WIDTHS) {
  test(`Bluedge Orbit responsive @${width}px: launcher, panel, preview and the HR page fit and are tappable`, opts, async () => {
    const problems = []
    for (const s of states) {
      const mock = await startAssistantMock({ distDir: dist })
      s.setup?.(mock)
      const ctx = await browser.newContext({ viewport: { width, height: HEIGHT(width) } })
      await ctx.addInitScript((t) => { try { localStorage.setItem('people.accessToken', t) } catch { /* the PDF frame has no storage */ } }, `acc-${s.as.user_id}`)
      const page = await ctx.newPage()
      page.on('pageerror', (e) => problems.push(`${s.name}: page error ${e}`))
      try {
        await page.goto(`${mock.origin}${s.path}`)
        try {
          await page.waitForSelector(s.ready, { timeout: 15000, state: 'attached' })
          await s.act?.(page, mock)
        } catch (e) {
          problems.push(`${s.name}: never became ready (${String(e).split('\n')[0]})`)
          continue
        }
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForTimeout(350)
        for (const p of await page.evaluate(AUDIT, { narrow: width <= 768 })) problems.push(`${s.name}: ${p}`)
        for (const p of await page.evaluate(ORBIT_AUDIT, { narrow: width <= 768, panelOpen: Boolean(s.panel), kb: Boolean(s.kb), modalId: s.modalId ?? null })) problems.push(`${s.name}: ${p}`)
        if (s.modal) {
          const inView = await page.evaluate(() => {
            const r = document.querySelector('[data-testid=source-preview]').getBoundingClientRect()
            return r.left >= -0.5 && r.right <= document.documentElement.clientWidth + 0.5
          })
          if (!inView) problems.push(`${s.name}: preview modal outside the viewport`)
        }
      } finally {
        await ctx.close()
        await mock.close()
      }
    }
    assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
  })
}

test('audit self-check: the Orbit audit flags a launcher that is too small and a panel that sticks out', opts, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  const page = await ctx.newPage()
  try {
    await page.setContent(
      '<button data-testid="orbit-launcher" style="width:30px;height:30px;position:fixed;right:0;bottom:0"></button>' +
        '<section data-testid="orbit-panel" style="position:fixed;left:10px;top:0;width:700px;height:200px"><div data-testid="orbit-messages" style="width:100px;overflow:auto"></div></section>',
    )
    const problems = await page.evaluate(ORBIT_AUDIT, { narrow: true, panelOpen: true })
    assert.ok(problems.some((p) => /launcher smaller than 44px/.test(p)), problems.join('\n'))
    assert.ok(problems.some((p) => /panel outside the viewport/.test(p)))
    assert.ok(problems.some((p) => /not full screen/.test(p)))
  } finally {
    await ctx.close()
  }
})
