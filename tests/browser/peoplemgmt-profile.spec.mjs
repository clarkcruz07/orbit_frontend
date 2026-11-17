// Mock-API browser tests for the HR employee profile: Add person with optional sections, the five section cards on a person's page
// (edit one section, per-field server errors, masked government IDs), the list showing only what it should, and My Profile (read-only).
// The mock (peoplemgmt-mock.mjs + profile-mock.mjs) plays "the server". Gated: RUN_BROWSER_TESTS=1.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser } from './browser-env.mjs'
import { U } from './peoplemgmt-mock.mjs'
import { callsTo, hasText, noOverflow, opts, text, withApp, enabled } from './peoplemgmt-helpers.mjs'

let browser
before(async () => {
  if (enabled) browser = await launchBrowser()
})
after(async () => {
  await browser?.close()
})
const app = (user, fn, o) => withApp(browser, user, fn, o)
const MARA = '/people/EMP-0100'

test('add person: the profile sections are optional, closed by default, and only filled sections are sent', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go('/people/new', '[data-testid=person-form]')
    for (const s of ['personal', 'contact', 'emergency_contact', 'work', 'statutory']) {
      assert.equal(await page.getAttribute(`[data-testid=profile-new-${s}]`, 'open'), null, `${s} starts closed`)
    }
    // opening several sections one after another keeps the page alive and each one open (a regression: the toggle handler once read a stale event)
    for (const s of ['personal', 'emergency_contact']) await page.click(`[data-testid=toggle-profile-${s}]`)
    assert.deepEqual(await page.$$eval('[data-testid=profile-new] details', (els) => els.map((e) => e.open)), [true, false, true, false, false])
    for (const s of ['personal', 'emergency_contact']) await page.click(`[data-testid=toggle-profile-${s}]`)
    await page.click('[data-testid=toggle-profile-personal]')
    await page.fill('[data-testid=input-profile-personal-birth_year]', '1990')
    assert.match(await text(page, '[data-testid=field-profile-personal-birth_year]'), /Shown only to HR and the person. The calendar never shows the year./)
    await page.fill('[data-testid=input-name]', 'Lena Villar')
    await page.fill('[data-testid=input-email]', 'lena.villar@example.test')
    await page.fill('[data-testid=input-job_title]', 'Analyst')
    await page.fill('[data-testid=input-department]', 'Operations')
    await page.click('[data-testid=toggle-profile-contact]')
    await page.fill('[data-testid=input-profile-contact-mobile]', '0917 555 0188')
    await page.fill('[data-testid=input-profile-contact-address-city]', 'Makati')
    await page.click('[data-testid=toggle-profile-work]')
    await page.selectOption('[data-testid=input-profile-work-work_arrangement]', 'remote')
    await page.click('[data-testid=create-person]')
    await page.waitForURL(/\/people\/EMP-/)
    const post = callsTo(mock, 'POST', '/people/employees')[0]
    assert.deepEqual(post.body.profile, { personal: { birth_year: 1990 }, contact: { mobile: '0917 555 0188', address: { city: 'Makati' } }, work: { work_arrangement: 'remote' } })
    assert.equal(Object.hasOwn(post.body.profile, "emergency_contact"), false, "an untouched section is not sent")
    await page.waitForSelector('[data-testid=profile-cards]')
    assert.match(await text(page, '[data-testid=fact-profile-personal-birth_year]'), /1990/)
    assert.match(await text(page, '[data-testid=fact-birthday-label]'), /Birth year/, 'no day and month on file: just the year')
    assert.match(await text(page, '[data-testid=fact-profile-contact-mobile]'), /0917 555 0188/)
    assert.match(await text(page, '[data-testid=fact-profile-work-work_arrangement]'), /Remote/)
    assert.deepEqual(errors, [])
  }))

test('add person: nothing in the profile means no profile in the request; a bad value opens its section with the error', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people/new', '[data-testid=person-form]')
    await page.fill('[data-testid=input-name]', 'No Profile')
    await page.fill('[data-testid=input-email]', 'no.profile@example.test')
    await page.fill('[data-testid=input-job_title]', 'Analyst')
    await page.fill('[data-testid=input-department]', 'Operations')
    await page.click('[data-testid=toggle-profile-statutory]')
    await page.fill('[data-testid=input-profile-statutory-tin]', '12 34')
    await page.click('[data-testid=toggle-profile-contact]') // open then the error keeps it open
    await page.click('[data-testid=create-person]')
    await page.waitForSelector('[data-testid=field-profile-statutory-tin-error]')
    assert.match(await text(page, '[data-testid=field-profile-statutory-tin-error]'), /TIN may only contain digits and hyphens/)
    assert.equal(callsTo(mock, 'POST', '/people/employees').length, 0, 'the client check stops it before any request')
    await page.fill('[data-testid=input-profile-statutory-tin]', '')
    await page.click('[data-testid=create-person]')
    await page.waitForURL(/\/people\/EMP-/)
    assert.equal(Object.hasOwn(callsTo(mock, 'POST', '/people/employees')[0].body, 'profile'), false)
  }))

test('person page: five profile sections with Not provided for empty values and a sensitive card', opts, () =>
  app(U.anna, async ({ page, errors, go }) => {
    await go('/people/EMP-0101', '[data-testid=profile-cards]')
    for (const s of ['personal', 'contact', 'emergency_contact', 'work', 'statutory']) await page.waitForSelector(`[data-testid=profile-card-${s}]`)
    assert.match(await text(page, '[data-testid=fact-profile-personal-preferred_name]'), /Not provided/)
    assert.match(await text(page, '[data-testid=fact-profile-contact-address]'), /Not provided/)
    assert.match(await text(page, '[data-testid=profile-sensitive-note]'), /Sensitive: visible only to HR and the person/)
    // the existing basics are still there
    assert.match(await text(page, '[data-testid=details-facts]'), /Job title/)
    assert.equal(await page.locator('[data-testid=deactivate]').count(), 1)
    assert.deepEqual(errors, [])
  }))

test('person page: a full profile reads naturally; government IDs are masked until Show, and re-mask after Hide', opts, () =>
  app(U.anna, async ({ page, go }) => {
    await go(MARA, '[data-testid=profile-cards]')
    assert.match(await text(page, '[data-testid=fact-profile-personal-gender]'), /Female/)
    assert.match(await text(page, '[data-testid=fact-profile-work-work_arrangement]'), /Hybrid/)
    assert.match(await text(page, '[data-testid=fact-profile-work-probation_end_date]'), /3 Feb 2027/)
    assert.match((await text(page, '[data-testid=fact-profile-contact-address]')).replace(/\n+/g, ' / '), /12 Mabini St, Unit 4 \/ Makati, Metro Manila 1210 \/ Philippines/)
    assert.match(await text(page, '[data-testid=fact-profile-emergency_contact-name]'), /Ana Aquino/)
    const masked = await text(page, '[data-testid=profile-facts-statutory]')
    assert.match(masked, /••••6789/)
    assert.doesNotMatch(masked, /123-456-789/)
    await page.click('[data-testid=toggle-statutory-show]')
    assert.match(await text(page, '[data-testid=profile-facts-statutory]'), /123-456-789/)
    assert.equal(await page.getAttribute('[data-testid=toggle-statutory-show]', 'aria-pressed'), 'true')
    await page.click('[data-testid=toggle-statutory-show]')
    assert.doesNotMatch(await text(page, '[data-testid=profile-facts-statutory]'), /123-456-789/)
  }))

test('person page: editing one section sends only that section\'s changed keys; Cancel discards', opts, () =>
  app(U.anna, async ({ page, mock, errors, go }) => {
    await go(MARA, '[data-testid=profile-cards]')
    await page.click('[data-testid=edit-profile-contact]')
    await page.waitForSelector('[data-testid=profile-form-contact]')
    assert.equal(await page.inputValue('[data-testid=input-profile-contact-address-city]'), 'Makati')
    await page.fill('[data-testid=input-profile-contact-mobile]', '+63 917 000 0000')
    await page.fill('[data-testid=input-profile-contact-address-line2]', '')
    await page.click('[data-testid=save-profile-contact]')
    await page.waitForSelector('[data-testid=profile-facts-contact]')
    const patch = callsTo(mock, 'PATCH', '/people/employees/EMP-0100')[0]
    assert.deepEqual(patch.body, { profile: { contact: { mobile: '+63 917 000 0000', address: { line2: null } } } })
    assert.match(await text(page, '[data-testid=fact-profile-contact-mobile]'), /\+63 917 000 0000/)
    assert.doesNotMatch(await text(page, '[data-testid=fact-profile-contact-address]'), /Unit 4/)
    assert.match(await text(page, '[data-testid=detail-notice]'), /Contact and address saved/)
    // Cancel discards what was typed and sends nothing
    await page.click('[data-testid=edit-profile-personal]')
    await page.fill('[data-testid=input-profile-personal-preferred_name]', 'Changed')
    await page.click('[data-testid=cancel-profile-personal]')
    assert.match(await text(page, '[data-testid=fact-profile-personal-preferred_name]'), /Mara/)
    assert.equal(callsTo(mock, 'PATCH', '/people/employees/EMP-0100').length, 1)
    // saving without a change just closes the form
    await page.click('[data-testid=edit-profile-work]')
    await page.click('[data-testid=save-profile-work]')
    await page.waitForSelector('[data-testid=profile-facts-work]')
    assert.equal(callsTo(mock, 'PATCH', '/people/employees/EMP-0100').length, 1)
    assert.deepEqual(errors, [])
  }))

test('person page: a server field error is shown on the field ("profile.contact.mobile"), typed data is kept, nothing is lost', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go(MARA, '[data-testid=profile-cards]')
    await page.click('[data-testid=edit-profile-emergency_contact]')
    await page.fill('[data-testid=input-profile-emergency_contact-phone]', '')
    await page.click('[data-testid=save-profile-emergency_contact]')
    await page.waitForSelector('[data-testid=field-profile-emergency_contact-phone-error]')
    assert.match(await text(page, '[data-testid=field-profile-emergency_contact-phone-error]'), /Emergency contact phone is required/)
    // the client check caught it: nothing was sent
    assert.equal(callsTo(mock, 'PATCH', '/people/employees/EMP-0100').length, 0)
    // a value the client accepts but the server refuses (forced) shows under the right field
    await page.fill('[data-testid=input-profile-emergency_contact-phone]', '0917 555 0100')
    mock.state.respondOnce['PATCH /people/employees/EMP-0100'] = { status: 422, body: { detail: 'Invalid employee details', code: 'validation', field_errors: { 'profile.emergency_contact.phone': 'is already used by another person' } } }
    await page.click('[data-testid=save-profile-emergency_contact]')
    await page.waitForSelector('[data-testid=field-profile-emergency_contact-phone-error]')
    assert.match(await text(page, '[data-testid=field-profile-emergency_contact-phone-error]'), /Emergency contact phone is already used by another person/)
    assert.equal(await page.inputValue('[data-testid=input-profile-emergency_contact-phone]'), '0917 555 0100')
    assert.match(await text(page, '[data-testid=profile-error-emergency_contact]'), /highlighted fields/)
  }))

test('person page: editing the government IDs uses plain text boxes with numeric keyboards and no autofill', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go(MARA, '[data-testid=profile-cards]')
    await page.click('[data-testid=edit-profile-statutory]')
    const tin = page.locator('[data-testid=input-profile-statutory-tin]')
    assert.equal(await tin.getAttribute('type'), 'text')
    assert.equal(await tin.getAttribute('inputmode'), 'numeric')
    assert.equal(await tin.getAttribute('autocomplete'), 'off')
    await tin.fill('987-654-321')
    await page.click('[data-testid=save-profile-statutory]')
    await page.waitForSelector('[data-testid=profile-facts-statutory]')
    assert.deepEqual(callsTo(mock, 'PATCH', '/people/employees/EMP-0100')[0].body, { profile: { statutory: { tin: '987-654-321' } } })
    assert.match(await text(page, '[data-testid=profile-facts-statutory]'), /••••4321/)
  }))

test('list: shows the preferred name, and the list data carries no government IDs, emergency contact or address', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go('/people?q=Aquino', '[data-testid=people-row]')
    assert.match(await text(page, '[data-testid=people-preferred]'), /Goes by Mara/)
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/people/employees?q=Aquino', { headers: { Authorization: `Bearer ${localStorage.getItem('people.accessToken')}` } })
      return r.json()
    })
    const mara = res.items.find((i) => i.employee.employee_id === 'EMP-0100').employee.profile
    assert.equal(mara.statutory.tin, '')
    assert.equal(mara.emergency_contact.name, '')
    assert.equal(mara.contact.address.line1, '')
    assert.equal(mara.contact.mobile, '+63 917 123 4567', 'the list keeps the basic contact details')
    await hasText(page, '[data-testid=people-count]', /of \d+ people/)
    assert.ok(mock.state.calls.length > 0)
  }))

test('non-HR cannot reach the People pages (the server says no and the page says not available)', opts, () =>
  app(U.carla, async ({ page, go }) => {
    await go('/people/EMP-0100', '[data-testid=person-denied]')
    assert.equal(await page.locator('[data-testid=profile-cards]').count(), 0)
  }))

test('responsive: the profile cards and the edit forms fit at every width', opts, async () => {
  for (const width of [1440, 1024, 768, 390, 320]) {
    await app(U.anna, async ({ page, go }) => {
      await go(MARA, '[data-testid=profile-cards]')
      assert.ok(await noOverflow(page), `person page overflows at ${width}`)
      await page.click('[data-testid=edit-profile-contact]')
      await page.waitForSelector('[data-testid=profile-form-contact]')
      assert.ok(await noOverflow(page), `contact form overflows at ${width}`)
      if (width <= 768) {
        const small = await page.$$eval('[data-testid=profile-form-contact] .btn, [data-testid=profile-form-contact] .pm-input', (els) => els.filter((e) => e.getBoundingClientRect().height < 43).length)
        assert.equal(small, 0, `targets under 44px at ${width}`)
      }
      await page.goto(page.url().replace(/\/people\/.*/, '/people/new'))
      await page.waitForSelector('[data-testid=person-form]')
      await page.click('[data-testid=toggle-profile-contact]')
      await page.click('[data-testid=toggle-profile-statutory]')
      assert.ok(await noOverflow(page), `add form overflows at ${width}`)
      if (width <= 768) {
        const h = await page.$$eval('[data-testid=profile-new] summary', (els) => els.map((e) => e.getBoundingClientRect().height))
        assert.ok(h.every((x) => x >= 43), `collapse headers under 44px at ${width}: ${h}`)
      }
    }, { viewport: { width, height: width >= 1024 ? 900 : 800 } })
  }
})

test('HR: the date of birth is composed from the birthday and the birth year; the birth year is editable and validated', opts, () =>
  app(U.anna, async ({ page, mock, go }) => {
    await go(MARA, '[data-testid=profile-cards]')
    // Mara has a birth year (1995) and no birthday yet: just the year
    assert.match(await text(page, '[data-testid=fact-birthday-label]'), /Birth year/)
    await page.click('[data-testid=edit-details]')
    await page.fill('[data-testid=input-birthday]', '12-12')
    await page.click('[data-testid=save-details]')
    await page.waitForSelector('[data-testid=details-facts]')
    assert.match(await text(page, '[data-testid=fact-birthday-label]'), /Date of birth/)
    assert.match(await text(page, '[data-testid=fact-birthday]'), /12 Dec 1995/)
    assert.match(await text(page, '[data-testid=fact-birthday]'), /The calendar never shows the year/)
    // a year the client refuses: nothing is sent
    await page.click('[data-testid=edit-profile-personal]')
    assert.equal(await page.inputValue('[data-testid=input-profile-personal-birth_year]'), '1995')
    await page.fill('[data-testid=input-profile-personal-birth_year]', '2020')
    await page.click('[data-testid=save-profile-personal]')
    await page.waitForSelector('[data-testid=field-profile-personal-birth_year-error]')
    assert.match(await text(page, '[data-testid=field-profile-personal-birth_year-error]'), /Birth year must be between 1900 and 2012/)
    // a valid change is sent as a number
    await page.fill('[data-testid=input-profile-personal-birth_year]', '1996')
    await page.click('[data-testid=save-profile-personal]')
    await page.waitForSelector('[data-testid=profile-facts-personal]')
    const patches = callsTo(mock, 'PATCH', '/people/employees/EMP-0100')
    assert.deepEqual(patches[patches.length - 1].body, { profile: { personal: { birth_year: 1996 } } })
    assert.match(await text(page, '[data-testid=fact-birthday]'), /12 Dec 1996/)
    // the server can still refuse it (29 February in a non-leap year): shown on the field, typed value kept
    await page.click('[data-testid=edit-profile-personal]')
    await page.fill('[data-testid=input-profile-personal-birth_year]', '1997')
    mock.state.respondOnce['PATCH /people/employees/EMP-0100'] = { status: 422, body: { detail: 'Invalid employee details', code: 'validation', field_errors: { 'profile.personal.birth_year': 'is not a leap year, but the birthday is 29 February' } } }
    await page.click('[data-testid=save-profile-personal]')
    await page.waitForSelector('[data-testid=field-profile-personal-birth_year-error]')
    assert.match(await text(page, '[data-testid=field-profile-personal-birth_year-error]'), /Birth year is not a leap year/)
    assert.equal(await page.inputValue('[data-testid=input-profile-personal-birth_year]'), '1997')
  }))

test('import: the help lists the optional profile columns after the original ones, and a row error names its CSV column', opts, () =>
  app(U.anna, async ({ page, go }) => {
    await go('/people/import', '[data-testid=import-page]')
    assert.match(await text(page, '[data-testid=import-columns]'), /Required columns: name, email, job_title, department, employment_type/)
    const prof = await text(page, '[data-testid=import-profile-columns]')
    for (const c of ['preferred_name', 'birth_year', 'address_line1', 'emergency_phone', 'employee_number', 'regularization_date', 'tin', 'pagibig']) assert.ok(prof.includes(c), c)
    assert.match(await text(page, '[data-testid=import-profile-group-government-ids]'), /Government IDs: tin, sss, philhealth, pagibig/)
    assert.match(prof, /old file without them still works/)
    const head = 'name,email,job_title,department,employment_type,mobile,tin\n'
    const rows = 'Ok Person,ok.person@example.test,Analyst,Operations,full_time,0917 555 0100,123-456\nBad Person,bad.person@example.test,Analyst,Operations,full_time,abc,12 34\n'
    await page.setInputFiles('[data-testid=import-file]', { name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(head + rows) })
    await page.click('[data-testid=check-file]')
    await page.waitForSelector('[data-testid=run-import]')
    await page.click('[data-testid=report-filter-all]')
    const report = await text(page, '[data-testid=import-report]')
    assert.match(report, /mobile: must be 7 to 24 characters/)
    assert.match(report, /tin: may only contain digits and hyphens/)
  }))

// ------------------------------------------------------------------------------------------------ My Profile (self-service)
const withMy = async (who, fn, o = {}) => {
  const { withMockApp, visit } = await import('./mock-helpers.mjs')
  return withMockApp(browser, (ctx) => fn({ ...ctx, open: () => visit(ctx.page, ctx.mock, '/my-profile', '[data-testid=profile-sections]') }), { signInAs: who, ...o })
}
const CARLA = 'carla.dizon@example.test'
const BEN = 'ben.cruz@example.test'

test('my profile: own sections, the date of birth with the year, masked government IDs as received, and the new notes', opts, () =>
  withMy(CARLA, async ({ page, open, errors }) => {
    await open()
    assert.match(await text(page, '[data-testid=profile-birthday-label]'), /Date of birth/)
    assert.match(await text(page, '[data-testid=profile-birthday]'), /23 Nov 1995/)
    assert.match(await text(page, '[data-testid=profile-birthday-note]'), /Everyone can see your birthday on the company calendar \(day and month only\)\. Your birth year is visible only to you and HR\./)
    assert.match(await text(page, '.app-content'), /set by HR\. Ask HR to change this\./)
    assert.match(await text(page, '[data-testid=fact-profile-personal-preferred_name]'), /Carly/)
    assert.match(await text(page, '[data-testid=fact-profile-personal-birth_year]'), /1995/)
    assert.match(await text(page, '[data-testid=fact-profile-personal-birth_year]'), /Ask HR to change this/)
    assert.match(await text(page, '[data-testid=fact-profile-work-work_arrangement]'), /Hybrid/)
    assert.match(await text(page, '[data-testid=fact-profile-contact-address]'), /Mabini/)
    const gov = await text(page, '[data-testid=profile-card-statutory]')
    assert.match(gov, /••••6789/)
    assert.doesNotMatch(gov, /123-456-789/)
    assert.match(await text(page, '[data-testid=profile-sensitive-note]'), /Only you and HR can see this/)
    assert.equal(await page.locator('[data-testid=toggle-statutory-show]').count(), 0, 'masked as received: no Show')
    assert.equal(await page.locator('[data-testid=edit-profile-work]').count(), 0, 'work details are HR only')
    assert.match(await text(page, '[data-testid=profile-hr-only-work]'), /Ask HR to change this/)
    for (const s of ['personal', 'contact', 'emergency_contact', 'statutory']) assert.equal(await page.locator(`[data-testid=edit-profile-${s}]`).count(), 1, `${s} is editable`)
    assert.deepEqual(errors, [])
  }))

test('my profile: editing own personal details sends only the changed keys, leaves out the birth year and says it is saved', opts, () =>
  withMy(CARLA, async ({ page, mock, open, errors }) => {
    await open()
    await page.click('[data-testid=edit-profile-personal]')
    assert.equal(await page.locator('[data-testid=input-profile-personal-birth_year]').count(), 0, 'the birth year is not in the form')
    assert.match(await text(page, '[data-testid=profile-hr-only-birth-year]'), /Birth year is set by HR\. Ask HR to change this\./)
    await page.fill('[data-testid=input-profile-personal-preferred_name]', 'Carlita')
    await page.click('[data-testid=save-profile-personal]')
    await page.waitForSelector('[data-testid=profile-saved-personal]')
    assert.deepEqual(mock.state.newApi.selfPatches.at(-1), { profile: { personal: { preferred_name: 'Carlita' } } })
    assert.match(await text(page, '[data-testid=profile-saved-personal]'), /Personal saved\./)
    assert.match(await text(page, '[data-testid=fact-profile-personal-preferred_name]'), /Carlita/)
    // saving without a change closes the form and sends nothing
    const before = mock.state.newApi.selfPatches.length
    await page.click('[data-testid=edit-profile-contact]')
    await page.click('[data-testid=save-profile-contact]')
    await page.waitForSelector('[data-testid=profile-facts-contact]')
    assert.equal(mock.state.newApi.selfPatches.length, before)
    // Cancel discards
    await page.click('[data-testid=edit-profile-emergency_contact]')
    await page.fill('[data-testid=input-profile-emergency_contact-name]', 'Someone Else')
    await page.click('[data-testid=cancel-profile-emergency_contact]')
    assert.match(await text(page, '[data-testid=fact-profile-emergency_contact-name]'), /Ana Aquino/)
    assert.equal(mock.state.newApi.selfPatches.length, before)
    assert.deepEqual(errors, [])
  }))

test('my profile: government IDs start empty with "Enter to replace"; only typed keys are sent; Clear sends null; the card shows them masked again', opts, () =>
  withMy(CARLA, async ({ page, mock, open }) => {
    await open()
    await page.click('[data-testid=edit-profile-statutory]')
    const sss = page.locator('[data-testid=input-profile-statutory-sss]')
    assert.equal(await sss.inputValue(), '')
    assert.equal(await sss.getAttribute('placeholder'), 'Enter to replace')
    assert.equal(await sss.getAttribute('type'), 'text')
    assert.equal(await sss.getAttribute('inputmode'), 'numeric')
    assert.equal(await sss.getAttribute('autocomplete'), 'off')
    assert.match(await text(page, '[data-testid=current-profile-statutory-sss]'), /On file: ••••5678/)
    // nothing typed and nothing cleared: nothing is sent
    const before = mock.state.newApi.selfPatches?.length ?? 0
    await page.click('[data-testid=save-profile-statutory]')
    await page.waitForSelector('[data-testid=profile-facts-statutory]')
    assert.equal(mock.state.newApi.selfPatches?.length ?? 0, before)
    // replace one, clear another
    await page.click('[data-testid=edit-profile-statutory]')
    await sss.fill('99-9999999-9')
    await page.click('[data-testid=clear-profile-statutory-tin]')
    assert.equal(await page.getAttribute('[data-testid=clear-profile-statutory-tin]', 'aria-pressed'), 'true')
    assert.equal(await page.isDisabled('[data-testid=input-profile-statutory-tin]'), true)
    await page.click('[data-testid=save-profile-statutory]')
    await page.waitForSelector('[data-testid=profile-saved-statutory]')
    assert.deepEqual(mock.state.newApi.selfPatches.at(-1), { profile: { statutory: { sss: '99-9999999-9', tin: null } } })
    const gov = await text(page, '[data-testid=profile-facts-statutory]')
    assert.match(gov, /••••9999/)
    assert.doesNotMatch(gov, /99-9999999-9/)
    assert.match(await text(page, '[data-testid=fact-profile-statutory-tin]'), /Not provided/)
  }))

test('my profile: a value the server refuses is shown on its field; an HR-only field answers "Ask HR to change this."; typed data is kept', opts, () =>
  withMy(CARLA, async ({ page, mock, open }) => {
    await open()
    await page.click('[data-testid=edit-profile-contact]')
    await page.fill('[data-testid=input-profile-contact-mobile]', '12')
    await page.click('[data-testid=save-profile-contact]')
    await page.waitForSelector('[data-testid=field-profile-contact-mobile-error]')
    assert.match(await text(page, '[data-testid=field-profile-contact-mobile-error]'), /Mobile number must be 7 to 24 characters/)
    // the server's own refusal of an HR-only key (never sent by this page, but if it ever is)
    await page.fill('[data-testid=input-profile-contact-mobile]', '0917 555 0111')
    mock.state.newApi.patchOnce = { status: 422, body: { detail: 'Ask HR to change this.', code: 'hr_only_field', field_errors: { 'profile.work': 'is set by HR' } } }
    await page.click('[data-testid=save-profile-contact]')
    await page.waitForSelector('[data-testid=profile-error-contact]')
    assert.match(await text(page, '[data-testid=profile-error-contact]'), /^Ask HR to change this\.$/)
    assert.equal(await page.inputValue('[data-testid=input-profile-contact-mobile]'), '0917 555 0111')
    // and a plain server error keeps the form open
    mock.state.newApi.forceStatus.profilePatch = 500
    await page.click('[data-testid=save-profile-contact]')
    await page.waitForSelector('[data-testid=profile-error-contact]')
    assert.match(await text(page, '[data-testid=profile-error-contact]'), /could not be saved|went wrong/i)
  }))

test('my profile: a person with nothing on file sees Not provided and no errors; the edit buttons still work', opts, () =>
  withMy(BEN, async ({ page, open, errors }) => {
    await open()
    assert.match(await text(page, '[data-testid=fact-profile-personal-preferred_name]'), /Not provided/)
    assert.match(await text(page, '[data-testid=fact-profile-statutory-tin]'), /Not provided/)
    await page.click('[data-testid=edit-profile-statutory]')
    assert.equal(await page.locator('[data-testid=clear-profile-statutory-tin]').count(), 0, 'nothing on file: nothing to clear')
    assert.deepEqual(errors, [])
  }))

test('responsive: the My Profile edit forms fit at every width with 44px targets on phones', opts, async () => {
  for (const width of [1440, 1024, 768, 390, 320]) {
    await withMy(CARLA, async ({ page, open }) => {
      await open()
      assert.ok(await noOverflow(page), `my profile overflows at ${width}`)
      for (const s of ['personal', 'contact', 'statutory']) {
        await page.click(`[data-testid=edit-profile-${s}]`)
        await page.waitForSelector(`[data-testid=profile-form-${s}]`)
        assert.ok(await noOverflow(page), `${s} form overflows at ${width}`)
        if (width <= 768) {
          const small = await page.$$eval(`[data-testid=profile-form-${s}] .btn, [data-testid=profile-form-${s}] .pm-input`, (els) => els.filter((e) => e.getBoundingClientRect().height < 43).length)
          assert.equal(small, 0, `${s} targets under 44px at ${width}`)
        }
        await page.click(`[data-testid=cancel-profile-${s}]`)
      }
    }, { viewport: { width, height: width >= 1024 ? 900 : 800 } })
  }
})
