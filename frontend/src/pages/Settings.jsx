import { useState, useEffect } from 'react'
import { api } from '../api'

const PLATFORM_FIELDS = {
  farcaster: [
    { key: 'apiKey', label: 'Neynar API Key', type: 'password' },
    { key: 'signerUuid', label: 'Signer UUID', type: 'text' },
  ],
  twitter: [
    { key: 'authToken', label: 'AUTH_TOKEN cookie', type: 'password' },
    { key: 'ct0', label: 'CT0 cookie', type: 'password' },
  ],
  linkedin: [
    { key: 'accessToken', label: 'Access Token', type: 'password' },
  ],
  threads: [
    { key: 'accessToken', label: 'Meta Access Token', type: 'password' },
    { key: 'userId', label: 'User ID', type: 'text' },
  ],
  instagram: [
    { key: 'accessToken', label: 'Meta Access Token', type: 'password' },
    { key: 'userId', label: 'User ID', type: 'text' },
  ],
}

export default function Settings() {
  const [platforms, setPlatforms] = useState([])
  const [types, setTypes] = useState([])
  const [adding, setAdding] = useState(false)
  const [newPlatform, setNewPlatform] = useState({ type: 'farcaster', name: '', credentials: {} })
  const [testResults, setTestResults] = useState({})

  const load = async () => {
    try {
      const [p, t] = await Promise.all([api.getPlatforms(), api.getPlatformTypes()])
      setPlatforms(p)
      setTypes(t)
    } catch {}
  }

  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!newPlatform.name) return
    try {
      await api.addPlatform(newPlatform)
      setAdding(false)
      setNewPlatform({ type: 'farcaster', name: '', credentials: {} })
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Remove this platform?')) return
    await api.deletePlatform(id)
    load()
  }

  const handleTest = async (id) => {
    setTestResults(prev => ({ ...prev, [id]: 'testing...' }))
    try {
      const result = await api.testPlatform(id)
      setTestResults(prev => ({ ...prev, [id]: result.valid ? 'Connected!' : result.error }))
    } catch (err) {
      setTestResults(prev => ({ ...prev, [id]: err.message }))
    }
  }

  const fields = PLATFORM_FIELDS[newPlatform.type] || []

  return (
    <div>
      <h1 className="page-title">Settings</h1>

      <div className="flex-between mb-16">
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-bright)' }}>
          Connected Platforms ({platforms.length})
        </h3>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Add platform'}
        </button>
      </div>

      {adding && (
        <div className="card mb-16">
          <div className="form-group">
            <label className="label">Platform</label>
            <select
              className="select"
              value={newPlatform.type}
              onChange={e => setNewPlatform({ type: e.target.value, name: '', credentials: {} })}
            >
              {types.map(t => (
                <option key={t.type} value={t.type}>
                  {t.type.charAt(0).toUpperCase() + t.type.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Display name</label>
            <input
              className="input"
              placeholder="e.g. @dave on Farcaster"
              value={newPlatform.name}
              onChange={e => setNewPlatform(p => ({ ...p, name: e.target.value }))}
            />
          </div>
          {fields.map(f => (
            <div key={f.key} className="form-group">
              <label className="label">{f.label}</label>
              <input
                className="input"
                type={f.type}
                placeholder={f.label}
                value={newPlatform.credentials[f.key] || ''}
                onChange={e => setNewPlatform(p => ({
                  ...p,
                  credentials: { ...p.credentials, [f.key]: e.target.value }
                }))}
              />
            </div>
          ))}
          <button className="btn btn-primary" onClick={handleAdd}>
            Add {newPlatform.type}
          </button>
        </div>
      )}

      {platforms.length === 0 && !adding && (
        <div className="empty">
          <div className="empty-text">No platforms connected yet. Click "Add platform" to get started.</div>
        </div>
      )}

      {platforms.map(p => (
        <div key={p.id} className="card">
          <div className="flex-between">
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-bright)', fontSize: 14 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                {p.type} &middot; {p.id}
              </div>
            </div>
            <div className="flex gap-8">
              <button className="btn btn-secondary btn-sm" onClick={() => handleTest(p.id)}>
                Test
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}>
                Remove
              </button>
            </div>
          </div>
          {testResults[p.id] && (
            <div style={{
              marginTop: 8,
              fontSize: 12,
              color: testResults[p.id] === 'Connected!' ? 'var(--success)' : testResults[p.id] === 'testing...' ? 'var(--text-dim)' : 'var(--danger)',
            }}>
              {testResults[p.id]}
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: 40, fontSize: 12, color: 'var(--text-dim)' }}>
        Net v1.0.0
      </div>
    </div>
  )
}
