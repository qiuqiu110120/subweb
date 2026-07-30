const AdminPage = {
  data: null,
  activeTab: 'users',
  loading: false,

  reset() {
    this.data = null;
    this.activeTab = 'users';
    this.loading = false;
  },

  async load(query = '') {
    if (this.loading) return;
    this.loading = true;
    try {
      const [stats, users, nodes, products, codes, orders, traffic, settings] = await Promise.all([
        api.adminStats(), api.adminUsers(query), api.adminNodes(), api.adminProducts(), api.adminCodes(), api.adminOrders(), api.adminTraffic(), api.adminSettings(),
      ]);
      this.data = { stats, users, nodes, products, codes, orders, traffic, settings, query };
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        App.toast('需要管理员权限', 'error');
        App.navigate('/');
        return;
      }
      App.toast(`管理数据加载失败：${error.message}`, 'error');
      throw error;
    } finally { this.loading = false; }
  },

  formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index >= 3 ? 2 : 0)} ${units[index]}`;
  },

  formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai',
    }).format(new Date(Number(value) * 1000));
  },

  dateTimeInput(value) {
    if (!value) return '';
    const date = new Date(Number(value) * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  },

  render() {
    const root = document.getElementById('app');
    if (!this.data) {
      root.innerHTML = '<main class="page-loading"><span class="spinner"></span></main>';
      this.load().then(() => this.render()).catch(() => {});
      return;
    }
    const { stats } = this.data;
    root.innerHTML = `
      <div class="dashboard-page admin-page">
        <header class="topbar">
          <a class="topbar-brand" href="#/admin"><img class="brand-mark" src="/assets/logo.svg" alt=""><span>${App.escape(this.data.settings?.siteName || 'ProxySubscription')} 管理</span></a>
          <span class="badge badge-active">管理员</span>
          <div class="topbar-spacer"></div>
          <a class="btn btn-ghost btn-sm" href="#/">用户中心</a>
          <button class="icon-button" type="button" data-theme-icon title="切换主题" aria-label="切换主题">${App.themeIcon()}</button>
          <button class="btn btn-ghost btn-sm" type="button" id="admin-logout">退出登录</button>
        </header>
        <main class="admin-shell">
          <header class="admin-heading">
            <div><p class="login-eyebrow">Operations Console</p><h1>服务管理</h1><p>管理用户、订阅资源与销售数据。</p></div>
            <button class="btn btn-outline btn-sm" type="button" id="admin-refresh">刷新数据</button>
          </header>
          <section class="admin-stats" aria-label="运营统计">
            ${this.statCard('总用户', stats.totalUsers)}
            ${this.statCard('活跃用户', stats.activeUsers)}
            ${this.statCard('有效订阅', stats.activeAllocations)}
            ${this.statCard('在线节点', stats.activeNodes)}
            ${this.statCard('订单数', stats.totalOrders)}
            ${this.statCard('模拟收入', `¥${(stats.revenueCents / 100).toFixed(2)}`)}
            ${this.statCard('未用兑换码', stats.unusedCodes)}
            ${this.statCard('累计流量', this.formatBytes(stats.totalTrafficBytes))}
            ${this.statCard('今日签到', stats.checkinsToday)}
          </section>
          <nav class="admin-tabs" aria-label="管理模块">
            ${[['users', '用户'], ['nodes', '节点'], ['products', '套餐'], ['codes', '兑换码'], ['orders', '订单'], ['traffic', '流量记录'], ['settings', '站点设置']]
              .map(([key, label]) => `<button type="button" class="admin-tab ${this.activeTab === key ? 'is-active' : ''}" data-admin-tab="${key}">${label}</button>`).join('')}
          </nav>
          <section class="admin-workspace">${this.renderActiveTab()}</section>
        </main>
      </div>`;
    this.bindEvents();
  },

  statCard(label, value) {
    return `<article class="stat-card"><span>${label}</span><strong>${App.escape(value)}</strong></article>`;
  },

  renderActiveTab() {
    if (this.activeTab === 'nodes') return this.renderNodes();
    if (this.activeTab === 'products') return this.renderProducts();
    if (this.activeTab === 'codes') return this.renderCodes();
    if (this.activeTab === 'orders') return this.renderOrders();
    if (this.activeTab === 'traffic') return this.renderTraffic();
    if (this.activeTab === 'settings') return this.renderSettings();
    return this.renderUsers();
  },

  table(headers, rows, emptyText) {
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((item) => `<th>${item}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${headers.length}" class="empty-state">${emptyText}</td></tr>`}</tbody></table></div>`;
  },

  renderUsers() {
    const rows = this.data.users.map((user) => `<tr>
      <td><strong>${App.escape(user.username)}</strong><small>${App.escape(user.email)}</small></td>
      <td><span class="badge ${user.role === 'admin' ? 'badge-admin' : ''}">${user.role === 'admin' ? '管理员' : '用户'}</span></td>
      <td><span class="badge ${user.status === 'active' ? 'badge-active' : 'badge-expired'}">${App.escape(user.status)}</span></td>
      <td>${user.product_name ? `${App.escape(user.product_name)}<small>${this.formatBytes(user.used_bytes)} / ${this.formatBytes(user.quota_bytes)}</small>` : '未分配'}</td>
      <td>${this.formatDate(user.expires_at)}</td>
      <td class="table-actions"><button class="btn btn-ghost btn-xs" data-user-edit="${user.id}">编辑用户</button><button class="btn btn-ghost btn-xs" data-user-plan="${user.id}">分配套餐</button>${user.allocation_id ? `<button class="btn btn-ghost btn-xs" data-user-allocation="${user.id}">管理订阅</button>` : ''}</td>
    </tr>`).join('');
    return `<div class="admin-toolbar"><form id="user-search" class="admin-search"><input class="form-input" name="q" value="${App.escape(this.data.query)}" placeholder="搜索邮箱或用户名"><button class="btn btn-outline" type="submit">搜索</button></form><button class="btn btn-outline btn-sm" id="user-create">新增用户</button></div>
      ${this.table(['用户', '角色', '状态', '订阅', '到期时间', '操作'], rows, '暂无用户')}`;
  },

  renderNodes() {
    const rows = this.data.nodes.map((node) => `<tr>
      <td><strong>${App.escape(node.name)}</strong><small>${App.escape(node.id)}</small></td>
      <td><code>${App.escape(node.address)}:${Number(node.port)}</code></td>
      <td>${App.escape(node.protocol)} / ${App.escape(node.network)} / ${App.escape(node.security)}</td>
      <td><span class="badge ${node.is_active ? 'badge-active' : 'badge-expired'}">${node.is_active ? '启用' : '停用'}</span></td>
      <td class="table-actions"><button class="btn btn-ghost btn-xs" data-node-edit="${node.id}">编辑</button>${node.is_active ? `<button class="btn btn-ghost btn-xs text-danger" data-node-delete="${node.id}">停用</button>` : ''}</td>
    </tr>`).join('');
    return `<div class="admin-toolbar"><h2>节点管理</h2><button class="btn btn-outline btn-sm" id="node-create">新增节点</button></div>${this.table(['节点', '服务器', '协议', '状态', '操作'], rows, '暂无节点')}`;
  },

  renderProducts() {
    const rows = this.data.products.map((product) => `<tr>
      <td><strong>${App.escape(product.name)}</strong><small>${App.escape(product.id)}</small></td>
      <td>${App.escape(product.traffic_label)}</td><td>¥${(product.price_cents / 100).toFixed(2)}</td><td>${product.duration_months} 个月</td>
      <td><span class="badge ${product.is_active ? 'badge-active' : 'badge-expired'}">${product.is_active ? '上架' : '下架'}</span></td>
      <td class="table-actions"><button class="btn btn-ghost btn-xs" data-product-edit="${product.id}">编辑</button>${product.is_active ? `<button class="btn btn-ghost btn-xs text-danger" data-product-delete="${product.id}">下架</button>` : ''}</td>
    </tr>`).join('');
    return `<div class="admin-toolbar"><h2>套餐管理</h2><button class="btn btn-outline btn-sm" id="product-create">新增套餐</button></div>${this.table(['套餐', '流量', '价格', '周期', '状态', '操作'], rows, '暂无套餐')}`;
  },

  renderCodes() {
    const rows = this.data.codes.map((code) => `<tr>
      <td><code>${App.escape(code.code)}</code></td><td>${App.escape(code.product_name || '套餐已删除')}</td>
      <td>${code.used_by ? `已使用<small>${App.escape(code.used_by_email || code.used_by)}</small>` : code.is_active ? '<span class="text-success">未使用</span>' : '已停用'}</td>
      <td>${this.formatDate(code.created_at)}</td>
      <td class="table-actions"><button class="btn btn-ghost btn-xs" data-code-copy="${App.escape(code.code)}">复制</button>${!code.used_by && code.is_active ? `<button class="btn btn-ghost btn-xs text-danger" data-code-delete="${code.id}">停用</button>` : ''}</td>
    </tr>`).join('');
    return `<div class="admin-toolbar"><h2>兑换码</h2><button class="btn btn-outline btn-sm" id="codes-create">批量生成</button></div>${this.table(['兑换码', '套餐', '状态', '创建时间', '操作'], rows, '暂无兑换码')}`;
  },

  renderOrders() {
    const statuses = ['pending', 'paid', 'cancelled', 'expired', 'refunded'];
    const rows = this.data.orders.map((order) => `<tr>
      <td><code>${App.escape(order.id.slice(0, 8))}</code><small>${this.formatDate(order.created_at)}</small></td>
      <td>${App.escape(order.username || '未知用户')}<small>${App.escape(order.email || '')}</small></td>
      <td>${App.escape(order.product_name || order.product_id)}</td><td>${App.escape(order.order_type)}</td><td>¥${(order.amount_cents / 100).toFixed(2)}</td>
      <td><select class="form-input table-select" data-order-status="${order.id}">${statuses.map((status) => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td>
    </tr>`).join('');
    return `<div class="admin-toolbar"><h2>订单记录</h2><p class="text-muted text-sm">修改退款状态不会自动撤销用户已获得的套餐。</p></div>${this.table(['订单', '用户', '套餐', '类型', '金额', '状态'], rows, '暂无订单')}`;
  },

  renderTraffic() {
    const rows = this.data.traffic.map((item) => `<tr>
      <td><strong>${App.escape(item.username || '未知用户')}</strong><small>${App.escape(item.email || item.user_id)}</small></td>
      <td>${App.escape(item.product_name || item.allocation_id)}</td>
      <td class="traffic-delta"><span>上行 ${this.formatBytes(item.uplink_delta)}</span><span>下行 ${this.formatBytes(item.downlink_delta)}</span></td>
      <td>${this.formatDate(item.recorded_at)}</td>
    </tr>`).join('');
    return `<div class="admin-toolbar"><h2>流量记录</h2><p class="text-muted text-sm">显示节点通过流量上报接口写入的最近 200 条记录。</p></div>${this.table(['用户', '订阅', '流量', '记录时间'], rows, '暂无流量记录')}`;
  },

  renderSettings() {
    const settings = this.data.settings;
    return `<div class="admin-toolbar"><h2>站点设置</h2><p class="text-muted text-sm">修改后立即对新请求生效；JWT、D1 和节点密钥仍需在 Cloudflare Pages 配置。</p></div>
      <form id="admin-settings-form" class="settings-form">
        <div class="form-grid"><div class="form-group"><label class="form-label" for="settings-name">站点名称</label><input class="form-input" id="settings-name" maxlength="50" value="${App.escape(settings.siteName)}" required></div>
        <div class="form-group"><label class="form-label" for="settings-registration-quota">注册赠送流量（GB）</label><input type="number" min="1" max="102400" step="0.01" class="form-input" id="settings-registration-quota" value="${settings.registrationQuotaGb}" required></div></div>
        <div class="form-group"><label class="form-label" for="settings-description">站点描述</label><textarea class="form-input settings-textarea" id="settings-description" maxlength="160" required>${App.escape(settings.siteDescription)}</textarea></div>
        <div class="form-grid"><div class="form-group"><label class="form-label" for="settings-checkin-bonus">签到奖励（MB）</label><input type="number" min="1" max="10240" step="1" class="form-input" id="settings-checkin-bonus" value="${settings.checkinBonusMb}" required></div>
        <div class="form-group"><label class="form-label" for="settings-poll">仪表盘刷新周期（秒）</label><input type="number" min="5" max="300" step="1" class="form-input" id="settings-poll" value="${settings.statsPollIntervalSeconds}" required></div></div>
        <label class="check-field"><input type="checkbox" id="settings-registration" ${settings.registrationEnabled ? 'checked' : ''}> 开放新用户注册</label>
        <p class="form-error" id="admin-settings-error"></p><button class="btn btn-primary" type="submit">保存设置</button>
      </form>`;
  },

  bindEvents() {
    document.querySelector('[data-theme-icon]').addEventListener('click', () => App.toggleTheme());
    document.getElementById('admin-logout').addEventListener('click', () => App.logout());
    document.getElementById('admin-refresh').addEventListener('click', () => this.refresh());
    document.querySelectorAll('[data-admin-tab]').forEach((button) => button.addEventListener('click', () => {
      this.activeTab = button.dataset.adminTab; this.render();
    }));
    document.getElementById('user-search')?.addEventListener('submit', async (event) => {
      event.preventDefault(); await this.refresh(new FormData(event.currentTarget).get('q')?.toString().trim() || '');
    });
    document.querySelectorAll('[data-user-edit]').forEach((button) => button.addEventListener('click', () => this.openUser(button.dataset.userEdit)));
    document.querySelectorAll('[data-user-plan]').forEach((button) => button.addEventListener('click', () => this.openAssignment(button.dataset.userPlan)));
    document.querySelectorAll('[data-user-allocation]').forEach((button) => button.addEventListener('click', () => this.openAllocation(button.dataset.userAllocation)));
    document.getElementById('user-create')?.addEventListener('click', () => this.openUser());
    document.getElementById('node-create')?.addEventListener('click', () => this.openNode());
    document.querySelectorAll('[data-node-edit]').forEach((button) => button.addEventListener('click', () => this.openNode(button.dataset.nodeEdit)));
    document.querySelectorAll('[data-node-delete]').forEach((button) => button.addEventListener('click', () => this.deactivate('node', button.dataset.nodeDelete)));
    document.getElementById('product-create')?.addEventListener('click', () => this.openProduct());
    document.querySelectorAll('[data-product-edit]').forEach((button) => button.addEventListener('click', () => this.openProduct(button.dataset.productEdit)));
    document.querySelectorAll('[data-product-delete]').forEach((button) => button.addEventListener('click', () => this.deactivate('product', button.dataset.productDelete)));
    document.getElementById('codes-create')?.addEventListener('click', () => this.openCodes());
    document.querySelectorAll('[data-code-copy]').forEach((button) => button.addEventListener('click', () => navigator.clipboard.writeText(button.dataset.codeCopy).then(() => App.toast('兑换码已复制'))));
    document.querySelectorAll('[data-code-delete]').forEach((button) => button.addEventListener('click', () => this.deactivate('code', button.dataset.codeDelete)));
    document.querySelectorAll('[data-order-status]').forEach((select) => select.addEventListener('change', async () => {
      try { await api.adminUpdateOrder(select.dataset.orderStatus, select.value); App.toast('订单状态已更新'); await this.refresh(); }
      catch (error) { App.toast(error.message, 'error'); await this.refresh(); }
    }));
    document.getElementById('admin-settings-form')?.addEventListener('submit', (event) => this.submitSettings(event));
  },

  async refresh(query = this.data?.query || '') {
    this.data = null;
    this.render();
    try { await this.load(query); this.render(); } catch { /* load reports the error */ }
  },

  openUser(id) {
    const user = id ? this.data.users.find((item) => item.id === id) : null;
    if (id && !user) return;
    App.showModal(user ? '编辑用户' : '新增用户', `<form id="admin-user-form">
      <div class="form-grid"><div class="form-group"><label class="form-label" for="admin-user-name">用户名</label><input class="form-input" id="admin-user-name" minlength="2" maxlength="32" value="${App.escape(user?.username || '')}" required></div>
      <div class="form-group"><label class="form-label" for="admin-user-email">邮箱</label><input type="email" class="form-input" id="admin-user-email" value="${App.escape(user?.email || '')}" required></div></div>
      <div class="form-grid"><div class="form-group"><label class="form-label" for="admin-user-role">角色</label><select class="form-input" id="admin-user-role"><option value="user" ${user?.role !== 'admin' ? 'selected' : ''}>普通用户</option><option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>管理员</option></select></div>
      <div class="form-group"><label class="form-label" for="admin-user-status">状态</label><select class="form-input" id="admin-user-status"><option value="active" ${!user || user.status === 'active' ? 'selected' : ''}>启用</option><option value="suspended" ${user?.status === 'suspended' ? 'selected' : ''}>暂停</option><option value="banned" ${user?.status === 'banned' ? 'selected' : ''}>封禁</option></select></div></div>
      <div class="form-group"><label class="form-label" for="admin-user-trust">信任等级</label><input type="number" min="0" max="10" class="form-input" id="admin-user-trust" value="${Number(user?.trust_level) || 0}" required></div>
      <div class="form-group"><label class="form-label" for="admin-user-password">${user ? '重置密码（留空则不修改）' : '初始密码'}</label><input type="password" minlength="10" maxlength="72" class="form-input" id="admin-user-password" ${user ? '' : 'required'} autocomplete="new-password"></div>
      <p class="form-error" id="admin-form-error"></p><button class="btn btn-primary" type="submit">保存</button></form>`, () => {
      document.getElementById('admin-user-form').addEventListener('submit', (event) => this.submitModal(event, () => {
        const payload = {
          username: document.getElementById('admin-user-name').value, email: document.getElementById('admin-user-email').value,
        role: document.getElementById('admin-user-role').value, status: document.getElementById('admin-user-status').value,
          trustLevel: Number(document.getElementById('admin-user-trust').value), password: document.getElementById('admin-user-password').value,
        };
        return user ? api.adminUpdateUser(id, payload) : api.adminCreateUser(payload);
      }, user ? '用户资料已更新' : '用户已创建'));
    });
  },

  openAllocation(id) {
    const user = this.data.users.find((item) => item.id === id); if (!user?.allocation_id) return;
    App.showModal('管理用户订阅', `<form id="admin-allocation-form">
      <p class="dialog-summary"><strong>${App.escape(user.username)}</strong><span>${App.escape(user.product_name)}</span></p>
      <div class="form-grid"><div class="form-group"><label class="form-label" for="allocation-quota">流量额度（GB）</label><input type="number" min="0.01" max="102400" step="0.01" class="form-input" id="allocation-quota" value="${Number(user.quota_bytes) / 1073741824}" required></div>
      <div class="form-group"><label class="form-label" for="allocation-used">已用流量（GB）</label><input type="number" min="0" step="0.01" class="form-input" id="allocation-used" value="${Number(user.used_bytes) / 1073741824}" required></div></div>
      <div class="form-group"><label class="form-label" for="allocation-expiry">到期时间（留空表示永不过期）</label><input type="datetime-local" class="form-input" id="allocation-expiry" value="${this.dateTimeInput(user.expires_at)}"></div>
      <p class="form-error" id="admin-form-error"></p><div class="dialog-actions"><button class="btn btn-primary" type="submit">保存订阅</button><button class="btn btn-ghost text-danger" type="button" id="allocation-revoke">撤销订阅</button></div></form>`, () => {
      document.getElementById('admin-allocation-form').addEventListener('submit', (event) => this.submitModal(event, () => {
        const input = document.getElementById('allocation-expiry').value;
        return api.adminUpdateAllocation(id, { quotaGb: Number(document.getElementById('allocation-quota').value), usedGb: Number(document.getElementById('allocation-used').value), expiresAt: input ? Math.floor(new Date(input).getTime() / 1000) : null });
      }, '订阅已更新'));
      document.getElementById('allocation-revoke').addEventListener('click', async () => {
        if (!window.confirm('确定撤销该用户当前订阅吗？订阅链接将立即失效。')) return;
        try { await api.adminRevokeAllocation(id); App.hideModal(); App.toast('订阅已撤销'); await this.refresh(); }
        catch (error) { document.getElementById('admin-form-error').textContent = error.message; }
      });
    });
  },

  openAssignment(id) {
    const user = this.data.users.find((item) => item.id === id); if (!user) return;
    const products = this.data.products.filter((item) => item.is_active);
    App.showModal('分配用户套餐', `<form id="admin-plan-form"><p class="dialog-summary"><strong>${App.escape(user.username)}</strong><span>分配后当前订阅链接将失效并重新生成。</span></p>
      <div class="form-group"><label class="form-label" for="admin-plan-product">套餐</label><select class="form-input" id="admin-plan-product" required>${products.map((product) => `<option value="${product.id}">${App.escape(product.name)} · ${App.escape(product.traffic_label)}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="admin-plan-expiry">自定义到期时间（可选）</label><input type="datetime-local" class="form-input" id="admin-plan-expiry"></div>
      <p class="form-error" id="admin-form-error"></p><button class="btn btn-primary" type="submit" ${products.length ? '' : 'disabled'}>确认分配</button></form>`, () => {
      document.getElementById('admin-plan-form').addEventListener('submit', (event) => this.submitModal(event, () => {
        const input = document.getElementById('admin-plan-expiry').value;
        return api.adminAssignProduct(id, { productId: document.getElementById('admin-plan-product').value, expiresAt: input ? Math.floor(new Date(input).getTime() / 1000) : undefined });
      }, '套餐已分配'));
    });
  },

  openNode(id) {
    const node = id ? this.data.nodes.find((item) => item.id === id) : null;
    const value = (key, fallback = '') => App.escape(node?.[key] ?? fallback);
    App.showModal(node ? '编辑节点' : '新增节点', `<form id="admin-node-form"><div class="form-grid">
      <div class="form-group"><label class="form-label" for="node-name">名称</label><input class="form-input" id="node-name" value="${value('name')}" required></div>
      <div class="form-group"><label class="form-label" for="node-address">服务器地址</label><input class="form-input" id="node-address" value="${value('address')}" required></div>
      <div class="form-group"><label class="form-label" for="node-port">端口</label><input type="number" min="1" max="65535" class="form-input" id="node-port" value="${value('port', 443)}" required></div>
      <div class="form-group"><label class="form-label" for="node-network">传输</label><select class="form-input" id="node-network">${['ws','tcp','grpc'].map((item) => `<option ${value('network','ws') === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="node-security">安全</label><select class="form-input" id="node-security">${['none','tls','reality'].map((item) => `<option ${value('security','tls') === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" for="node-sni">SNI</label><input class="form-input" id="node-sni" value="${value('sni')}"></div></div>
      <div class="form-group"><label class="form-label" for="node-path">Path / Service name</label><input class="form-input" id="node-path" value="${value('path','/')}"></div>
      <div class="form-grid"><div class="form-group"><label class="form-label" for="node-public-key">Reality public key</label><input class="form-input" id="node-public-key" value="${value('public_key')}"></div><div class="form-group"><label class="form-label" for="node-short-id">Reality short ID</label><input class="form-input" id="node-short-id" value="${value('short_id')}"></div>
      <div class="form-group"><label class="form-label" for="node-fingerprint">指纹</label><input class="form-input" id="node-fingerprint" value="${value('fingerprint','chrome')}"></div><div class="form-group"><label class="form-label" for="node-flow">Flow</label><input class="form-input" id="node-flow" value="${value('flow')}"></div>
      <div class="form-group"><label class="form-label" for="node-sort">排序</label><input type="number" class="form-input" id="node-sort" value="${value('sort_order',0)}"></div><label class="check-field"><input type="checkbox" id="node-active" ${node?.is_active === 0 ? '' : 'checked'}> 启用节点</label></div>
      <p class="form-error" id="admin-form-error"></p><button class="btn btn-primary" type="submit">保存节点</button></form>`, () => {
      document.getElementById('admin-node-form').addEventListener('submit', (event) => this.submitModal(event, () => {
        const payload = { name: document.getElementById('node-name').value, address: document.getElementById('node-address').value,
          port: Number(document.getElementById('node-port').value), protocol: 'vless', network: document.getElementById('node-network').value,
          security: document.getElementById('node-security').value, sni: document.getElementById('node-sni').value,
          path: document.getElementById('node-path').value, public_key: document.getElementById('node-public-key').value,
          short_id: document.getElementById('node-short-id').value, fingerprint: document.getElementById('node-fingerprint').value,
          flow: document.getElementById('node-flow').value, sort_order: Number(document.getElementById('node-sort').value),
          is_active: document.getElementById('node-active').checked };
        return node ? api.adminUpdateNode(id, payload) : api.adminCreateNode(payload);
      }, '节点已保存'));
    });
  },

  openProduct(id) {
    const product = id ? this.data.products.find((item) => item.id === id) : null;
    App.showModal(product ? '编辑套餐' : '新增套餐', `<form id="admin-product-form"><div class="form-group"><label class="form-label" for="product-name">套餐名称</label><input class="form-input" id="product-name" value="${App.escape(product?.name || '')}" required></div>
      <div class="form-grid"><div class="form-group"><label class="form-label" for="product-traffic">流量（GB）</label><input type="number" min="1" step="1" class="form-input" id="product-traffic" value="${product ? product.traffic_bytes / 1073741824 : 100}" required></div>
      <div class="form-group"><label class="form-label" for="product-price">价格（元）</label><input type="number" min="0" step="0.01" class="form-input" id="product-price" value="${product ? (product.price_cents / 100).toFixed(2) : '9.90'}" required></div>
      <div class="form-group"><label class="form-label" for="product-months">有效月数</label><input type="number" min="1" max="120" class="form-input" id="product-months" value="${product?.duration_months || 1}" required></div>
      <div class="form-group"><label class="form-label" for="product-sort">排序</label><input type="number" class="form-input" id="product-sort" value="${product?.sort_order || 0}"></div></div>
      <label class="check-field"><input type="checkbox" id="product-active" ${product?.is_active === 0 ? '' : 'checked'}> 上架套餐</label>
      <p class="form-error" id="admin-form-error"></p><button class="btn btn-primary" type="submit">保存套餐</button></form>`, () => {
      document.getElementById('admin-product-form').addEventListener('submit', (event) => this.submitModal(event, () => {
        const payload = { name: document.getElementById('product-name').value, trafficGb: Number(document.getElementById('product-traffic').value),
          priceCents: Math.round(Number(document.getElementById('product-price').value) * 100), durationMonths: Number(document.getElementById('product-months').value),
          sortOrder: Number(document.getElementById('product-sort').value), isActive: document.getElementById('product-active').checked };
        return product ? api.adminUpdateProduct(id, payload) : api.adminCreateProduct(payload);
      }, '套餐已保存'));
    });
  },

  openCodes() {
    const products = this.data.products.filter((item) => item.is_active);
    App.showModal('批量生成兑换码', `<form id="admin-code-form"><div class="form-group"><label class="form-label" for="code-product">套餐</label><select class="form-input" id="code-product">${products.map((product) => `<option value="${product.id}">${App.escape(product.name)}</option>`).join('')}</select></div>
      <div class="form-grid"><div class="form-group"><label class="form-label" for="code-count">数量</label><input type="number" min="1" max="100" class="form-input" id="code-count" value="10" required></div><div class="form-group"><label class="form-label" for="code-prefix">前缀</label><input class="form-input" id="code-prefix" value="CODE" maxlength="12"></div></div>
      <p class="form-error" id="admin-form-error"></p><button class="btn btn-primary" type="submit">生成兑换码</button></form>`, () => {
      document.getElementById('admin-code-form').addEventListener('submit', (event) => this.submitModal(event, async () => {
        const result = await api.adminCreateCodes({ productId: document.getElementById('code-product').value, count: Number(document.getElementById('code-count').value), prefix: document.getElementById('code-prefix').value });
        await navigator.clipboard.writeText(result.codes.join('\n')).catch(() => {});
        return result;
      }, '兑换码已生成，并已尝试复制到剪贴板'));
    });
  },

  async submitModal(event, action, message) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const errorElement = document.getElementById('admin-form-error');
    submit.disabled = true; errorElement.textContent = '';
    try { await action(); App.hideModal(); App.toast(message); await this.refresh(); }
    catch (error) { errorElement.textContent = error.message; }
    finally { submit.disabled = false; }
  },

  async submitSettings(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const errorElement = document.getElementById('admin-settings-error');
    submit.disabled = true; errorElement.textContent = '';
    try {
      await api.adminUpdateSettings({
        siteName: document.getElementById('settings-name').value,
        siteDescription: document.getElementById('settings-description').value,
        registrationEnabled: document.getElementById('settings-registration').checked,
        registrationQuotaGb: Number(document.getElementById('settings-registration-quota').value),
        checkinBonusMb: Number(document.getElementById('settings-checkin-bonus').value),
        statsPollIntervalSeconds: Number(document.getElementById('settings-poll').value),
      });
      App.toast('站点设置已保存');
      await this.refresh();
    } catch (error) { errorElement.textContent = error.message; }
    finally { submit.disabled = false; }
  },

  async deactivate(type, id) {
    if (!window.confirm('确定执行此操作吗？历史数据会保留。')) return;
    try {
      if (type === 'node') await api.adminDeleteNode(id);
      else if (type === 'product') await api.adminDeleteProduct(id);
      else await api.adminDeleteCode(id);
      App.toast('操作成功'); await this.refresh();
    } catch (error) { App.toast(error.message, 'error'); }
  },
};
