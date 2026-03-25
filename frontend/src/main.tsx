import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LoginPage from './components/LoginPage.tsx'

function Root() {
  const [user, setUser] = useState<{ email: string; name: string; picture: string } | null | undefined>(undefined)

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data))
      .catch(() => setUser(null))
  }, [])

  if (user === undefined) {
    // Loading — blank screen briefly
    return <div style={{ height: '100vh', background: '#0f0f0f' }} />
  }

  if (!user) return <LoginPage />
  return <App user={user} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
