import { z } from 'zod'

const explicitReasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
export const reasoningEffortSchema = z.union([z.literal(''), explicitReasoningEffortSchema])
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>

const capabilitySchema = z.object({
  supported_reasoning_levels: z.array(z.unknown()),
  default_reasoning_level: z.unknown().optional(),
})
const levelSchema = z.object({ effort: explicitReasoningEffortSchema })

export function parseEffortCapabilities(rawModel: unknown): { efforts?: string[]; defaultEffort?: string } {
  const parsed = capabilitySchema.safeParse(rawModel)
  if (!parsed.success) return {}
  const { supported_reasoning_levels, default_reasoning_level } = parsed.data
  const efforts = [...new Set(supported_reasoning_levels.flatMap(level => {
    const result = levelSchema.safeParse(level)
    return result.success ? [result.data.effort] : []
  }))]
  if (!efforts.length) return {}

  const defaultEffort = explicitReasoningEffortSchema.safeParse(default_reasoning_level)
  return defaultEffort.success && efforts.includes(defaultEffort.data) ? { efforts, defaultEffort: defaultEffort.data } : { efforts }
}
