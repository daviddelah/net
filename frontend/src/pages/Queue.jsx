import { useState, useEffect } from 'react'
import { api } from '../api'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Queue() {
  const [slots, setSlots] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [newSlot, setNewSlot] = useState({ dayOfWeek: 1, time: '09:00' })

  const load = async () => {
    try {
      const [s, u] = await Promise.all([api.getQueueSlots(), api.getQueueUpcoming()])
      setSlots(s)
      setUpcoming(u)
    } catch {}
  }

  useEffect(() => { load() }, [])

  const addSlot = async () => {
    await api.createQueueSlot(newSlot)
    load()
  }

  const removeSlot = async (id) => {
    await api.deleteQueueSlot(id)
    load()
  }

  // Group slots by day
  const slotsByDay = DAYS.map((day, i) => ({
    day,
    dayIndex: i,
    slots: slots.filter(s => s.day_of_week === i).sort((a, b) => a.time.localeCompare(b.time)),
  }))

  return (
    <div>
      <h1 className="page-title">Queue</h1>

      <div className="card mb-24">
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-bright)' }}>
          Posting Slots
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>
          Add posts to the queue and they'll be published at the next available slot.
        </p>

        <div className="slot-grid mb-16">
          {slotsByDay.map(({ day, slots: daySlots }) => (
            <div key={day}>
              <div className="slot-day">{day}</div>
              {daySlots.map(s => (
                <div key={s.id} className="slot-time" style={{ marginBottom: 4, cursor: 'pointer', position: 'relative' }}>
                  {s.time}
                  <span
                    onClick={() => removeSlot(s.id)}
                    style={{ position: 'absolute', right: 4, top: 2, fontSize: 10, color: 'var(--danger)', cursor: 'pointer' }}
                  >
                    x
                  </span>
                </div>
              ))}
              {daySlots.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: 4 }}>--</div>
              )}
            </div>
          ))}
        </div>

        <div className="form-row">
          <div>
            <label className="label">Day</label>
            <select
              className="select"
              value={newSlot.dayOfWeek}
              onChange={e => setNewSlot(s => ({ ...s, dayOfWeek: parseInt(e.target.value) }))}
            >
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Time</label>
            <input
              type="time"
              className="datetime-input"
              value={newSlot.time}
              onChange={e => setNewSlot(s => ({ ...s, time: e.target.value }))}
            />
          </div>
          <button className="btn btn-primary" onClick={addSlot}>Add slot</button>
        </div>
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-bright)' }}>
        Queued Posts ({upcoming.length})
      </h3>

      {upcoming.length === 0 ? (
        <div className="empty">
          <div className="empty-text">Queue is empty. Compose a post and add it to the queue.</div>
        </div>
      ) : (
        upcoming.map(post => (
          <div key={post.id} className="card">
            <div className="post-body">{post.body}</div>
            <div className="post-meta">
              <span className="badge badge-queued">queued</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
