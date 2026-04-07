import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

export default function Compose({ onCreated }) {
  const [body, setBody] = useState('')
  const [platforms, setPlatforms] = useState([])
  const [selectedPlatforms, setSelectedPlatforms] = useState([])
  const [scheduleMode, setScheduleMode] = useState('now') // 'now' | 'schedule' | 'queue'
  const [scheduledAt, setScheduledAt] = useState('')
  const [mediaFiles, setMediaFiles] = useState([])
  const [mediaPreviews, setMediaPreviews] = useState([])
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const fileRef = useRef()

  useEffect(() => {
    api.getPlatforms().then(p => {
      setPlatforms(p)
      setSelectedPlatforms(p.map(pl => pl.id))
    }).catch(() => {})
  }, [])

  const togglePlatform = (id) => {
    setSelectedPlatforms(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files)
    setMediaFiles(prev => [...prev, ...files])
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = (e) => setMediaPreviews(prev => [...prev, e.target.result])
        reader.readAsDataURL(file)
      }
    })
  }

  const removeMedia = (index) => {
    setMediaFiles(prev => prev.filter((_, i) => i !== index))
    setMediaPreviews(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!body.trim()) return
    if (selectedPlatforms.length === 0) { setError('Select at least one platform'); return }

    setPosting(true)
    setError(null)
    setSuccess(null)

    try {
      // Upload media first
      let media = null
      if (mediaFiles.length > 0) {
        const uploaded = []
        for (const file of mediaFiles) {
          const result = await api.uploadMedia(file)
          if (result[0]?.id) uploaded.push(result[0])
        }
        if (uploaded.length > 0) media = uploaded
      }

      if (scheduleMode === 'queue') {
        await api.addToQueue({ body: body.trim(), media, platforms: selectedPlatforms })
        setSuccess('Added to queue!')
      } else {
        const data = {
          body: body.trim(),
          media,
          platforms: selectedPlatforms,
          scheduledAt: scheduleMode === 'schedule' ? new Date(scheduledAt).toISOString() : undefined,
          queued: false,
        }

        const post = await api.createPost(data)

        if (scheduleMode === 'now') {
          await api.publishPost(post.id)
          setSuccess('Publishing now!')
        } else {
          setSuccess('Scheduled!')
        }
      }

      setBody('')
      setMediaFiles([])
      setMediaPreviews([])
      onCreated?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  // Character count for the most restrictive selected platform
  const minChars = selectedPlatforms.length > 0 ? 280 : 1024 // default to twitter limit
  const charCount = body.length

  return (
    <div>
      <h1 className="page-title">Compose</h1>

      <div className="card">
        <textarea
          className="textarea"
          placeholder="What's on your mind?"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={4}
          style={{ marginBottom: 12 }}
        />

        <div className="flex-between mb-16">
          <span style={{ fontSize: 12, color: charCount > minChars ? 'var(--danger)' : 'var(--text-dim)' }}>
            {charCount} characters
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
            Add media
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={handleFileSelect} />
        </div>

        {mediaPreviews.length > 0 && (
          <div className="media-preview mb-16">
            {mediaPreviews.map((src, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={src} className="media-thumb" alt="" />
                <button
                  onClick={() => removeMedia(i)}
                  style={{ position: 'absolute', top: -4, right: -4, background: 'var(--danger)', border: 'none', borderRadius: '50%', width: 18, height: 18, color: '#fff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mb-16">
          <label className="label">Platforms</label>
          <div className="platform-chips">
            {platforms.map(p => (
              <button
                key={p.id}
                className={`platform-chip ${selectedPlatforms.includes(p.id) ? 'selected' : ''}`}
                onClick={() => togglePlatform(p.id)}
              >
                {p.name}
              </button>
            ))}
            {platforms.length === 0 && (
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>No platforms configured. Go to Settings.</span>
            )}
          </div>
        </div>

        <div className="mb-16">
          <label className="label">When</label>
          <div className="flex gap-8">
            {['now', 'schedule', 'queue'].map(mode => (
              <button
                key={mode}
                className={`btn ${scheduleMode === mode ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                onClick={() => setScheduleMode(mode)}
              >
                {mode === 'now' ? 'Publish now' : mode === 'schedule' ? 'Schedule' : 'Add to queue'}
              </button>
            ))}
          </div>
        </div>

        {scheduleMode === 'schedule' && (
          <div className="mb-16">
            <input
              type="datetime-local"
              className="datetime-input"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          </div>
        )}

        {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {success && <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 12 }}>{success}</div>}

        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={posting || !body.trim()}
          style={{ opacity: posting || !body.trim() ? 0.5 : 1 }}
        >
          {posting ? 'Working...' : scheduleMode === 'now' ? 'Publish' : scheduleMode === 'schedule' ? 'Schedule post' : 'Add to queue'}
        </button>
      </div>
    </div>
  )
}
