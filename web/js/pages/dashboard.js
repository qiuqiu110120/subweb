// Dashboard Page
const DashboardPage = {
  user: null,
  subscription: null,
  refreshTimer: null,

  async load() {
    try {
      const data = await api.me();
      this.user = data.user;
      this.subscription = data.subscription;
      localStorage.setItem('user', JSON.stringify(data.user));
    } catch (err) {
      App.toast('加载失败: ' + err.message, 'error');
    }
  },

  formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '0 B';
    const b = Number(bytes);
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(2) + ' KB';
    return b + ' B';
  },

  getPercent() {
    if (!this.user) return 0;
    const limit = Number(this.user.traffic_limit) || 1;
    const used = Number(this.user.traffic_used) || 0;
    return Math.min((used / limit) * 100, 100);
  },

  formatDate(dateStr) {
    if (!dateStr) return '--';
    try {
      const d = new Date(dateStr.replace(' ', 'T') + 'Z');
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    } catch { return dateStr; }
  },

  getInitial(email) {
    return email ? email.charAt(0).toUpperCase() : 'U';
  },

  render() {
    if (!this.user) {
      document.getElementById('app').innerHTML = <div class="flex-center" style="min-height:100vh"><div class="spinner"></div></div>;
      this.load().then(() => this.render());
      return;
    }

    const percent = this.getPercent();
    const used = Number(this.user.traffic_used) || 0;
    const limit = Number(this.user.traffic_limit) || 0;
    const remaining = Math.max(limit - used, 0);
    const upload = Number(this.user.traffic_upload) || 0;
    const download = Number(this.user.traffic_download) || 0;

    // SVG ring
    const ringSize = 140;
    const strokeW = 8;
    const radius = (ringSize - strokeW) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;

    const subStatus = this.subscription
      ? (this.subscription.status === 'active' ? '可用' : '已过期')
      : '无订阅';
    const subStatusClass = this.subscription && this.subscription.status === 'active'
      ? 'badge-active' : 'badge-expired';

    document.getElementById('app').innerHTML = 
      <div class="dashboard-page">
        <!-- Topbar -->
        <nav class="topbar">
          <a href="#" class="topbar-brand" onclick="App.navigate('/')">
            <div class="topbar-brand-icon">🚀</div>
            ProxySubscription
          </a>
          <div class="topbar-spacer"></div>
          <div class="topbar-status">
            <span class="status-dot"></span> 服务在线
          </div>
          <button class="theme-toggle" onclick="App.toggleTheme()" title="切换主题"
                  style="position:static;width:32px;height:32px;font-size:16px">
            \
          </button>
          <button class="btn btn-ghost btn-sm" onclick="App.logout()">退出登录</button>
        </nav>

        <div class="shell">
          <!-- Usage notice -->
          <div class="usage-notice">
            <span class="usage-notice-icon">💡</span>
            部分节点连接不上请更新客户端；自建高速节点，稳定可靠
          </div>

          <!-- Meter -->
          <div class="meter-block">
            <div class="meter-ring-container">
              <svg class="meter-ring" width="\" height="\" viewBox="0 0 \ \">
                <circle class="meter-ring-bg" cx="\" cy="\" r="\"/>
                <circle class="meter-ring-fill" cx="\" cy="\" r="\"
                        stroke-dasharray="\" stroke-dashoffset="\"/>
              </svg>
              <div class="meter-percent">\%</div>
            </div>
            <div class="meter-info">
              <div class="meter-title">流量额度: \ 月度套餐</div>
              <div class="meter-package">\</div>
              <div class="meter-stats">
                <div class="meter-stat">
                  <div class="meter-stat-value" style="color:var(--success)">\</div>
                  <div class="meter-stat-label">剩余</div>
                </div>
                <div class="meter-stat">
                  <div class="meter-stat-value" style="color:var(--primary)">\</div>
                  <div class="meter-stat-label">已用</div>
                </div>
                <div class="meter-stat">
                  <div class="meter-stat-value">\%</div>
                  <div class="meter-stat-label">使用率</div>
                </div>
                <div class="meter-stat">
                  <div class="meter-stat-value">↑\</div>
                  <div class="meter-stat-label">上传</div>
                </div>
                <div class="meter-stat">
                  <div class="meter-stat-value">↓\</div>
                  <div class="meter-stat-label">下载</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Identity -->
          <div class="identity">
            <div class="avatar">\</div>
            <div class="identity-info">
              <div class="identity-name">\</div>
              <div class="identity-handle">@\</div>
              <div class="identity-badge">⭐ trust level \</div>
            </div>
          </div>

          <!-- Subscription Panel -->
          <div class="panel">
            <div class="panel-header">
              <div class="panel-title">
                📋 订阅详情
                <span class="badge \">
                  <span class="badge-dot"></span>\
                </span>
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-outline btn-sm" id="btn-redeem">🎟️ 兑换码</button>
                <button class="btn btn-outline btn-sm" id="btn-renew">♻️ 续订</button>
                <button class="btn btn-outline btn-sm" id="btn-upgrade">⬆️ 升级</button>
              </div>
            </div>
            <div class="panel-body">
              <div class="info-row">
                <span class="info-label">服务账号</span>
                <span class="info-value">\-\</span>
              </div>
              <div class="info-row">
                <span class="info-label">UUID</span>
                <span class="info-value" id="uuid-display">\</span>
                <div class="info-actions">
                  <button class="btn btn-ghost btn-xs" id="btn-copy-uuid">📋 复制</button>
                  <button class="btn btn-ghost btn-xs" id="btn-change-uuid">🔄 更换</button>
                </div>
              </div>
              <div class="info-row">
                <span class="info-label">订阅商品</span>
                <span class="info-value">\</span>
              </div>
              <div class="info-row">
                <span class="info-label">生效时间</span>
                <span class="info-value">\</span>
              </div>
              <div class="info-row">
                <span class="info-label">到期时间</span>
                <span class="info-value" style="\">
                  \
                </span>
              </div>

              <div style="margin-top:20px">
                <div class="form-label mb-sm">订阅链接</div>
                <div class="subscription-link" id="sub-link-clash">
                  \/sub/\/clash
                  <button class="btn btn-ghost btn-xs" onclick="DashboardPage.copyLink('sub-link-clash')">📋</button>
                </div>
                <div class="subscription-link mt-sm" id="sub-link-v2ray">
                  \/sub/\/v2ray
                  <button class="btn btn-ghost btn-xs" onclick="DashboardPage.copyLink('sub-link-v2ray')">📋</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ;

    this.bindEvents();
  },

  bindEvents() {
    document.getElementById('btn-copy-uuid')?.addEventListener('click', () => {
      const uuid = this.user.uuid;
      navigator.clipboard.writeText(uuid).then(() => App.toast('UUID 已复制', 'success'));
    });

    document.getElementById('btn-change-uuid')?.addEventListener('click', async () => {
      if (!confirm('确定要更换 UUID 吗？更换后需要更新客户端配置。')) return;
      try {
        const data = await api.changeUUID();
        this.user.uuid = data.uuid;
        App.toast('UUID 已更换', 'success');
        this.render();
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });

    document.getElementById('btn-redeem')?.addEventListener('click', () => {
      App.showRedeemModal();
    });

    document.getElementById('btn-renew')?.addEventListener('click', () => {
      App.showPackageModal('renew');
    });

    document.getElementById('btn-upgrade')?.addEventListener('click', () => {
      App.showPackageModal('upgrade');
    });
  },

  copyLink(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = el.textContent.trim();
    navigator.clipboard.writeText(text).then(() => App.toast('链接已复制', 'success'));
  },

  startAutoRefresh() {
    this.refreshTimer = setInterval(async () => {
      try {
        const data = await api.me();
        this.user = data.user;
        this.subscription = data.subscription;
        this.render();
      } catch { /* silent */ }
    }, 10000);
  },

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },
};
