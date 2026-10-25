import { Link, useParams } from 'react-router-dom'
import VisualExplanation from '../components/VisualExplanation'
import { webVisualTransport } from '../lib/visual-api'

export default function VisualPage() {
  const { projectId, id } = useParams<{ projectId: string; id: string }>()
  if (!projectId || !id) return null
  return <main className="visual-page"><Link to={`/projects/${projectId}`}>← Project</Link>
    <VisualExplanation key={id} id={id} transport={webVisualTransport(projectId)} />
  </main>
}
