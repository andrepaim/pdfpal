import { type ChangeEvent, type Ref } from 'react'
import type { AgentModel } from '../hooks/useAgentModels'
import './ModelSelect.css'

interface Props {
  label: string
  value: string | undefined
  models: AgentModel[]
  onChange: (model: string) => void
  defaultOption?: string
  placeholder?: string
  allowUnlisted?: boolean
  onCustom?: () => void
  disabled?: boolean
  className?: string
  ref?: Ref<HTMLSelectElement>
}

const customOption = ':enter model id:'
const placeholderOption = ':choose model:'

export default function ModelSelect({
  label, value, models, onChange, defaultOption, placeholder = 'Choose a model',
  allowUnlisted = true, onCustom, disabled, className, ref,
}: Props) {
  const listed = models.some(model => model.id === value)
  const showUnlisted = allowUnlisted && !!value && !listed
  const fallback = defaultOption ? placeholderOption : ''
  const selected = listed || showUnlisted || (value === '' && !!defaultOption) ? value : fallback

  function change(event: ChangeEvent<HTMLSelectElement>) {
    if (event.target.value === customOption) {
      event.target.value = selected ?? fallback
      onCustom?.()
    } else {
      onChange(event.target.value)
    }
  }

  return <select ref={ref} aria-label={label} className={className ? `agent-model-select ${className}` : 'agent-model-select'}
    disabled={disabled} value={selected} onChange={change}>
    {selected === fallback && <option value={fallback} disabled>{placeholder}</option>}
    {defaultOption && <option value="">{defaultOption}</option>}
    {showUnlisted && <option value={value}>{value}</option>}
    {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    {onCustom && <option value={customOption}>Enter a model ID…</option>}
  </select>
}
