import { useState, useEffect } from 'react'
import { api } from '../api'

export default function Schedule() {
  const [posts, setPosts] = useState([])
  const [filter, setFilter] = useState('scheduled')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.getPosts({ status: filter, limit: '50' })
      setPosts(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  const handleDelete = async (id) => {
    if (!confirm('Delete this post?')) return
    await api.deletePost(id)
    load()
  }

  const handlePublishNow = async (id) => {
    await api.publishPost(id)
    load()
  }

  return (
    <div>
      <h1 className="page-title">Schedule</h1>

      <div className="flex gap-8 mb-24">
        {['scheduled', 'draft', 'posting', 'posted', 'failed'].map(s => (
          <button
            key={s}
            className={`btn ${filter === s ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && <div className="empty"><div className="empty-text">Loading...</div></div>}

      {!loading && posts.length === 0 && (
        <div className="empty">
          <div className="empty-text">No {filter} posts</div>
        </div>
      )}

      {posts.map(post => (
        <div key={post.id} className="card">
          <div className="post-card">
            <div className="post-body">
              <div className="flex-between mb-8">
                <span className={`badge badge-${post.status}`}>{post.status}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>#{post.id}</span>
              </div>
              <div>{post.body}</div>
              <div className="post-meta">
                {post.scheduled_at && (
                  <span>{new Date(post.scheduled_at).toLocaleString()}</span>
                )}
                {post.targets?.map(t => (
                  <span key={t.id} className={`badge badge-${t.status}`}>
                    {t.platform_name || t.platform_id}
                  </span>
                ))}
              </div>
            </div>
            <div className="post-actions">
              {(post.status === 'draft' || post.status === 'scheduled') && (
                <button className="btn btn-secondary btn-sm" onClick={() => handlePublishNow(post.id)}>
                  Publish now
                </button>
              )}
              {post.status !== 'posting' && (
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(post.id)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
