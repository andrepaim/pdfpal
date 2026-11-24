import { useRef, useState } from 'react'
import { isCustomAgentModel, MAX_AGENT_MODEL_LENGTH, type AgentModel } from '../hooks/useAgentModels'
import EffortSelect from './EffortSelect'
import ModelSelect from './ModelSelect'

interface Props {
  assistant: string
  models: AgentModel[]
  value: string | undefined
  effort: string | undefined
  loading: boolean
  error: string | undefined
  disabled: boolean
  onChange: (model: string) => void
  onEffortChange: (effort: string) => void
}

export default function AgentDefaultModel({ assistant, models, value, effort, loading, error, disabled, onChange, onEffortChange }: Props) {
  const select = useRef<HTMLSelectElement>(null)
  const [customModel, setCustomModel] = useState<string>()
  const customValue = customModel?.trim() ?? ''
  const valid = isCustomAgentModel(customValue)
  const model = models.find(item => item.id === value)
  const closeEditor = () => {
    setCustomModel(undefined)
    select.current?.focus()
  }
  const apply = () => {
    if (!valid) return
    onChange(customValue)
    closeEditor()
  }

  return <div className="ai-settings-model">
    <div className="ai-settings-provider-fields">
      <label>Default model
        <ModelSelect ref={select} label={`${assistant} default model`} models={models} value={value} disabled={disabled}
          defaultOption="Automatic" placeholder={loading ? 'Loading models…' : 'Choose a model'}
          onChange={next => { onChange(next); setCustomModel(undefined) }}
          onCustom={() => setCustomModel(value && !model ? value : '')} />
      </label>
      {customModel === undefined && <EffortSelect label="Default reasoning effort" showLabel efforts={model?.efforts}
        defaultEffort={model?.defaultEffort} value={effort} disabled={disabled} onChange={next => onEffortChange(next ?? '')} />}
    </div>
    {customModel !== undefined && <div className="ai-settings-model-editor">
      <label>Model ID
        <input type="text" value={customModel} autoFocus maxLength={MAX_AGENT_MODEL_LENGTH} disabled={disabled}
          aria-invalid={!!customValue && !valid}
          onChange={event => setCustomModel(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); apply() }
          }} />
      </label>
      <button type="button" disabled={disabled || !valid} onClick={apply}>Apply model</button>
      <button type="button" disabled={disabled} onClick={closeEditor} aria-label="Cancel model entry">Cancel</button>
    </div>}
    {!!customValue && !valid && <p className="ai-settings-model-status" role="status">Enter a valid model ID.</p>}
    {error && <p className="ai-settings-model-status" role="status">{error}</p>}
  </div>
}
