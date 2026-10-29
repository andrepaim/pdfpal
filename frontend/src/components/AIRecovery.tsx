export default function AIRecovery() {
  if (!window.pdfpalDesktop) return null
  return <button type="button" className="ai-recovery-link" onClick={() => window.dispatchEvent(new Event('pdfpal-open-ai-settings'))}>AI settings</button>
}
