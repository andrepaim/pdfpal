export const MAX_AGENT_MODEL_LENGTH = 200
export const AGENT_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._/+@:[\]-]*$/i

export function isCustomAgentModel(model: string): boolean {
  return model.length <= MAX_AGENT_MODEL_LENGTH && AGENT_MODEL_ID_PATTERN.test(model)
}
