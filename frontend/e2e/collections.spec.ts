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

test('sorts paper groups independently and remembers each choice across reloads', async ({ page }) => {
  const project = await createProjectViaApi(page, 'Collection sorting')
  const otherProject = await createProjectViaApi(page, 'Unfiled only')
  const created = await page.request.post(`/api/projects/${project.id}/collections`, { data: { name: 'Root papers' } })
  expect(created.ok()).toBeTruthy()
  const root = await created.json()
  const nestedCreated = await page.request.post(`/api/projects/${project.id}/collections`, {
    data: { name: 'Nested papers', parent_id: root.id },
  })
  expect(nestedCreated.ok()).toBeTruthy()
  const nested = await nestedCreated.json()

  const source = (id: string, collection_id: string | null, month: number, title?: string, url?: string) => ({
    id, collection_id, title, url, type: 'pdf', pages: 2, project_id: project.id,
    created_at: `2025-0${month}-01T12:00:00.000Z`, accessed_at: '2025-09-01T12:00:00.000Z',
  })
  const unfiled = [source('alpha-unfiled', null, 1, 'Alpha unfiled'), source('zulu-unfiled', null, 2, 'Zulu unfiled')]
  await page.route(`**/api/projects/${project.id}/sources`, route => route.fulfill({ json: [
    source('alpha-root', root.id, 1, 'Alpha root'),
    source('bravo-root', root.id, 3, 'Bravo root'),
    source('charlie-root', root.id, 2, 'Charlie root'),
    source('fallback-url', nested.id, 1, undefined, 'https://example.com/fallback'),
    source('untitled', nested.id, 3),
    source('zulu-nested', nested.id, 2, 'Zulu nested'),
    ...unfiled,
  ] }))
  await page.route(`**/api/projects/${otherProject.id}/sources`, route => route.fulfill({
    json: unfiled.map(paper => ({ ...paper, project_id: otherProject.id })),
  }))

  await page.goto(`/projects/${project.id}`)
  const rootPapers = page.getByText(/^(Alpha|Bravo|Charlie) root$/)
  const nestedPapers = page.getByText(/^(Zulu nested|Untitled|https:\/\/example\.com\/fallback)$/)
  const unfiledPapers = page.getByText(/^(Alpha|Zulu) unfiled$/)
  const rootSort = page.getByRole('combobox', { name: 'Sort papers in Root papers' })
  const nestedSort = page.getByRole('combobox', { name: 'Sort papers in Nested papers' })
  const unfiledSort = page.getByRole('combobox', { name: 'Sort papers in Unfiled' })

  await expect(rootPapers).toHaveText(['Bravo root', 'Charlie root', 'Alpha root'])
  await expect(nestedPapers).toHaveText(['Untitled', 'Zulu nested', 'https://example.com/fallback'])
  await expect(unfiledPapers).toHaveText(['Zulu unfiled', 'Alpha unfiled'])
  await expect(rootSort).toBeVisible()
  await rootSort.selectOption({ label: 'Oldest added' })
  await expect(rootPapers).toHaveText(['Alpha root', 'Charlie root', 'Bravo root'])
  await rootSort.selectOption({ label: 'Title Z–A' })
  await expect(rootPapers).toHaveText(['Charlie root', 'Bravo root', 'Alpha root'])
  await rootSort.selectOption({ label: 'Newest added' })
  await expect(rootPapers).toHaveText(['Bravo root', 'Charlie root', 'Alpha root'])
  await rootSort.selectOption({ label: 'Title A–Z' })
  await nestedSort.selectOption({ label: 'Title Z–A' })
  await unfiledSort.selectOption({ label: 'Oldest added' })

  await page.getByRole('button', { name: /Collapse All/ }).click()
  await expect(page.getByText('Nested papers', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: /Expand All/ }).click()
  await expect(rootPapers).toHaveText(['Alpha root', 'Bravo root', 'Charlie root'])
  await expect(nestedPapers).toHaveText(['Zulu nested', 'Untitled', 'https://example.com/fallback'])
  await expect(unfiledPapers).toHaveText(['Alpha unfiled', 'Zulu unfiled'])

  await page.reload()
  await expect(rootSort.locator('option:checked')).toHaveText('Title A–Z')
  await expect(nestedSort.locator('option:checked')).toHaveText('Title Z–A')
  await expect(unfiledSort.locator('option:checked')).toHaveText('Oldest added')
  await expect(rootPapers).toHaveText(['Alpha root', 'Bravo root', 'Charlie root'])
  await expect(nestedPapers).toHaveText(['Zulu nested', 'Untitled', 'https://example.com/fallback'])
  await expect(unfiledPapers).toHaveText(['Alpha unfiled', 'Zulu unfiled'])

  const secondWindow = await page.context().newPage()
  await mockAuth(secondWindow)
  await secondWindow.goto(`/projects/${project.id}`)
  await secondWindow.getByRole('combobox', { name: 'Sort papers in Nested papers' }).selectOption({ label: 'Title A–Z' })
  await secondWindow.close()
  await rootSort.selectOption({ label: 'Oldest added' })
  await page.reload()
  await expect(rootSort.locator('option:checked')).toHaveText('Oldest added')
  await expect(nestedSort.locator('option:checked')).toHaveText('Title A–Z')
  await expect(unfiledSort.locator('option:checked')).toHaveText('Oldest added')

  await page.getByRole('button', { name: /All projects/ }).click()
  await page.getByText(otherProject.title, { exact: true }).click()
  await expect(unfiledSort.locator('option:checked')).toHaveText('Newest added')
  await expect(unfiledPapers).toHaveText(['Zulu unfiled', 'Alpha unfiled'])

  const url = 'https://example.com/imported.pdf'
  await page.route('**/api/extract', route => route.fulfill({ json: {
    ...source('imported', null, 1, 'Imported paper', url),
    project_id: otherProject.id,
    created_at: '2025-01-15T12:00:00.000Z',
  } }))
  await page.getByRole('button', { name: /Add Source/ }).click()
  await page.getByRole('button', { name: 'Paste URL' }).click()
  await page.getByPlaceholder('https://arxiv.org/abs/1234.56789').fill(url)
  await page.getByRole('button', { name: 'Add Source', exact: true }).click()
  await expect(page.getByText(/^(Alpha unfiled|Zulu unfiled|Imported paper)$/))
    .toHaveText(['Zulu unfiled', 'Imported paper', 'Alpha unfiled'])
})

test('resorts after renaming and moving papers and keeps order when reparenting a collection', async ({ page }) => {
  const project = await createProjectViaApi(page, 'Sorting after edits')
  const projectApi = `/api/projects/${project.id}`
  const createCollection = async (name: string, parent_id?: string) => {
    const response = await page.request.post(`${projectApi}/collections`, { data: { name, parent_id } })
    expect(response.ok()).toBeTruthy()
    return response.json()
  }
  const shelf = await createCollection('Shelf')
  const secondShelf = await createCollection('Second shelf')
  const folder = await createCollection('Folder', shelf.id)
  for (const [title, collection_id] of [['Delta paper', folder.id], ['Echo paper', folder.id], ['Bravo paper', undefined], ['Charlie paper', undefined]]) {
    const response = await page.request.post(`${projectApi}/sources`, {
      data: { url: 'test/fixtures/sample.pdf', title, collection_id },
    })
    expect(response.ok()).toBeTruthy()
  }

  await page.goto(`/projects/${project.id}`)
  const folderSort = page.getByRole('combobox', { name: 'Sort papers in Folder' })
  await expect(folderSort).toBeVisible()
  await folderSort.selectOption({ label: 'Title A–Z' })
  await page.getByRole('combobox', { name: 'Sort papers in Unfiled' }).selectOption({ label: 'Title Z–A' })
  const row = (title: string) => page.locator('[draggable="true"]').filter({ has: page.getByText(title, { exact: true }) })
  const papers = page.getByText(/^(Alpha|Bravo|Charlie|Delta|Echo) paper$/)
  await expect(papers).toHaveText(['Delta paper', 'Echo paper', 'Charlie paper', 'Bravo paper'])

  await row('Echo paper').getByTitle('Rename', { exact: true }).click()
  const editor = page.getByRole('textbox')
  await editor.fill('Alpha paper')
  await editor.press('Enter')
  await expect(papers).toHaveText(['Alpha paper', 'Delta paper', 'Charlie paper', 'Bravo paper'])

  await row('Charlie paper').dragTo(row('Folder'))
  await expect(papers).toHaveText(['Alpha paper', 'Charlie paper', 'Delta paper', 'Bravo paper'])
  await row('Alpha paper').dragTo(page.getByText('Unfiled · 1', { exact: true }))
  await expect(papers).toHaveText(['Charlie paper', 'Delta paper', 'Bravo paper', 'Alpha paper'])
  await expect(page.getByText('Unfiled · 2', { exact: true })).toBeVisible()

  await row('Folder').dragTo(row('Second shelf'))
  await expect.poll(async () => {
    const response = await page.request.get(`${projectApi}/collections`)
    const collections = await response.json()
    return collections.find((collection: { id: string }) => collection.id === folder.id)?.parent_id
  }).toBe(secondShelf.id)
  await expect(folderSort.locator('option:checked')).toHaveText('Title A–Z')
  await expect(papers).toHaveText(['Charlie paper', 'Delta paper', 'Bravo paper', 'Alpha paper'])
})
