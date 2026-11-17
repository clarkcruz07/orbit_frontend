// The HR Knowledge Base against the mock API: the HR-only sidebar item and page, uploads (type and size checked first), writing text with
// the toolbar, editing, switching items on and off, deleting, and previewing files. Gated: RUN_BROWSER_TESTS=1.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { dist, enabled, opts, text } from './peoplemgmt-helpers.mjs'
import { PDF_BYTES, U, withAssistant } from './assistant-mock.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})

const PAGE = '/knowledge-base'
const READY = '[data-testid=kb-page]'
const run = (user, fn, o) => withAssistant(browser, dist, user, fn, o)
const calls = (mock, method, route) => mock.state.calls.filter((c) => c.method === method && c.route === route)
const uploads = (mock) => calls(mock, 'POST', '/assistant/kb/items/upload')
const pdf = (name = 'Handbook.pdf') => ({ name, mimeType: 'application/pdf', buffer: PDF_BYTES })

async function uploadPdf(page, name = 'Handbook.pdf', title = '') {
  await page.click('[data-testid=add-upload]')
  await page.setInputFiles('[data-testid=kb-file-input]', pdf(name))
  if (title) await page.fill('[data-testid=upload-title]', title)
  await page.click('[data-testid=upload-submit]')
  await page.waitForSelector('[data-testid=kb-item]')
}
async function writeText(page, title, body) {
  await page.click('[data-testid=add-text]')
  await page.fill('[data-testid=editor-title]', title)
  await page.fill('[data-testid=editor-body]', body)
  await page.click('[data-testid=editor-save]')
  await page.waitForSelector('[data-testid=kb-item]')
}

// ------------------------------------------------------------------------------------------------ navigation and access
test('navigation: "Knowledge Base" is in the sidebar for HR only, opens the page, and the old Settings address redirects', opts, async () => {
  await run(U.anna, async ({ page, go }) => {
    await go('/nothing-here', '.app-content')
    const link = page.locator('.sidebar a[href="/knowledge-base"]')
    assert.equal(await link.count(), 1)
    assert.match(await link.innerText(), /Knowledge Base/)
    await link.click()
    await page.waitForSelector(READY)
    assert.equal(await text(page, '.app-content h1'), 'Knowledge Base')
    assert.match(await text(page, '.page-title-block p'), /What Bluedge Orbit knows\. Everything here is the source of truth for its answers\./)
    assert.equal(await page.locator('.sidebar a[href="/knowledge-base"]').getAttribute('aria-current'), 'page')
    await page.goto(page.url().replace('/knowledge-base', '/settings/knowledge-base'))
    await page.waitForSelector(READY)
    assert.equal(new URL(page.url()).pathname, '/knowledge-base')
  })
  for (const user of [U.carla, U.ben, U.dan]) {
    await run(user, async ({ page, go }) => {
      await go('/nothing-here', '.app-content')
      assert.equal(await page.locator('.sidebar a[href="/knowledge-base"]').count(), 0, `${user.name} has no Knowledge Base entry`)
      await page.goto(`${page.url().replace('/nothing-here', '')}${PAGE}`)
      await page.waitForSelector('[data-testid=kb-denied]')
      assert.match(await text(page, '[data-testid=kb-denied]'), /not available/)
      assert.equal(await page.locator('[data-testid=add-upload]').count(), 0)
    })
  }
})

test('empty Knowledge Base: the status counts and both ways to add are offered', opts, async () => {
  await run(U.anna, async ({ page, go }) => {
    await go(PAGE, READY)
    await page.waitForSelector('[data-testid=kb-empty]')
    assert.equal(await page.locator('[data-testid=kb-empty] [data-testid=add-upload]').count(), 1)
    assert.equal(await page.locator('[data-testid=kb-empty] [data-testid=add-text]').count(), 1)
    assert.match(await text(page, '[data-testid=kb-status-items]'), /0 items in the Knowledge Base: 0 indexed/)
    assert.match(await text(page, '[data-testid=kb-status-policies]'), /3 published policy documents are also ready/)
    assert.match(await text(page, '[data-testid=kb-unreadable]'), /Scanned handbook[\s\S]*No text could be read/)
  })
})

// ------------------------------------------------------------------------------------------------ upload
test('upload: a PDF goes up with a progress state, appears as Indexed, and its title, kind, date and author are shown', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    mock.state.delay['POST /assistant/kb/items/upload'] = 500
    await go(PAGE, READY)
    await page.click('[data-testid=add-upload]')
    assert.equal(await page.locator('[data-testid=upload-submit]').isDisabled(), true, 'nothing chosen yet')
    assert.equal(await page.locator('[data-testid=kb-file-input]').getAttribute('accept'), '.pdf,.docx,.txt,.md')
    await page.setInputFiles('[data-testid=kb-file-input]', pdf('Employee_Handbook.pdf'))
    assert.match(await text(page, '[data-testid=upload-file]'), /Employee_Handbook\.pdf/)
    assert.equal(await page.locator('[data-testid=upload-error]').count(), 0)
    await page.fill('[data-testid=upload-title]', 'Employee Handbook 2026')
    await page.click('[data-testid=upload-submit]')
    await page.waitForSelector('[data-testid=upload-progress]')
    assert.equal(await page.locator('[data-testid=upload-submit]').isDisabled(), true, 'one upload at a time')
    assert.equal(await page.locator('[data-testid=upload-cancel]').isDisabled(), true)
    await page.waitForSelector('[data-testid=kb-item]')
    assert.equal(uploads(mock).length, 1)
    assert.equal(mock.state.items[0].filename, 'Employee_Handbook.pdf')
    assert.equal(mock.state.items[0].title, 'Employee Handbook 2026')
    assert.match(await text(page, '[data-testid=kb-notice]'), /Employee_Handbook\.pdf was uploaded/)
    const item = page.locator('[data-testid=kb-item]')
    assert.equal(await text(page, '[data-testid=kb-item-title]'), 'Employee Handbook 2026')
    assert.equal(await text(page, '[data-testid=kb-item-kind]'), 'PDF')
    assert.equal(await text(page, '[data-testid=kb-item-status]'), 'Indexed')
    assert.match(await text(page, '[data-testid=kb-item-updated]'), /Updated 16 Nov 2026 by Anna Reyes/)
    assert.match(await text(page, '[data-testid=kb-item-file]'), /Employee_Handbook\.pdf/)
    assert.equal(await item.getAttribute('data-active'), 'true')
    assert.equal(await page.locator('[data-testid=kb-edit]').count(), 0, 'files are not edited as text')
    assert.equal(await page.locator('[data-testid=kb-preview]').count(), 1)
    assert.equal(await page.locator('[data-testid=kb-download]').count(), 1)
    assert.match(await text(page, '[data-testid=kb-status-items]'), /1 item in the Knowledge Base: 1 indexed/)
    assert.equal(await page.locator('[data-testid=upload-card]').count(), 0, 'the form closes after a successful upload')
  })
})

test('upload: a file with no readable text is added as "Can\'t be read" and the reason is shown', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await uploadPdf(page, 'scan-of-old-policy.pdf')
    assert.equal(await text(page, '[data-testid=kb-item-status]'), "Can't be read")
    assert.match(await page.locator('[data-testid=kb-item-status]').getAttribute('title'), /No text could be read/)
    assert.match(await text(page, '[data-testid=kb-item-reason]'), /Orbit cannot read this: No text could be read from this file/)
    assert.equal(await page.locator('[data-testid=kb-item]').getAttribute('data-status'), 'unreadable')
    assert.match(await text(page, '[data-testid=kb-status-items]'), /1 item in the Knowledge Base: 0 indexed, 1 can't be read/)
    assert.equal(mock.state.items.length, 1)
  })
})

test('upload: a wrong file type or an oversize file is refused with a friendly message BEFORE any request', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await page.click('[data-testid=add-upload]')
    const input = '[data-testid=kb-file-input]'
    await page.setInputFiles(input, { name: 'installer.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') })
    assert.match(await text(page, '[data-testid=upload-error]'), /not supported\. Use PDF, Word \(\.docx\), \.txt or \.md/)
    assert.equal(await page.locator('[data-testid=upload-file]').count(), 0)
    assert.equal(await page.locator('[data-testid=upload-submit]').isDisabled(), true)
    await page.setInputFiles(input, { name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('x') })
    assert.match(await text(page, '[data-testid=upload-error]'), /Old Word files \(\.doc\)/)
    await page.setInputFiles(input, { name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 1) })
    assert.match(await text(page, '[data-testid=upload-error]'), /limit is 10 MB/)
    assert.equal(await page.locator('[data-testid=upload-submit]').isDisabled(), true)
    await page.setInputFiles(input, { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) })
    assert.match(await text(page, '[data-testid=upload-error]'), /empty/)
    assert.equal(uploads(mock).length, 0, 'not one request was made')
    // a good file clears the message
    await page.setInputFiles(input, { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\nSome text') })
    assert.equal(await page.locator('[data-testid=upload-error]').count(), 0)
    assert.equal(await page.locator('[data-testid=upload-submit]').isDisabled(), false)
  })
})

test('upload: drag and drop works, and the server\'s own reasons (413, 422, 500) are shown while the form keeps the file', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await page.click('[data-testid=add-upload]')
    const drop = (name, body) =>
      page.evaluate(
        ([n, b]) => {
          const dt = new DataTransfer()
          dt.items.add(new File([b], n, { type: 'text/plain' }))
          document.querySelector('[data-testid=upload-drop]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
        },
        [name, body],
      )
    await drop('runbook.exe', 'nope')
    assert.match(await text(page, '[data-testid=upload-error]'), /not supported/)
    await drop('runbook.txt', 'Restart the service, then check the logs.')
    assert.match(await text(page, '[data-testid=upload-file]'), /runbook\.txt/)
    assert.equal(await page.locator('[data-testid=upload-error]').count(), 0)

    mock.state.force['POST /assistant/kb/items/upload'] = 413
    await page.click('[data-testid=upload-submit]')
    await page.waitForSelector('[data-testid=upload-banner]')
    assert.match(await text(page, '[data-testid=upload-banner]'), /larger than 10 MB/)
    assert.match(await text(page, '[data-testid=upload-file]'), /runbook\.txt/, 'the chosen file is still there')
    assert.equal(await page.locator('[data-testid=upload-submit]').isDisabled(), false)
    mock.state.force['POST /assistant/kb/items/upload'] = 422
    await page.click('[data-testid=upload-submit]')
    await page.waitForFunction(() => /Forced failure/.test(document.querySelector('[data-testid=upload-banner]')?.textContent || ''))
    mock.state.force['POST /assistant/kb/items/upload'] = 500
    await page.click('[data-testid=upload-submit]')
    await page.waitForFunction(() => /wrong on our side/.test(document.querySelector('[data-testid=upload-banner]')?.textContent || ''))
    delete mock.state.force['POST /assistant/kb/items/upload']
    await page.click('[data-testid=upload-submit]')
    await page.waitForSelector('[data-testid=kb-item]')
    assert.equal(await text(page, '[data-testid=kb-item-kind]'), 'Text')
    assert.equal(mock.state.items[0].title, 'runbook')
  })
})

// ------------------------------------------------------------------------------------------------ write text
test('write text: toolbar bold and bullets, Enter continues and ends a list, the Preview tab shows bold and a list, saving adds it', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await page.click('[data-testid=add-text]')
    await page.fill('[data-testid=editor-title]', 'Remote work rules')
    const ta = page.locator('[data-testid=editor-body]')
    await ta.click()
    await page.keyboard.type('Rules')
    await page.keyboard.press('Control+A')
    await page.click('[data-testid=tool-bold]')
    assert.equal(await ta.inputValue(), '**Rules**')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'editor-body', 'the toolbar keeps the focus in the text')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.click('[data-testid=tool-bullets]')
    assert.equal(await ta.inputValue(), '**Rules**\n- ')
    await page.keyboard.type('one')
    await page.keyboard.press('Enter')
    assert.equal(await ta.inputValue(), '**Rules**\n- one\n- ', 'Enter continues the list')
    await page.keyboard.type('two')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    assert.equal(await ta.inputValue(), '**Rules**\n- one\n- two\n', 'Enter on an empty item ends the list')

    // the preview shows what will be stored, drawn as elements
    await page.click('[data-testid=tab-preview]')
    assert.equal(await text(page, '[data-testid=editor-preview] strong'), 'Rules')
    assert.equal(await page.locator('[data-testid=editor-preview] ul li').count(), 2)
    assert.equal(await page.locator('[data-testid=editor-preview] textarea').count(), 0)
    await page.click('[data-testid=tab-write]')
    assert.equal(await ta.inputValue(), '**Rules**\n- one\n- two\n', 'switching tabs keeps the text')

    await page.click('[data-testid=editor-save]')
    await page.waitForSelector('[data-testid=kb-item]')
    assert.match(await text(page, '[data-testid=kb-notice]'), /Added/)
    assert.deepEqual(calls(mock, 'POST', '/assistant/kb/items')[0].body, { title: 'Remote work rules', body: '**Rules**\n- one\n- two' })
    assert.equal(await text(page, '[data-testid=kb-item-kind]'), 'Text')
    assert.equal(await text(page, '[data-testid=kb-item-status]'), 'Indexed')
    assert.equal(await page.locator('[data-testid=text-editor]').count(), 0)
  })
})

test('write text: numbering on several lines, Ctrl+B, and markup typed into the text is shown as text in the preview', opts, async () => {
  await run(U.anna, async ({ page, go }) => {
    await go(PAGE, READY)
    await page.click('[data-testid=add-text]')
    const ta = page.locator('[data-testid=editor-body]')
    await ta.fill('first\nsecond')
    await ta.click()
    await page.keyboard.press('Control+A')
    await page.click('[data-testid=tool-numbers]')
    assert.equal(await ta.inputValue(), '1. first\n2. second')
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    assert.equal(await ta.inputValue(), '1. first\n2. second\n3. ', 'numbering continues')
    await page.click('[data-testid=tool-numbers]') // toggles the empty line's number off again
    assert.equal(await ta.inputValue(), '1. first\n2. second\n')
    await ta.fill('abc')
    await ta.evaluate((el) => el.setSelectionRange(0, 3))
    await page.keyboard.press('Control+b')
    assert.equal(await ta.inputValue(), '**abc**')
    await page.keyboard.press('Control+b')
    assert.equal(await ta.inputValue(), 'abc')
    await ta.fill('<script>window.__x=1</script> [a](javascript:alert(1)) <b>x</b>')
    await page.click('[data-testid=tab-preview]')
    assert.match(await text(page, '[data-testid=editor-preview]'), /<script>window\.__x=1<\/script> \[a\]\(javascript:alert\(1\)\) <b>x<\/b>/)
    assert.equal(await page.locator('[data-testid=editor-preview] script, [data-testid=editor-preview] a, [data-testid=editor-preview] b').count(), 0)
    assert.equal(await page.evaluate(() => window.__x ?? null), null)
  })
})

test('write text: title and text are checked inline, a server error keeps what was typed, and closing with unsaved changes asks first', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await page.click('[data-testid=add-text]')
    await page.click('[data-testid=editor-save]')
    assert.match(await text(page, '[data-testid=field-title-error]'), /Enter a title/)
    assert.match(await text(page, '[data-testid=field-body-error]'), /Write the text/)
    assert.equal(calls(mock, 'POST', '/assistant/kb/items').length, 0)
    assert.equal(await page.locator('[data-testid=editor-title]').getAttribute('maxlength'), '160')
    assert.equal(await page.locator('[data-testid=editor-body]').getAttribute('maxlength'), '20000')
    await page.fill('[data-testid=editor-title]', 'Draft')
    await page.fill('[data-testid=editor-body]', 'Some **important** text')
    mock.state.force['POST /assistant/kb/items'] = 500
    await page.click('[data-testid=editor-save]')
    await page.waitForSelector('[data-testid=editor-banner]')
    assert.match(await text(page, '[data-testid=editor-banner]'), /wrong on our side/)
    assert.equal(await page.inputValue('[data-testid=editor-title]'), 'Draft')
    assert.equal(await page.inputValue('[data-testid=editor-body]'), 'Some **important** text')
    // unsaved changes: Cancel asks first
    await page.click('[data-testid=editor-cancel]')
    await page.waitForSelector('[data-testid=discard-dialog]')
    await page.click('[data-testid=discard-keep]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=discard-dialog]'))
    assert.equal(await page.inputValue('[data-testid=editor-body]'), 'Some **important** text')
    await page.click('[data-testid=editor-cancel]')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('[data-testid=discard-dialog]'))
    assert.equal(await page.locator('[data-testid=text-editor]').count(), 1, 'Escape closes only the question')
    await page.click('[data-testid=editor-cancel]')
    await page.click('[data-testid=discard-confirm]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=text-editor]'))
    assert.equal(mock.state.items.length, 0)
    // nothing typed: no question
    await page.click('[data-testid=add-text]')
    await page.click('[data-testid=editor-cancel]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=text-editor]'))
    assert.equal(await page.locator('[data-testid=discard-dialog]').count(), 0)
  })
})

// ------------------------------------------------------------------------------------------------ edit, switch, delete, preview
test('edit a text item: the same editor, prefilled; only what changed is sent; a file has no Edit', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await writeText(page, 'Expenses', 'Managers approve **small** expenses.')
    await uploadPdf(page, 'Handbook.pdf')
    assert.equal(await page.locator('[data-testid=kb-edit]').count(), 1)
    await page.click('[data-testid=kb-edit]')
    assert.equal(await page.inputValue('[data-testid=editor-title]'), 'Expenses')
    assert.equal(await page.inputValue('[data-testid=editor-body]'), 'Managers approve **small** expenses.')
    assert.equal(await page.locator('[data-testid=kb-edit]').first().isDisabled(), true, 'one editor at a time')
    await page.fill('[data-testid=editor-title]', 'Expense approvals')
    await page.click('[data-testid=editor-save]')
    await page.waitForFunction(() => /Expense approvals/.test(document.querySelector('[data-testid=kb-item-title]')?.textContent || ''))
    const id = mock.state.items[0].item_id
    assert.deepEqual(calls(mock, 'PATCH', `/assistant/kb/items/${id}`)[0].body, { title: 'Expense approvals' })
    assert.match(await text(page, '[data-testid=kb-notice]'), /Saved/)
    // saving without a change just closes
    await page.click('[data-testid=kb-edit]')
    await page.click('[data-testid=editor-save]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=text-editor]'))
    assert.equal(calls(mock, 'PATCH', `/assistant/kb/items/${id}`).length, 1)
  })
})

test('switching an item off and on (Active switch) and deleting it with a confirmation', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await writeText(page, 'Expenses', 'Managers approve small expenses.')
    const sw = page.locator('[data-testid=kb-toggle]')
    assert.equal(await sw.getAttribute('role'), 'switch')
    assert.equal(await sw.getAttribute('aria-checked'), 'true')
    const id = mock.state.items[0].item_id
    await sw.click()
    await page.waitForFunction(() => document.querySelector('[data-testid=kb-toggle]')?.getAttribute('aria-checked') === 'false')
    assert.deepEqual(calls(mock, 'PATCH', `/assistant/kb/items/${id}`)[0].body, { active: false })
    assert.equal(mock.state.items[0].active, false)
    assert.equal(await page.locator('[data-testid=kb-item]').getAttribute('data-active'), 'false')
    assert.equal(await text(page, '[data-testid=kb-item-off]'), 'Off')
    assert.match(await text(page, '[data-testid=kb-notice]'), /switched off/)
    await sw.click()
    await page.waitForFunction(() => document.querySelector('[data-testid=kb-toggle]')?.getAttribute('aria-checked') === 'true')
    assert.deepEqual(calls(mock, 'PATCH', `/assistant/kb/items/${id}`)[1].body, { active: true })
    // a failing switch says so and leaves it as it was
    mock.state.force[`PATCH /assistant/kb/items/${id}`] = 500
    await sw.click()
    await page.waitForSelector('[data-testid=kb-row-error]')
    assert.equal(await sw.getAttribute('aria-checked'), 'true')
    delete mock.state.force[`PATCH /assistant/kb/items/${id}`]

    await page.click('[data-testid=kb-delete]')
    await page.waitForSelector('[data-testid=delete-dialog]')
    assert.match(await text(page, '[data-testid=delete-dialog]'), /Delete Expenses\?/)
    await page.click('[data-testid=dialog-cancel]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=delete-dialog]'))
    assert.equal(mock.state.items.length, 1, 'Cancel keeps it')
    await page.click('[data-testid=kb-delete]')
    await page.click('[data-testid=delete-confirm]')
    await page.waitForSelector('[data-testid=kb-empty]')
    assert.equal(mock.state.items.length, 0)
    assert.equal(calls(mock, 'DELETE', `/assistant/kb/items/${id}`).length, 1)
    assert.match(await text(page, '[data-testid=kb-notice]'), /Expenses was deleted/)
  })
})

test('files: Preview opens the PDF in the preview window, Download saves it under its own name, and a vanished file is explained', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    await go(PAGE, READY)
    await uploadPdf(page, 'Handbook.pdf', 'Employee Handbook')
    const id = mock.state.items[0].item_id
    await page.click('[data-testid=kb-preview]')
    await page.waitForSelector('[data-testid=preview-frame]')
    assert.equal(calls(mock, 'GET', `/assistant/kb/items/${id}/file`).length, 1)
    assert.match(await text(page, '[data-testid=source-preview] h2'), /Employee Handbook/)
    await page.click('[data-testid=preview-close]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=source-preview]'))
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=kb-download]')])
    assert.equal(dl.suggestedFilename(), 'Handbook.pdf')
    assert.equal(await page.locator('a[href*="/kb/items/"]').count(), 0, 'no bare link to the file endpoint')
    // the file disappears on the server
    mock.state.fileBytes.delete(id)
    await page.click('[data-testid=kb-download]')
    await page.waitForSelector('[data-testid=kb-row-error]')
    assert.match(await text(page, '[data-testid=kb-row-error]'), /no longer available/)
    await page.click('[data-testid=kb-preview]')
    await page.waitForSelector('[data-testid=preview-error]')
    await page.click('[data-testid=preview-close]')
  })
})

test('the Knowledge Base list: a server error is explained with a retry, and a person without access sees nothing of it', opts, async () => {
  await run(U.anna, async ({ page, go, mock }) => {
    mock.state.force['GET /assistant/kb/items'] = 500
    await go(PAGE, '[data-testid=kb-error]')
    assert.match(await text(page, '[data-testid=kb-error]'), /wrong on our side/)
    delete mock.state.force['GET /assistant/kb/items']
    await page.click('[data-testid=kb-error] button')
    await page.waitForSelector('[data-testid=kb-empty]')
  })
})
