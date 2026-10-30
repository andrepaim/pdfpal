import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { PdfpalError } from './types.js'

const servers = new Set<string>()

export function databasePath(filename: string): string {
  const absolute = path.resolve(filename)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  return fs.existsSync(absolute) ? fs.realpathSync.native(absolute) : path.join(fs.realpathSync.native(path.dirname(absolute)), path.basename(absolute))
}

/** A separate SQLite file provides an OS-released lease without locking user data. */
export function acquireLease(filename: string, timeout = 0): () => void {
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  const db = new Database(filename, { timeout })
  try { db.exec('BEGIN IMMEDIATE') }
  catch (error) { db.close(); throw error }
  let released = false
  return () => { if (!released) { released = true; db.exec('ROLLBACK'); db.close() } }
}

export function acquireServerLease(dbPath: string): () => void {
  const key = databasePath(dbPath)
  if (servers.has(key)) throw new PdfpalError('SERVER_ALREADY_RUNNING', 'pdfpal is already serving this library.')
  let release: () => void
  try { release = acquireLease(`${key}.server-lock`) }
  catch { throw new PdfpalError('SERVER_ALREADY_RUNNING', 'Another pdfpal server is using this library. Close it and retry, or open it in your browser.') }
  servers.add(key)
  let released = false
  return () => { if (!released) { released = true; servers.delete(key); release() } }
}

export function assertMigrationAllowed(dbPath: string): void {
  const key = databasePath(dbPath)
  if (servers.has(key)) return
  try { acquireLease(`${key}.server-lock`)() }
  catch { throw new PdfpalError('STOP_SERVER_TO_UPGRADE', 'Close the running pdfpal server before upgrading this library.') }
}
