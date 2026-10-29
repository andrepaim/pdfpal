export {}
declare global {
  interface Window {
    pdfpalDesktop?: {
      setAgent(agent: string): Promise<string>
      onAgentChanged(callback: (agent: string) => void): () => void
    }
  }
}
