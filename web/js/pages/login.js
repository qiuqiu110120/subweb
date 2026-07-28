// Login / Register Page
const LoginPage = {
  isLogin: true,

  render() {
    const mode = this.isLogin ? '登录' : '注册';
    document.getElementById('app').innerHTML = 
      <div class="login-page">
        <button class="theme-toggle" onclick="App.toggleTheme()" title="切换主题">
          \
        </button>
        <div class="login-card">
          <div class="login-logo">🚀</div>
          <div class="login-brand">
            <div class="login-eyebrow">Proxy Subscription</div>
            <div class="login-title">代理订阅服务</div>
            <div class="login-desc">高速稳定的代理订阅服务平台</div>
          </div>
          <div class="login-pills">
            <span class="pill">VLESS 协议</span>
            <span class="pill">自建节点</span>
            <span class="pill">高速稳定</span>
          </div>
          <form id="auth-form" onsubmit="LoginPage.handleSubmit(event)">
            <div class="form-group">
              <label class="form-label">邮箱地址</label>
              <input type="email" class="form-input" id="auth-email"
                     placeholder="请输入邮箱" required autocomplete="email">
            </div>
            <div class="form-group">
              <label class="form-label">密码</label>
              <input type="password" class="form-input" id="auth-password"
                     placeholder="请输入密码（至少6位）" required minlength="6"
                     autocomplete="\">
            </div>
            <div id="auth-error" class="text-danger text-sm mb-md" style="display:none"></div>
            <button type="submit" class="btn btn-primary" id="auth-submit">
              \
            </button>
          </form>
          <p class="login-footer">
            \
            <a href="#" onclick="LoginPage.toggleMode()">
              \
            </a>
          </p>
        </div>
      </div>
    ;
  },

  toggleMode() {
    this.isLogin = !this.isLogin;
    this.render();
  },

  async handleSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('auth-submit');
    const errorEl = document.getElementById('auth-error');

    if (!email || !password) {
      errorEl.textContent = '请填写所有字段';
      errorEl.style.display = 'block';
      return;
    }

    if (password.length < 6) {
      errorEl.textContent = '密码至少需要6个字符';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '处理中...';
    errorEl.style.display = 'none';

    try {
      const data = this.isLogin
        ? await api.login(email, password)
        : await api.register(email, password);

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      App.toast(this.isLogin ? '登录成功' : '注册成功', 'success');
      App.navigate('/');
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = this.isLogin ? '登录' : '注册';
    }
  },
};
