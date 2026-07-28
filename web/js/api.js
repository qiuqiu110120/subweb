// API Client for ProxySubscription
const API_BASE = '/api';

const api = {
  async request(path, options = {}) {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = Bearer \;

    const res = await fetch(API_BASE + path, { ...options, headers: { ...headers, ...options.headers } });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (window.location.pathname !== '/login') {
          window.location.hash = '#/login';
        }
      }
      throw new Error(data.error || 'Request failed');
    }
    return data;
  },

  // Auth
  register(email, password) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  login(email, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  // User
  me() {
    return this.request('/me');
  },

  // Orders
  createOrder(packageId, orderType) {
    return this.request('/orders', {
      method: 'POST',
      body: JSON.stringify({ package_id: packageId, order_type: orderType }),
    });
  },

  getOrders() {
    return this.request('/orders');
  },

  // Subscription
  getSubscriptionLink(format) {
    return this.request(/sub/link?format=\);
  },

  changeUUID() {
    return this.request('/me/uuid', { method: 'PUT' });
  },

  // Redeem
  redeemCode(code) {
    return this.request('/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  // Admin
  adminUsers() {
    return this.request('/admin/users');
  },

  adminPackages() {
    return this.request('/admin/packages');
  },

  adminNodes() {
    return this.request('/admin/nodes');
  },

  adminStats() {
    return this.request('/admin/stats');
  },
};
