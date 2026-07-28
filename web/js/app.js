// Main App - Router, Theme, Toast, Modal
const App = {
  currentPage: null,

  init() {
    this.initTheme();
    this.handleRoute();
    window.addEventListener('hashchange', () => this.handleRoute());
  },

  // ---------- Theme ----------
  initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    // Re-render current page to update icons
    if (this.currentPage === 'login') {
      LoginPage.render();
    } else if (this.currentPage === 'dashboard') {
      DashboardPage.render();
    } else if (this.currentPage === 'admin') {
      AdminPage.render();
    }
  },

  getThemeIcon() {
    const current = document.documentElement.getAttribute('data-theme');
    return current === 'dark' ? '☀️' : '🌙';
  },

  // ---------- Routing ----------
  handleRoute() {
    const hash = window.location.hash.slice(1) || '/';
    const token = localStorage.getItem('token');

    // Protected routes
    const protectedRoutes = ['/', '/dashboard', '/admin'];
    const isProtected = protectedRoutes.includes(hash) || hash === '/';

    DashboardPage.stopAutoRefresh();

    if (isProtected && !token) {
      this.currentPage = 'login';
      LoginPage.render();
      return;
    }

    if (hash === '/login') {
      if (token) {
        window.location.hash = '#/';
        return;
      }
      this.currentPage = 'login';
      LoginPage.render();
      return;
    }

    if (hash === '/' || hash === '/dashboard') {
      this.currentPage = 'dashboard';
      DashboardPage.render();
      DashboardPage.startAutoRefresh();
      return;
    }

    if (hash === '/admin') {
      this.currentPage = 'admin';
      AdminPage.render();
      return;
    }

    // Fallback
    this.navigate('/');
  },

  navigate(path) {
    window.location.hash = '#' + path;
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    DashboardPage.stopAutoRefresh();
    this.navigate('/login');
  },

  // ---------- Toast ----------
  toast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;

    const icons = { success: '✅', error: '❌', warning: '⚠️' };
    toast.innerHTML = <span>\</span> \;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-removing');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // ---------- Modal ----------
  showModal(title, content, onClose) {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal-content');

    modal.innerHTML = 
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div class="modal-title">\</div>
        <button class="btn btn-ghost btn-sm" id="modal-close" style="font-size:18px;padding:4px 8px">✕</button>
      </div>
      \
    ;

    overlay.style.display = 'flex';
    modal.style.display = 'block';

    const close = () => {
      overlay.style.display = 'none';
      modal.style.display = 'none';
      if (onClose) onClose();
    };

    document.getElementById('modal-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
  },

  hideModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('modal-content').style.display = 'none';
  },

  // ---------- Package Modal ----------
  showPackageModal(type) {
    const title = type === 'renew' ? '续订套餐' : '升级套餐';
    this.showModal(title, 
      <p class="text-muted text-sm mb-md">选择一个套餐进行\（演示数据）</p>
      <div id="package-list" style="display:flex;flex-direction:column;gap:10px">
        <div class="flex-center" style="padding:20px"><div class="spinner"></div></div>
      </div>
    );

    // Simulate package loading
    setTimeout(() => {
      const packages = [
        { id: 1, name: '50GB 月度套餐', traffic_gb: 50, price_cents: 990 },
        { id: 2, name: '200GB 月度套餐', traffic_gb: 200, price_cents: 1990 },
        { id: 3, name: '500GB 月度套餐', traffic_gb: 500, price_cents: 3990 },
        { id: 4, name: '1024GB 月度套餐', traffic_gb: 1024, price_cents: 6990 },
      ];

      const list = document.getElementById('package-list');
      if (!list) return;
      list.innerHTML = packages.map(p => 
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--bg);border-radius:var(--radius);border:1px solid var(--line)">
          <div>
            <div style="font-weight:700;color:var(--ink)">\</div>
            <div style="font-size:12px;color:var(--muted)">\GB 流量</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-weight:800;color:var(--primary);font-size:18px">¥\</span>
            <button class="btn btn-primary btn-sm" onclick="App.handlePackageSelect(\, '\')">
              \
            </button>
          </div>
        </div>
      ).join('');
    }, 300);
  },

  async handlePackageSelect(packageId, type) {
    try {
      App.hideModal();
      App.toast('正在创建订单...', 'warning');
      await api.createOrder(packageId, type);
      App.toast('订单已创建（模拟支付成功）', 'success');
      // Refresh dashboard
      DashboardPage.load().then(() => DashboardPage.render());
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  // ---------- Redeem Modal ----------
  showRedeemModal() {
    this.showModal('兑换码', 
      <p class="text-muted text-sm mb-md">请输入兑换码以获取流量</p>
      <div class="form-group">
        <input type="text" class="form-input" id="redeem-code-input" placeholder="请输入兑换码">
      </div>
      <div id="redeem-error" class="text-danger text-sm mb-md" style="display:none"></div>
      <button class="btn btn-primary" id="btn-redeem-submit">兑换</button>
    );

    document.getElementById('btn-redeem-submit').onclick = async () => {
      const code = document.getElementById('redeem-code-input').value.trim();
      const errorEl = document.getElementById('redeem-error');
      errorEl.style.display = 'none';

      if (!code) {
        errorEl.textContent = '请输入兑换码';
        errorEl.style.display = 'block';
        return;
      }

      try {
        await api.redeemCode(code);
        this.hideModal();
        App.toast('兑换成功！', 'success');
        DashboardPage.load().then(() => DashboardPage.render());
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    };
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
