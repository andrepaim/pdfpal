export {}
declare global {
  interface Window {
    pdfpalFlushPending?: () => Promise<void>
    pdfpalDesktop?: {
      setAgent(agent: string): Promise<string>
      onAgentChanged(callback: (agent: string) => void): () => void
    }
  }
}
