import { parseChatInput } from '../../../src/shared/chat-command'
import './chat-command.css'
import VisualIcon from './VisualIcon'

export default function ChatCommandHint({ input, hasSelection = false, onChoose }: { input: string; hasSelection?: boolean; onChoose: () => void }) {
  if (!input.trimStart().startsWith('/')) return null
  const command = parseChatInput(input, hasSelection)
  if (command.kind !== 'help' && input.trim().toLowerCase() !== '/visual') return null
  return <div className="chat-command-hint" aria-label="Chat commands">
    <button type="button" onMouseDown={event => event.preventDefault()} onClick={onChoose}>
      <span><VisualIcon /><code>/visual</code> <strong>Visual explanation</strong></span>
      <span>{hasSelection ? 'Explain the attached selection, or add a question.' : 'Add a concept: /visual how attention works'}</span>
    </button>
    {command.kind === 'help' && <p role="status">{command.message}</p>}
  </div>
}
