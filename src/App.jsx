import './App.css'
import { AuthPage } from './pages/AuthPage.jsx'
import { ChatPage } from './pages/ChatPage.jsx'
import { useAuth } from './hooks/useAuth.js'

function App() {
  const { user, initializing } = useAuth()

  if (initializing) {
    return (
      <div className="app-shell">
        <div className="card">
          <h1>Chat</h1>
          <p>Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`app-shell${user ? ' app-shell--chat' : ''}`}>
      {user ? <ChatPage /> : <AuthPage />}
    </div>
  )
}

export default App
