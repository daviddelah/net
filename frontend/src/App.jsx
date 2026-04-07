import { useState, useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import Compose from './pages/Compose'
import Schedule from './pages/Schedule'
import Queue from './pages/Queue'
import History from './pages/History'
import Settings from './pages/Settings'

const PAGES = [
  { id: 'compose', label: 'Compose', icon: '+" ' },
  { id: 'schedule', label: 'Schedule', icon: '""' },
  { id: 'queue', label: 'Queue', icon: '""' },
  { id: 'history', label: 'History', icon: '""' },
  { id: 'settings', label: 'Settings', icon: '""' },
]

export default function App() {
  const [page, setPage] = useState('compose')
  const [refreshKey, setRefreshKey] = useState(0)

  const handleWsMessage = useCallback((data) => {
    if (data.type === 'post_update') {
      setRefreshKey(k => k + 1)
    }
  }, [])

  useWebSocket(handleWsMessage)

  const refresh = () => setRefreshKey(k => k + 1)

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-logo">Net</div>
        {PAGES.map(p => (
          <a
            key={p.id}
            className={`sidebar-link ${page === p.id ? 'active' : ''}`}
            onClick={() => setPage(p.id)}
          >
            {p.label}
          </a>
        ))}
      </nav>
      <main className="main">
        {page === 'compose' && <Compose key={refreshKey} onCreated={refresh} />}
        {page === 'schedule' && <Schedule key={refreshKey} />}
        {page === 'queue' && <Queue key={refreshKey} />}
        {page === 'history' && <History key={refreshKey} />}
        {page === 'settings' && <Settings key={refreshKey} />}
      </main>
    </div>
  )
}
