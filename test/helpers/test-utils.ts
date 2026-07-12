import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadConfig, type PdfpalConfig } from '../../src/core/config.js'
import { openDatabase } from '../../src/core/database.js'
import type Database from 'better-sqlite3'

export function testConfig(): PdfpalConfig {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-test-'))
  return loadConfig({ dataDir, port: 18299, host: '127.0.0.1', agent: 'claude', model: '', claudeBin: 'claude', codexBin: 'codex', opencodeBin: 'opencode' })
}

export function testDb(config: PdfpalConfig): Database.Database {
  return openDatabase(config)
}

export function cleanup(config: PdfpalConfig, db: Database.Database): void {
  db.close()
  fs.rmSync(config.dataDir, { recursive: true, force: true })
}

export function createProject(db: Database.Database, title = `Project ${randomUUID()}`): string {
  const id = randomUUID(), now = new Date().toISOString()
  db.prepare('INSERT INTO projects(id,title,description,created_at,accessed_at) VALUES (?,?,?,?,?)').run(id, title, '', now, now)
  return id
}

export function createSource(db: Database.Database, projectId: string, text = '[Page 1]\nA useful research passage about testing.'): string {
  const id = randomUUID(), now = new Date().toISOString()
  db.prepare('INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?)').run(id, projectId, 'pdf', 'Test Source', text, 1, now, now)
  return id
}
