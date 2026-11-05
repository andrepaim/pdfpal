import { useEffect, useRef } from 'react'

export function useLibraryChanges(refresh: () => unknown) {
  const current = useRef(refresh)
  current.current = refresh
  useEffect(() => {
    const listener = () => { void Promise.resolve().then(() => current.current()).catch(() => {}) }
    window.addEventListener('pdfpal:library-changed', listener)
    return () => window.removeEventListener('pdfpal:library-changed', listener)
  }, [])
}
