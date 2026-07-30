const DashboardPage = {
  refreshTimer: null,
  loading: false,

  reset() {
    this.stopAutoRefresh();
    App.state.me = null;
    this.loading = false;
  },

  async load({ silent = false } = {}) {
    if (this.loading) return;
    this.loading = true;
    try {
      const data = await api.me();
      App.state.me = data;
      localStorage.setItem('user', JSON.stringify(data.user));
      if (this.refreshTimer && App.currentPage === 'dashboard') this.startAutoRefresh();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        localStorage.removeItem('token');
        App.navigate('/login');
        return;
      }
      if (!silent) App.toast(`加载失败：${error.message}`, 'error');
      throw error;
    } finally {
      this.loading = false;
    }
  },

  formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index > 2 ? 2 : 0)} ${units[index]}`;
  },

  formatDate(timestamp) {
    if (!timestamp) return '未设置';
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai',
    }).format(new Date(Number(timestamp) * 1000));
  },

  render() {
    const root = document.getElementById('app');
    const data = App.state.me;
    if (!data) {
      root.innerHTML = '<main class="page-loading" aria-label="加载中"><span class="spinner"></span></main>';
      this.load().then(() => this.render()).catch(() => {});
      return;
    }
    const { user, allocation, quota, availability, config = {} } = data;
    const percent = Math.min(Math.max(Number(quota.percent) || 0, 0), 100);
    const radius = 62;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - percent / 100);
    const status = availability.usable ? '可用' : quota.expired ? '已过期' : quota.exhausted ? '流量已用尽' : '不可用';
    const statusClass = availability.usable ? 'badge-active' : 'badge-expired';
    const initial = (user.username || user.email || 'U').trim().charAt(0).toUpperCase();
    const links = [
      ['通用订阅（自动识别）', 'universal'],
      ['V2Ray / Shadowrocket', 'v2ray'],
      ['Clash / Verge / Stash', 'clash'],
      ['Quantumult X', 'quantumult'],
      ['Loon', 'loon'],
      ['Sing-Box / NekoBox', 'singbox'],
    ];
    const linksHtml = allocation ? links.map(([label, key]) => {
      const url = data.subscriptions.links[key];
      return `<div class="link-row">
        <div><strong>${label}</strong><code>${App.escape(url)}</code></div>
        <button class="icon-button" type="button" data-copy-url="${App.escape(url)}" title="复制${label}订阅链接" aria-label="复制${label}订阅链接">⧉</button>
      </div>`;
    }).join('') : '<p class="empty-state">当前没有订阅链接</p>';

    root.innerHTML = `
      <div class="dashboard-page">
        <header class="topbar">
          <a class="topbar-brand" href="#/" aria-label="ProxySubscription 首页">
            <img class="brand-mark" src="/assets/logo.svg" alt=""><span>${App.escape(config.siteName || 'ProxySubscription')}</span>
          </a>
          <span class="topbar-status"><span class="status-dot"></span>服务在线</span>
          <div class="topbar-spacer"></div>
          ${user.role === 'admin' ? '<a class="btn btn-ghost btn-sm" href="#/admin">管理后台</a>' : ''}
          <button class="icon-button" type="button" data-theme-icon title="切换主题" aria-label="切换主题">${App.themeIcon()}</button>
          <button class="btn btn-ghost btn-sm" type="button" id="logout-button">退出登录</button>
        </header>
        <main class="shell">
          <aside class="usage-notice"><span aria-hidden="true">i</span><p>部分节点连接不上时请先更新客户端订阅；自建高速节点会持续维护。</p></aside>
          <section class="meter-block" aria-labelledby="meter-heading">
            <div class="meter-ring-container">
              <svg class="meter-ring" width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
                <circle class="meter-ring-bg" cx="70" cy="70" r="${radius}"></circle>
                <circle class="meter-ring-fill" cx="70" cy="70" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
              </svg>
              <div class="meter-percent">${percent.toFixed(1)}%</div>
            </div>
            <div class="meter-info">
              <h1 class="meter-title" id="meter-heading">流量额度</h1>
              <p class="meter-package">${App.escape(allocation?.product_name || '暂无套餐')}</p>
              <div class="meter-stats">
                <div class="meter-stat"><strong class="meter-stat-value text-success">${this.formatBytes(quota.remaining)}</strong><span class="meter-stat-label">剩余</span></div>
                <div class="meter-stat"><strong class="meter-stat-value text-primary">${this.formatBytes(quota.used)}</strong><span class="meter-stat-label">已用</span></div>
                <div class="meter-stat"><strong class="meter-stat-value">${this.formatBytes(quota.quota)}</strong><span class="meter-stat-label">总额</span></div>
              </div>
            </div>
          </section>
          <section class="identity" aria-label="用户身份">
            <div class="avatar">${App.escape(initial)}</div>
            <div class="identity-info">
              <h2 class="identity-name">${App.escape(user.username)}</h2>
              <p class="identity-handle">${App.escape(user.email)}</p>
              <span class="identity-badge">trust level ${Number(user.trust_level) || 0}</span>
            </div>
            <button class="btn btn-outline btn-sm" type="button" id="checkin-button">每日签到</button>
          </section>
          <section class="panel" aria-labelledby="subscription-heading">
            <header class="panel-header">
              <h2 class="panel-title" id="subscription-heading">订阅详情 <span class="badge ${statusClass}"><span class="badge-dot"></span>${status}</span></h2>
              <div class="panel-actions">
                <button class="btn btn-outline btn-sm" type="button" id="redeem-button">兑换码</button>
                <button class="btn btn-outline btn-sm" type="button" id="renewal-button">续订</button>
                <button class="btn btn-outline btn-sm" type="button" id="upgrade-button">升级</button>
              </div>
            </header>
            <div class="panel-body">
              <dl class="details-list">
                <div class="row"><dt>服务账号</dt><dd>${App.escape(`${user.username}-${allocation?.id?.slice(0, 10) || 'unclaimed'}`)}</dd></div>
                <div class="row"><dt>UUID</dt><dd class="uuid-control"><code id="uuid-value">${App.escape(allocation?.uuid || '未分配')}</code>${allocation ? '<button class="btn btn-ghost btn-xs" type="button" id="rotate-button">更换</button>' : ''}</dd></div>
                <div class="row"><dt>订阅商品</dt><dd>${App.escape(allocation?.product_name || '暂无')}</dd></div>
                <div class="row"><dt>生效时间</dt><dd>${this.formatDate(allocation?.claimed_at)}</dd></div>
                <div class="row"><dt>有效期至</dt><dd class="${quota.expired ? 'text-danger' : ''}">${this.formatDate(allocation?.expires_at)}</dd></div>
              </dl>
              <section class="subscription-links" aria-labelledby="links-heading">
                <h3 id="links-heading">订阅链接</h3>${linksHtml}
              </section>
            </div>
          </section>
        </main>
      </div>`;
    this.bindEvents();
  },

  bindEvents() {
    document.querySelector('[data-theme-icon]').addEventListener('click', () => App.toggleTheme());
    document.getElementById('logout-button').addEventListener('click', () => App.logout());
    document.getElementById('redeem-button').addEventListener('click', () => App.showRedeemModal());
    document.getElementById('renewal-button').addEventListener('click', () => App.showPackageModal('renewal'));
    document.getElementById('upgrade-button').addEventListener('click', () => App.showPackageModal('upgrade'));
    document.getElementById('checkin-button').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        const result = await api.checkin();
        App.toast(`签到成功，获得 ${this.formatBytes(result.bonus_bytes)}`);
        await this.load();
        this.render();
      } catch (error) {
        App.toast(error.message, error.code === 'ALREADY_CHECKED_IN' ? 'warning' : 'error');
      } finally {
        if (event.currentTarget.isConnected) event.currentTarget.disabled = false;
      }
    });
    document.getElementById('rotate-button')?.addEventListener('click', async () => {
      if (!window.confirm('更换后旧客户端配置会立即失效，确定继续吗？')) return;
      try {
        await api.rotateUUID();
        App.toast('UUID 已更换，请重新复制订阅链接');
        await this.load();
        this.render();
      } catch (error) { App.toast(error.message, 'error'); }
    });
    document.querySelectorAll('[data-copy-url]').forEach((button) => {
      button.addEventListener('click', () => this.copy(button.dataset.copyUrl));
    });
  },

  async copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      App.toast('订阅链接已复制');
    } catch {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed'; input.style.opacity = '0';
      document.body.appendChild(input); input.select();
      document.execCommand('copy'); input.remove();
      App.toast('订阅链接已复制');
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    const interval = Math.max(5000, Number(App.state.me?.config?.statsPollIntervalMs) || 10000);
    this.refreshTimer = window.setInterval(async () => {
      if (document.hidden || App.currentPage !== 'dashboard') return;
      try { await this.load({ silent: true }); this.render(); } catch { /* Keep the last good view. */ }
    }, interval);
  },

  stopAutoRefresh() {
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  },
};
