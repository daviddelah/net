import { getQueueSlots, getQueuedPosts, updatePost } from '../db/sqlite.js';

/**
 * Buffer-style queue: finds the next available slot and promotes queued posts.
 */
export async function processQueue() {
  const slots = (await getQueueSlots()).filter(s => s.enabled);
  if (slots.length === 0) return;

  const queued = await getQueuedPosts(10);
  if (queued.length === 0) return;

  for (const post of queued) {
    const nextSlotTime = getNextSlotTime(slots);
    if (!nextSlotTime) break;

    await updatePost(post.id, {
      status: 'scheduled',
      scheduledAt: nextSlotTime.toISOString(),
      queueSlotId: null,
    });
  }
}

/**
 * Find the next available queue slot from now.
 */
export function getNextSlotTime(slots, after = new Date()) {
  if (!slots || slots.length === 0) return null;

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const date = new Date(after);
    date.setDate(date.getDate() + dayOffset);
    const dayOfWeek = date.getDay();

    const daySlots = slots
      .filter(s => s.day_of_week === dayOfWeek)
      .sort((a, b) => a.time.localeCompare(b.time));

    for (const slot of daySlots) {
      const [hours, minutes] = slot.time.split(':').map(Number);
      const slotDate = new Date(date);
      slotDate.setHours(hours, minutes, 0, 0);
      if (slotDate > after) return slotDate;
    }
  }
  return null;
}
