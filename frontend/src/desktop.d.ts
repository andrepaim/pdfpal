export interface DesktopUpdateState { state: 'idle' | 'available' | 'current' | 'unpublished' | 'error'; currentVersion: string; distribution?: string; version?: string; publisher?: string; notes?: string; message?: string }
export interface DesktopAssistant {
  id: string; label: string; available: boolean; state?: string; version?: string; auth?: string; testedAt?: string
}
export interface DesktopSetupState { default: string; explicit?: boolean; complete: boolean; agents: DesktopAssistant[] }
export interface DesktopServiceState { state: 'starting' | 'ready' | 'failed'; interrupted?: boolean }

declare global {
  interface Window {
    pdfpalFlushPending?: () => Promise<void>
    pdfpalDesktop?: {
      updatesState?(): Promise<DesktopUpdateState>
      checkUpdates?(): Promise<DesktopUpdateState>
      downloadUpdate?(): Promise<boolean>
      releaseNotes?(): Promise<boolean>
      openLicenses?(): Promise<boolean>
      onOpenUpdates?(callback: () => void): () => void
      setupStatus?(): Promise<{ complete: boolean }>
      setupState?(): Promise<DesktopSetupState>
      completeSetup?(): Promise<boolean>
      setupAction?(agent: string, action: 'install' | 'login' | 'docs'): Promise<void>
      chooseBinary?(agent: string): Promise<boolean>
      testConnection?(agent: string): Promise<{ at: string }>
      cancelTest?(): Promise<boolean>
      serviceState?(): Promise<DesktopServiceState>
      onServiceState?(callback: (state: DesktopServiceState) => void): () => void
      retryService?(): Promise<boolean>
      diagnostics?(): Promise<unknown>
      exportDiagnostics?(): Promise<boolean>
      onOpenDiagnostics?(callback: () => void): () => void
      setAgent(agent: string): Promise<string>
      onOpenAISettings?(callback: () => void): () => void
      onAgentChanged(callback: (agent: string) => void): () => void
    }
  }
}
