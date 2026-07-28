// Admin Page (Phase 6)
const AdminPage = {
  render() {
    document.getElementById('app').innerHTML = 
      <div class="dashboard-page">
        <nav class="topbar">
          <a href="#" class="topbar-brand" onclick="App.navigate('/')">
            <div class="topbar-brand-icon">🚀</div>
            ProxySubscription
          </a>
          <div class="topbar-spacer"></div>
          <button class="btn btn-ghost btn-sm" onclick="App.navigate('/')">返回首页</button>
          <button class="theme-toggle" onclick="App.toggleTheme()" style="position:static;width:32px;height:32px;font-size:16px">
            \
          </button>
          <button class="btn btn-ghost btn-sm" onclick="App.logout()">退出登录</button>
        </nav>
        <div class="shell">
          <div class="panel">
            <div class="panel-header">
              <div class="panel-title">⚙️ 管理后台</div>
            </div>
            <div class="panel-body">
              <p class="text-muted">管理后台功能将在 Phase 6 中实现，包括：</p>
              <ul style="margin:12px 0 0 20px;color:var(--muted);font-size:14px;line-height:2">
                <li>用户管理（列表、封禁）</li>
                <li>节点管理（增删改查）</li>
                <li>套餐管理</li>
                <li>兑换码批量生成</li>
                <li>数据统计看板</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    ;
  },
};
