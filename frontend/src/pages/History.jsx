import { useState, useEffect } from 'react'
import { api } from '../api'

export default function History() {
  const [stats, setStats] = useState(null)
  const [logs, setLogs] = useState([])
  const [posts, setPosts] = useState([])

  useEffect(() => {
    Promise.all([
      api.getStats(),
      api.getActivity(30),
      api.getPosts({ status: 'posted', limit: '20' }),
    ]).then(([s, l, p]) => {
      setStats(s)
      setLogs(l)
      setPosts(p)
    }).catch(() => {})
  }, [])

  return (
    <div>
      <h1 className="page-title">History</h1>

      {stats && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{stats.total || 0}</div>
            <div className="stat-label">Total posts</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.posted || 0}</div>
            <div className="stat-label">Published</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--info)' }}>{stats.scheduled || 0}</div>
            <div className="stat-label">Scheduled</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: 'var(--danger)' }}>{stats.failed || 0}</div>
            <div className="stat-label">Failed</div>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-bright)' }}>
        Published Posts
      </h3>

      {posts.length === 0 ? (
        <div className="empty mb-24">
          <div className="empty-text">No published posts yet</div>
        </div>
      ) : (
        posts.map(post => (
          <div key={post.id} className="card">
            <div className="post-body">{post.body}</div>
            <div className="post-meta">
              <span>{post.posted_at ? new Date(post.posted_at).toLocaleString() : ''}</span>
              {post.targets?.map(t => (
                <span key={t.id}>
                  {t.platform_name}
                  {t.platform_url && (
                    <a href={t.platform_url} target="_blank" rel="noopener" style={{ color: 'var(--accent)', marginLeft: 4 }}>
                      link
                    </a>
                  )}
                </span>
              ))}
            </div>
          </div>
        ))
      )}

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, marginTop: 24, color: 'var(--text-bright)' }}>
        Activity Log
      </h3>

      {logs.length === 0 ? (
        <div className="empty">
          <div className="empty-text">No activity yet</div>
        </div>
      ) : (
        <div className="card">
          {logs.map(log => (
            <div key={log.id} className="log-entry">
              <span className="log-time">{new Date(log.timestamp).toLocaleString()}</span>
              <span className="log-action">{log.action}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
