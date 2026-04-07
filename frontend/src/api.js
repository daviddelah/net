const BASE = '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Posts
export const api = {
  getPosts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/posts${qs ? `?${qs}` : ''}`);
  },
  getPost: (id) => request(`/api/posts/${id}`),
  createPost: (data) => request('/api/posts', { method: 'POST', body: JSON.stringify(data) }),
  updatePost: (id, data) => request(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePost: (id) => request(`/api/posts/${id}`, { method: 'DELETE' }),
  publishPost: (id) => request(`/api/posts/${id}/publish`, { method: 'POST' }),
  reschedulePost: (id, scheduledAt) => request(`/api/posts/${id}/reschedule`, { method: 'POST', body: JSON.stringify({ scheduledAt }) }),

  // Platforms
  getPlatforms: () => request('/api/platforms'),
  getPlatformTypes: () => request('/api/platforms/types'),
  addPlatform: (data) => request('/api/platforms', { method: 'POST', body: JSON.stringify(data) }),
  updatePlatform: (id, data) => request(`/api/platforms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlatform: (id) => request(`/api/platforms/${id}`, { method: 'DELETE' }),
  testPlatform: (id) => request(`/api/platforms/${id}/test`, { method: 'POST' }),

  // Queue
  getQueueSlots: () => request('/api/queue/slots'),
  createQueueSlot: (data) => request('/api/queue/slots', { method: 'POST', body: JSON.stringify(data) }),
  updateQueueSlot: (id, data) => request(`/api/queue/slots/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteQueueSlot: (id) => request(`/api/queue/slots/${id}`, { method: 'DELETE' }),
  getQueueUpcoming: () => request('/api/queue/upcoming'),
  addToQueue: (data) => request('/api/queue/add', { method: 'POST', body: JSON.stringify(data) }),

  // Recurring
  getRecurringRules: () => request('/api/recurring'),
  createRecurringRule: (data) => request('/api/recurring', { method: 'POST', body: JSON.stringify(data) }),
  updateRecurringRule: (id, data) => request(`/api/recurring/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRecurringRule: (id) => request(`/api/recurring/${id}`, { method: 'DELETE' }),

  // Media
  uploadMedia: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/media/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },
  deleteMedia: (id) => request(`/api/media/${id}`, { method: 'DELETE' }),

  // Activity
  getActivity: (limit = 50) => request(`/api/activity?limit=${limit}`),
  getStats: () => request('/api/stats'),

  // Tools
  importTwitter: (data) => request('/api/tools/twitter-import', { method: 'POST', body: JSON.stringify(data) }),
};
