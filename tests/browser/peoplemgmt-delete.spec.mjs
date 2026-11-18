// Mock-API browser tests for deleting people who have left: the X column on the People list, the confirmation, the refusal message.
// Gated: RUN_BROWSER_TESTS=1. Fictional data only.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { U } from './peoplemgmt-mock.mjs'
import { callsTo, hasText, noOverflow, opts, withApp, enabled } from './peoplemgmt-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})
const app = (user, fn, o) => withApp(browser, user, fn, o)
const LEFT = '[data-testid=people-row]:has([data-testid=status-pill]:text("Left"))'

test('only people who have left get an X; clicking it asks first and Cancel changes nothing', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/people?status=left', '[data-testid=people-row]')
    assert.equal(await page.locator('[data-testid=delete-person]').count(), await page.locator('[data-testid=people-row]').count(), 'every left person has one')
    await go('/people?status=active', '[data-testid=people-row]')
    assert.equal(await page.locator('[data-testid=delete-person]').count(), 0, 'nobody who is still here can be deleted')
    assert.equal(await page.locator('[data-testid=delete-person-locked]').count(), await page.locator('[data-testid=people-row]').count(), 'they show a greyed X')
    assert.equal(await page.locator('[data-testid=delete-person-locked]').first().isDisabled(), true)
    await go('/people?status=left', '[data-testid=people-row]')
    const name = await page.locator('[data-testid=people-open]').first().innerText()
    await page.locator('[data-testid=delete-person]').first().click()
    await page.waitForSelector('[data-testid=delete-dialog]')
    const dialogText = await page.locator('[data-testid=delete-dialog]').innerText()
    for (const part of [`Delete ${name}?`, 'cannot be undone', 'former employee']) assert.ok(dialogText.includes(part), part)
    await page.click('[data-testid=dialog-cancel]')
    await page.waitForSelector('[data-testid=delete-dialog]', { state: 'detached' })
    assert.equal(callsTo(mock, 'DELETE', '/people/employees/' + (await page.locator('[data-testid=people-row]').first().getAttribute('data-id'))).length, 0)
    assert.deepEqual(errors, [])
  }))

test('confirming deletes the person, says so, and the list no longer shows them', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/people?status=left', '[data-testid=people-row]')
    const row = page.locator('[data-testid=people-row]').first()
    const id = await row.getAttribute('data-id')
    const name = await row.locator('[data-testid=people-open]').innerText()
    await row.locator('[data-testid=delete-person]').click()
    await page.click('[data-testid=delete-confirm]')
    await page.waitForFunction((t) => document.querySelector('[data-testid=people-flash]')?.textContent === t, `${name} was deleted.`)
    assert.equal(callsTo(mock, 'DELETE', `/people/employees/${id}`).length, 1)
    await page.waitForFunction((x) => !document.querySelector(`[data-testid=people-row][data-id="${x}"]`), id)
    assert.deepEqual(errors, [])
  }))

test('a refusal from the server is shown in the dialog and the person stays', opts, () =>
  app(
    U.anna,
    async ({ page, errors, go }) => {
      await go('/people?status=left', '[data-testid=people-row]')
      const before = await page.locator('[data-testid=people-row]').count()
      await page.locator('[data-testid=delete-person]').first().click()
      await page.click('[data-testid=delete-confirm]')
      await hasText(page, '[data-testid=dialog-error]', /still has active direct reports/)
      await page.click('[data-testid=dialog-cancel]')
      assert.equal(await page.locator('[data-testid=people-row]').count(), before)
    },
    { setup: (m) => (m.state.deleteFails = true) },
  ))

test('narrow screens: a left person has a Delete button on the card and nothing scrolls sideways', opts, () =>
  app(
    U.anna,
    async ({ page, go }) => {
      await go('/people?status=left', '[data-testid=people-card]')
      assert.ok(await page.locator('[data-testid=delete-person-card]').first().isVisible())
      assert.equal(await noOverflow(page), true)
    },
    { viewport: { width: 390, height: 800 } },
  ))
