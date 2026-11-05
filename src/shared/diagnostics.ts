import {z} from 'zod'
// This schema is the complete cloud payload: no free-form text, paths or content.
export const diagnosticCodes=['SYNC_FAILED','SYNC_QUOTA','SYNC_COMPLETED','PDF_SYNC_FAILED','BACKUP_FAILED','RESTORE_FAILED','AI_FAILED','SERVER_ERROR','RENDERER_CRASH','BACKEND_STOPPED','START_FAILED','PREFERENCES_FAILED'] as const
export const diagnosticCode=z.enum(diagnosticCodes)
export const diagnosticReport=z.object({format:z.literal(1),code:diagnosticCode,appVersion:z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?$/).max(64),platform:z.enum(['win32','linux','darwin','unknown']),at:z.number().int().nonnegative(),durationMs:z.number().int().min(0).max(3600000)}).strict()
export type DiagnosticReport=z.infer<typeof diagnosticReport>
