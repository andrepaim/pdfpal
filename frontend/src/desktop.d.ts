export {}
declare global {
  interface Window {
    pdfpalFlushPending?: () => Promise<void>
    pdfpalDesktop?: {
      setAgent(agent: string): Promise<string>
      onOpenAISettings?(callback: () => void): () => void
      onAgentChanged(callback: (agent: string) => void): () => void
    }
  }
}
