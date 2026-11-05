import { test, expect } from '@playwright/test'
import { mockAuth, createProjectViaApi } from './helpers'

test.beforeEach(async ({ page }) => {
  await mockAuth(page)
  await page.addInitScript(() => {
    window.prompt = () => { throw new Error('prompt() is not supported in the desktop app') }
  })
})

test('creates root and nested collections without native prompts and persists them', async ({ page }) => {
  const project = await createProjectViaApi(page, 'Collection creation')
  await page.goto(`/projects/${project.id}`)
  const create = page.getByRole('button', { name: /New Collection/ })
  await create.click()
  const dialog = page.getByRole('dialog', { name: 'New collection', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Collection name')).toBeFocused()
  await dialog.getByLabel('Collection name').fill('  Main papers 🧪  ')
  await dialog.getByLabel('Collection name').press('Enter')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('Main papers 🧪', { exact: true })).toBeVisible()

  await page.getByTitle('New sub-collection', { exact: true }).click()
  const nested = page.getByRole('dialog', { name: 'New sub-collection', exact: true })
  await expect(nested.getByText('Inside Main papers 🧪', { exact: true })).toBeVisible()
  await nested.getByLabel('Collection name').fill('Methods')
  await nested.getByRole('button', { name: 'Create collection', exact: true }).click()
  await expect(nested).not.toBeVisible()
  await expect(page.getByText('Methods', { exact: true })).toBeVisible()

  const collections = await (await page.request.get(`/api/projects/${project.id}/collections`)).json()
  expect(collections).toHaveLength(2)
  const parent = collections.find((item: { name: string }) => item.name === 'Main papers 🧪')
  expect(parent.parent_id).toBeNull()
  expect(collections.find((item: { name: string }) => item.name === 'Methods').parent_id).toBe(parent.id)
  await page.reload()
  await expect(page.getByText('Main papers 🧪', { exact: true })).toBeVisible()
  await expect(page.getByText('Methods', { exact: true })).toBeVisible()
})

test('keeps failed collection input for retry and cancels without creating anything', async ({ page }) => {
  const project = await createProjectViaApi(page, 'Collection error handling')
  const endpoint = `**/api/projects/${project.id}/collections`
  let posts = 0
  await page.route(endpoint, async route => {
    if (route.request().method() === 'POST' && ++posts === 1) {
      await route.fulfill({ status: 503, json: { detail: 'Collection service unavailable. Try again.' } })
    } else await route.continue()
  })
  await page.goto(`/projects/${project.id}`)
  const create = page.getByRole('button', { name: /New Collection/ })
  const dialog = page.getByRole('dialog', { name: 'New collection', exact: true })
  await create.click()
  await dialog.getByLabel('Collection name').fill('   ')
  await expect(dialog.getByRole('button', { name: 'Create collection' })).toBeDisabled()
  await dialog.getByLabel('Collection name').fill('Keep this name')
  await dialog.getByRole('button', { name: 'Create collection' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Collection service unavailable. Try again.')
  await expect(dialog.getByLabel('Collection name')).toHaveValue('Keep this name')
  await dialog.getByRole('button', { name: 'Create collection' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('Keep this name', { exact: true })).toBeVisible()
  expect(posts).toBe(2)

  await create.click()
  await dialog.getByLabel('Collection name').fill('Cancel with Escape')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(create).toBeFocused()
  await create.click()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(posts).toBe(2)
  expect(await (await page.request.get(`/api/projects/${project.id}/collections`)).json()).toHaveLength(1)
})
