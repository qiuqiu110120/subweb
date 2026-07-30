const LoginPage = {
  isLogin: true,
  siteInfo: { name: 'ProxySubscription', description: '高速稳定的代理订阅服务平台', registrationEnabled: true },
  siteInfoLoaded: false,

  render() {
    const mode = this.isLogin ? '登录' : '注册';
    document.getElementById('app').innerHTML = `
      <main class="login-page">
        <button class="theme-toggle" type="button" data-theme-icon title="切换主题" aria-label="切换主题">${App.themeIcon()}</button>
        <section class="login-card" aria-labelledby="login-title">
          <img class="login-logo" src="/assets/logo.svg" alt="ProxySubscription">
          <header class="login-brand">
            <p class="login-eyebrow">Proxy Subscription</p>
            <h1 class="login-title" id="login-title">${App.escape(this.siteInfo.name)}</h1>
            <p class="login-desc">${App.escape(this.siteInfo.description)}</p>
          </header>
          <div class="login-pills" aria-label="服务特性">
            <span class="pill">VLESS 协议</span><span class="pill">自建节点</span><span class="pill">高速稳定</span>
          </div>
          <form id="auth-form">
            ${this.isLogin ? '' : `
              <div class="form-group">
                <label class="form-label" for="auth-username">用户名</label>
                <input class="form-input" id="auth-username" minlength="2" maxlength="32" autocomplete="username" required>
              </div>`}
            <div class="form-group">
              <label class="form-label" for="auth-email">邮箱地址</label>
              <input type="email" class="form-input" id="auth-email" maxlength="254" autocomplete="email" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="auth-password">密码</label>
              <input type="password" class="form-input" id="auth-password" minlength="8" maxlength="72" autocomplete="${this.isLogin ? 'current-password' : 'new-password'}" required>
            </div>
            <p class="form-error" id="auth-error" role="alert"></p>
            <button type="submit" class="btn btn-primary" id="auth-submit">${mode}</button>
          </form>
          ${this.siteInfo.registrationEnabled || !this.isLogin ? `<p class="login-footer">
            ${this.isLogin ? '还没有账号？' : '已有账号？'}
            <button class="text-button" type="button" id="auth-toggle">${this.isLogin ? '立即注册' : '返回登录'}</button>
          </p>` : ''}
          <p class="login-footer admin-setup-entry" id="admin-setup-entry" hidden>
            尚未创建管理员？<button class="text-button" type="button" id="admin-setup-button">初始化管理员</button>
          </p>
        </section>
      </main>`;
    document.querySelector('[data-theme-icon]').addEventListener('click', () => App.toggleTheme());
    document.getElementById('auth-toggle')?.addEventListener('click', () => {
      this.isLogin = !this.isLogin;
      this.render();
    });
    document.getElementById('auth-form').addEventListener('submit', (event) => this.handleSubmit(event));
    this.loadAdminSetupStatus();
    this.loadSiteInfo();
  },

  async loadSiteInfo() {
    if (this.siteInfoLoaded) return;
    try {
      const data = await api.siteInfo();
      this.siteInfoLoaded = true;
      const changed = data.name !== this.siteInfo.name || data.description !== this.siteInfo.description || data.registrationEnabled !== this.siteInfo.registrationEnabled;
      this.siteInfo = { ...this.siteInfo, ...data };
      if (!this.siteInfo.registrationEnabled && !this.isLogin) this.isLogin = true;
      if (changed && document.getElementById('login-title')) this.render();
    } catch { this.siteInfoLoaded = true; }
  },

  async loadAdminSetupStatus() {
    try {
      const status = await api.adminSetupStatus();
      const entry = document.getElementById('admin-setup-entry');
      if (!entry || !status.required) return;
      entry.hidden = false;
      const button = document.getElementById('admin-setup-button');
      button.textContent = status.configured ? '初始化管理员' : '服务端尚未配置初始化令牌';
      button.disabled = !status.configured;
      if (status.configured) button.addEventListener('click', () => this.showAdminSetup());
    } catch { /* The regular login remains available. */ }
  },

  showAdminSetup() {
    App.showModal('初始化管理员', `
      <form id="admin-setup-form">
        <div class="form-group">
          <label class="form-label" for="setup-token">初始化令牌</label>
          <input type="password" class="form-input" id="setup-token" autocomplete="off" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="setup-username">管理员名称</label>
          <input class="form-input" id="setup-username" minlength="2" maxlength="32" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="setup-email">管理员邮箱</label>
          <input type="email" class="form-input" id="setup-email" maxlength="254" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="setup-password">管理员密码</label>
          <input type="password" class="form-input" id="setup-password" minlength="10" maxlength="72" autocomplete="new-password" required>
        </div>
        <p class="form-error" id="setup-error" role="alert"></p>
        <button class="btn btn-primary" type="submit">创建管理员</button>
      </form>`, () => {
      document.getElementById('admin-setup-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = event.currentTarget.querySelector('button[type="submit"]');
        const errorElement = document.getElementById('setup-error');
        submit.disabled = true;
        errorElement.textContent = '';
        try {
          await api.adminBootstrap({
            token: document.getElementById('setup-token').value,
            username: document.getElementById('setup-username').value.trim(),
            email: document.getElementById('setup-email').value.trim(),
            password: document.getElementById('setup-password').value,
          });
          App.hideModal();
          App.toast('管理员创建成功，请登录');
          this.render();
        } catch (error) {
          errorElement.textContent = error.message;
        } finally { submit.disabled = false; }
      });
    });
  },

  async handleSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const username = document.getElementById('auth-username')?.value.trim();
    const button = document.getElementById('auth-submit');
    const errorElement = document.getElementById('auth-error');
    errorElement.textContent = '';
    button.disabled = true;
    button.textContent = '处理中…';
    try {
      const data = this.isLogin ? await api.login(email, password) : await api.register(email, password, username);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      App.state.token = data.token;
      App.toast(this.isLogin ? '登录成功' : '注册成功');
      App.navigate(data.user.role === 'admin' ? '/admin' : '/');
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = this.isLogin ? '登录' : '注册';
    }
  },
};
