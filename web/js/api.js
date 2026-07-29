const API_BASE = '/api';

const api = {
  async request(path, options = {}) {
    const token = localStorage.getItem('token');
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch {
      throw new Error('网络连接失败，请稍后重试');
    }
    const contentType = response.headers.get('content-type') || '';
    const data = response.status === 204
      ? null
      : contentType.includes('application/json')
        ? await response.json()
        : { error: await response.text() };
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
      const error = new Error(data?.error || '请求失败');
      error.code = data?.code;
      error.status = response.status;
      throw error;
    }
    return data;
  },

  siteInfo: () => api.request('/site-info'),
  register: (email, password, username) => api.request('/auth/register', {
    method: 'POST', body: JSON.stringify({ email, password, username }),
  }),
  login: (email, password) => api.request('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  }),
  logout: () => api.request('/auth/logout', { method: 'POST' }),
  me: () => api.request('/me'),
  createOrder: (productId, orderType) => api.request('/orders', {
    method: 'POST', body: JSON.stringify({ productId, orderType }),
  }),
  getOrder: (id) => api.request(`/orders/${encodeURIComponent(id)}`),
  rotateUUID: () => api.request('/rotate-uuid', { method: 'POST' }),
  redeem: (code) => api.request('/redeem', { method: 'POST', body: JSON.stringify({ code }) }),
  checkin: () => api.request('/checkin', { method: 'POST' }),
  nodes: () => api.request('/nodes'),
};
