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
  adminSetupStatus: () => api.request('/admin/setup-status'),
  adminBootstrap: (payload) => api.request('/admin/bootstrap', { method: 'POST', body: JSON.stringify(payload) }),
  adminStats: () => api.request('/admin/stats'),
  adminTraffic: () => api.request('/admin/traffic'),
  adminSettings: () => api.request('/admin/settings'),
  adminUpdateSettings: (payload) => api.request('/admin/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
  adminUsers: (query = '') => api.request(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  adminCreateUser: (payload) => api.request('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateUser: (id, payload) => api.request(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminAssignProduct: (id, payload) => api.request(`/admin/users/${encodeURIComponent(id)}/allocation`, { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateAllocation: (id, payload) => api.request(`/admin/users/${encodeURIComponent(id)}/allocation`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminRevokeAllocation: (id) => api.request(`/admin/users/${encodeURIComponent(id)}/allocation`, { method: 'DELETE' }),
  adminNodes: () => api.request('/admin/nodes'),
  adminCreateNode: (payload) => api.request('/admin/nodes', { method: 'POST', body: JSON.stringify(payload) }),
  adminImportNodes: (source, sourceType = 'auto') => api.request('/admin/nodes/import', { method: 'POST', body: JSON.stringify({ source, sourceType }) }),
  adminUpdateNode: (id, payload) => api.request(`/admin/nodes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminDeleteNode: (id) => api.request(`/admin/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminProducts: () => api.request('/admin/products'),
  adminCreateProduct: (payload) => api.request('/admin/products', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateProduct: (id, payload) => api.request(`/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminDeleteProduct: (id) => api.request(`/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminCodes: () => api.request('/admin/redeem-codes'),
  adminCreateCodes: (payload) => api.request('/admin/redeem-codes', { method: 'POST', body: JSON.stringify(payload) }),
  adminDeleteCode: (id) => api.request(`/admin/redeem-codes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminOrders: () => api.request('/admin/orders'),
  adminUpdateOrder: (id, status) => api.request(`/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};
