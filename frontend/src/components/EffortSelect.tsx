import './ModelSelect.css'

interface Props {
  efforts?: readonly string[]
  defaultEffort?: string
  inheritedEffort?: string
  value: string | undefined
  onChange: (effort: string | undefined) => void
  disabled?: boolean
  className?: string
  includeDefault?: boolean
  label?: string
  showLabel?: boolean
}

const inherited = ':default:'
const effortLabel = (effort: string) => effort === 'xhigh' ? 'Extra high' : effort.charAt(0).toUpperCase() + effort.slice(1)

export default function EffortSelect({
  efforts, defaultEffort, inheritedEffort, value, onChange, disabled, className, includeDefault,
  label = 'Reasoning effort', showLabel,
}: Props) {
  const options = [...new Set(efforts)]
  if (options.length < 2) return null

  const automatic = defaultEffort && options.includes(defaultEffort) ? `Automatic (${effortLabel(defaultEffort)})` : 'Automatic'
  const useDefault = inheritedEffort && options.includes(inheritedEffort) ? `Use default (${effortLabel(inheritedEffort)})` : 'Use default'
  const selected = value && options.includes(value) ? value : value === '' || !includeDefault ? '' : inherited
  const select = <select aria-label={label} title={showLabel ? undefined : label} className={className ? `agent-effort-select ${className}` : 'agent-effort-select'}
    disabled={disabled} value={selected} onChange={event => onChange(event.target.value === inherited ? undefined : event.target.value)}>
    {includeDefault && <option value={inherited}>{useDefault}</option>}
    <option value="">{automatic}</option>
    {options.map(effort => <option key={effort} value={effort}>{effortLabel(effort)}</option>)}
  </select>

  return showLabel ? <label>{label}{select}</label> : select
}
