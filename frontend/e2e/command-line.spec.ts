import { test, expect } from '@playwright/test'
import { mockAuth, createProjectViaApi, createNoteViaApi } from './helpers'

test('desktop setup distinguishes installed files from a verified ChatGPT request', async ({ page }) => {
  await mockAuth(page)
  await page.addInitScript(() => {
    let installed = false
    window.pdfpalDesktop = {
      chrome: true, setAgent: async id => id, onAgentChanged: () => () => {}, setupStatus: async () => ({ complete: true }),
      cliSetup: async action => {
        if (action === 'install') installed = true
        return { available: true, launcher: 'C:\\pdfpal\\bin\\pdfpal.exe', version: '2.7.0-preview.1', library: 'Fixture library', setupCommand: 'pdfpal skill install',
          skill: { installed, managed: installed, edited: false, directory: 'fixture', legacy: [] }, ...(action === 'check' ? { check: { ok: true } } : {}) }
      },
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'pdfpal menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Command line & ChatGPT' }).click()
  const dialog = page.getByRole('dialog', { name: 'Command line & ChatGPT' })
  await expect(dialog.getByText('Fixture library', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Not installed', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Install skill', exact: true }).click()
  await expect(dialog.getByText('Installed', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Check setup', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Try the example in ChatGPT')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})

test('external library changes refresh project cards without reloading the page', async ({ page }) => {
  await mockAuth(page)
  let revision = 0
  await page.route('**/api/library/revision', route => route.fulfill({ json: { instance: 'fixture', revision } }))
  await page.goto('/')
  await page.evaluate(() => { (window as any).fixturePage = true })
  await expect.poll(() => page.request.get('/api/health').then(r => r.ok())).toBe(true)
  await page.waitForResponse('**/api/library/revision')
  const title = 'Imported through command ' + Date.now()
  await createProjectViaApi(page, title)
  revision++
  await expect(page.getByText(title, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).fixturePage)).toBe(true)
})

test('an external note edit cannot overwrite an open local draft', async ({ page }) => {
  await mockAuth(page)
  const project = await createProjectViaApi(page, 'Concurrent note edits')
  const id = await createNoteViaApi(page, project.id, { title: 'Shared note', content: 'Original' })
  await page.goto(`/projects/${project.id}/notes/${id}`)
  await expect(page.getByPlaceholder('Note title…')).toHaveValue('Shared note')
  await page.getByRole('button', { name: /Edit/ }).click()
  const input = page.getByPlaceholder('Write your notes here… (Markdown supported)')
  await expect(input).toHaveValue('Original')
  await input.fill('My local draft')
  const updated = await page.request.put(`/api/projects/${project.id}/notes/${id}`, { data: { content: 'Changed through CLI' } })
  expect(updated.ok()).toBe(true)
  await expect(page.getByRole('alert')).toContainText('changed elsewhere')
  await expect(input).toHaveValue('My local draft')
  const saved = await (await page.request.get(`/api/projects/${project.id}/notes/${id}`)).json()
  expect(saved.content).toBe('Changed through CLI')
  await page.getByRole('button', { name: 'Save draft as new note', exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(`/notes/${id}$`))
  const notes = await (await page.request.get(`/api/projects/${project.id}/notes`)).json()
  expect(notes).toHaveLength(2)
  const copy = notes.find((note: {id:string}) => note.id !== id)
  expect((await (await page.request.get(`/api/projects/${project.id}/notes/${copy.id}`)).json()).content).toBe('My local draft')
})
