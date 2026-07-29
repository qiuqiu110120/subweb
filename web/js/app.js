const App = {
  state: {
    me: null,
    busy: false,
    token: localStorage.getItem('token'),
    theme: 'light',
    dialogs: { upgrade: false, renewal: false, redeem: false },
    notifications: [],
  },
  currentPage: null,

  init() {
    this.initTheme();
    window.addEventListener('hashchange', () => this.handleRoute());
    this.handleRoute();
  },

  initTheme() {
    const saved = localStorage.getItem('theme');
    const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    this.state.theme = saved === 'dark' || saved === 'light' ? saved : preferred;
    document.documentElement.dataset.theme = this.state.theme;
  },

  toggleTheme() {
    this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = this.state.theme;
    localStorage.setItem('theme', this.state.theme);
    document.querySelectorAll('[data-theme-icon]').forEach((element) => {
      element.textContent = this.themeIcon();
    });
  },

  themeIcon() {
    return this.state.theme === 'dark' ? '☀' : '☾';
  },

  handleRoute() {
    const route = window.location.hash.slice(1)
      || (window.location.pathname === '/login' || window.location.pathname === '/login.html' ? '/login' : '/');
    const token = localStorage.getItem('token');
    DashboardPage.stopAutoRefresh();
    this.hideModal();
    if (!token || route === '/login') {
      if (token && route === '/login') return this.navigate('/');
      this.currentPage = 'login';
      LoginPage.render();
      return;
    }
    if (route === '/' || route === '/dashboard') {
      this.currentPage = 'dashboard';
      DashboardPage.render();
      DashboardPage.startAutoRefresh();
      return;
    }
    if (route === '/admin') {
      this.currentPage = 'admin';
      AdminPage.render();
      return;
    }
    this.navigate('/');
  },

  navigate(path) {
    const next = `#${path}`;
    if (window.location.hash === next) this.handleRoute();
    else window.location.hash = next;
  },

  async logout() {
    try { await api.logout(); } catch { /* JWT logout is client-side. */ }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.state.token = null;
    this.state.me = null;
    DashboardPage.reset();
    AdminPage.reset();
    this.navigate('/login');
  },

  escape(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  },

  toast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const element = document.createElement('div');
    element.className = `toast toast-${type}`;
    element.setAttribute('role', type === 'error' ? 'alert' : 'status');
    element.textContent = message;
    container.appendChild(element);
    window.setTimeout(() => {
      element.classList.add('toast-removing');
      window.setTimeout(() => element.remove(), 300);
    }, 3200);
  },

  showModal(title, content, onReady) {
    const dialog = document.getElementById('app-dialog');
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-body').innerHTML = content;
    if (!dialog.open) dialog.showModal();
    if (onReady) onReady();
  },

  hideModal() {
    const dialog = document.getElementById('app-dialog');
    if (dialog?.open) dialog.close();
    this.state.dialogs = { upgrade: false, renewal: false, redeem: false };
  },

  showPackageModal(type) {
    const isRenewal = type === 'renewal';
    const options = isRenewal ? App.state.me?.renewalOptions : App.state.me?.purchaseOptions?.filter((item) => item.available);
    this.state.dialogs[type] = true;
    const cards = options?.length ? options.map((product) => `
      <article class="product-card ${product.available ? '' : 'is-disabled'}">
        <div>
          <h3>${this.escape(product.name)}</h3>
          <p>${this.escape(product.traffic_label)} · ${product.duration_months} 个月</p>
          ${product.reason ? `<small>${this.escape(product.reason)}</small>` : ''}
        </div>
        <div class="product-action">
          <strong>¥${(product.amount_cents / 100).toFixed(2)}</strong>
          <button class="btn btn-outline btn-sm" data-product-id="${this.escape(product.id)}" ${product.available ? '' : 'disabled'}>选择</button>
        </div>
      </article>`).join('') : '<p class="empty-state">当前没有可选套餐</p>';
    this.showModal(isRenewal ? '续订套餐' : '升级套餐', `<div class="product-list">${cards}</div>`, () => {
      document.querySelectorAll('[data-product-id]').forEach((button) => {
        button.addEventListener('click', () => this.handlePackageSelect(button.dataset.productId, type));
      });
    });
  },

  async handlePackageSelect(productId, orderType) {
    if (this.state.busy) return;
    this.state.busy = true;
    try {
      await api.createOrder(productId, orderType);
      this.hideModal();
      this.toast('模拟支付成功，订阅已更新');
      await DashboardPage.load();
      DashboardPage.render();
    } catch (error) {
      this.toast(error.message, 'error');
    } finally {
      this.state.busy = false;
    }
  },

  showRedeemModal() {
    this.state.dialogs.redeem = true;
    this.showModal('兑换码', `
      <form id="redeem-form">
        <label class="form-label" for="redeem-code">兑换码</label>
        <input class="form-input" id="redeem-code" maxlength="64" autocomplete="off" required>
        <p class="form-error" id="redeem-error" role="alert"></p>
        <button class="btn btn-primary" type="submit">立即兑换</button>
      </form>`, () => {
      document.getElementById('redeem-code').focus();
      document.getElementById('redeem-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const code = document.getElementById('redeem-code').value.trim();
        const errorElement = document.getElementById('redeem-error');
        try {
          await api.redeem(code);
          this.hideModal();
          this.toast('兑换成功');
          await DashboardPage.load();
          DashboardPage.render();
        } catch (error) {
          errorElement.textContent = error.message;
        }
      });
    });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
