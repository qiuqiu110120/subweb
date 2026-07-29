const LoginPage = {
  isLogin: true,

  render() {
    const mode = this.isLogin ? '登录' : '注册';
    document.getElementById('app').innerHTML = `
      <main class="login-page">
        <button class="theme-toggle" type="button" data-theme-icon title="切换主题" aria-label="切换主题">${App.themeIcon()}</button>
        <section class="login-card" aria-labelledby="login-title">
          <img class="login-logo" src="/assets/logo.svg" alt="ProxySubscription">
          <header class="login-brand">
            <p class="login-eyebrow">Proxy Subscription</p>
            <h1 class="login-title" id="login-title">代理订阅服务</h1>
            <p class="login-desc">高速稳定的代理订阅服务平台</p>
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
          <p class="login-footer">
            ${this.isLogin ? '还没有账号？' : '已有账号？'}
            <button class="text-button" type="button" id="auth-toggle">${this.isLogin ? '立即注册' : '返回登录'}</button>
          </p>
        </section>
      </main>`;
    document.querySelector('[data-theme-icon]').addEventListener('click', () => App.toggleTheme());
    document.getElementById('auth-toggle').addEventListener('click', () => {
      this.isLogin = !this.isLogin;
      this.render();
    });
    document.getElementById('auth-form').addEventListener('submit', (event) => this.handleSubmit(event));
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
      App.navigate('/');
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = this.isLogin ? '登录' : '注册';
    }
  },
};
