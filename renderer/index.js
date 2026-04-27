const api = window.desktopApi;
const contentEl = document.getElementById('content');
const modalEl = document.getElementById('modal');
const modalBox = document.getElementById('modalBox');
const taskCountBadge = document.getElementById('taskCountBadge');
const alertBadge = document.getElementById('alertBadge');
const sideTime = document.getElementById('sideTime');

const state = {
  route: 'overview',
  tasks: [],
  runs: [],
  alerts: [],
  stats: { todayCount: 0, todayAlerts: 0, todayErrors: 0 },
  config: null,
  logs: [],
  running: new Map(),
};

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString();
}

function fmtDuration(ms) {
  if (!ms && ms !== 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m${rs}s`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusPill(status) {
  const map = {
    never: ['paused', '未执行'],
    ok: ['ok', '正常'],
    alert: ['alert', '异常'],
    error: ['err', '出错'],
    err: ['err', '出错'],
    running: ['running', '执行中'],
  };
  const [cls, label] = map[status] || ['paused', String(status || '-')];
  return `<span class="status-pill ${cls}">${label}</span>`;
}

function alertStatePill(s) {
  const map = {
    active: ['err', '未处理'],
    ack: ['ack', '已确认'],
    silenced: ['silenced', '已静默'],
    recovered: ['recovered', '已恢复'],
  };
  const [cls, label] = map[s] || ['paused', s];
  return `<span class="status-pill ${cls}">${label}</span>`;
}

function setRoute(route) {
  state.route = route;
  for (const el of document.querySelectorAll('.nav-item')) {
    el.classList.toggle('active', el.dataset.route === route);
  }
  render();
}

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => setRoute(el.dataset.route));
});

setInterval(() => {
  sideTime.textContent = new Date().toLocaleTimeString();
}, 1000);

api.onLog((line) => {
  state.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500);
  const logEl = document.getElementById('globalLog');
  if (logEl) {
    logEl.textContent = state.logs.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }
});

api.onSchedulerEvent(async (evt) => {
  if (evt.type === 'run-start' || evt.type === 'run-finish' || evt.type === 'run-update') {
    if (evt.run) state.running.set(evt.run.taskId, evt.run);
    if (evt.type === 'run-finish') {
      state.running.delete(evt.run.taskId);
      await refreshDataSilent();
      render();
    } else if (state.route === 'overview' || state.route === 'runs' || state.route === 'tasks') {
      render();
    }
  } else if (evt.type === 'alert-new' || evt.type === 'alert-update' || evt.type === 'alert-recovered') {
    await refreshAlerts();
    render();
  } else if (evt.type === 'open-alert') {
    setRoute('alerts');
  }
});

async function refreshDataSilent() {
  try {
    const [tasks, runs, st, alerts, cfg] = await Promise.all([
      api.listTasks(),
      api.listRuns(null, 30),
      api.stats(),
      api.listAlerts(),
      api.loadConfig(),
    ]);
    state.tasks = tasks || [];
    state.runs = runs || [];
    state.stats = st || state.stats;
    state.alerts = alerts || [];
    state.config = cfg;
    updateBadges();
  } catch (e) {
    console.error(e);
  }
}

async function refreshAlerts() {
  state.alerts = (await api.listAlerts()) || [];
  updateBadges();
}

function updateBadges() {
  taskCountBadge.textContent = state.tasks.length ? String(state.tasks.length) : '';
  const unresolved = state.alerts.filter((a) => a.state === 'active' || a.state === 'ack').length;
  alertBadge.textContent = unresolved ? String(unresolved) : '';
}

function render() {
  switch (state.route) {
    case 'overview': renderOverview(); break;
    case 'tasks': renderTasks(); break;
    case 'runs': renderRuns(); break;
    case 'alerts': renderAlerts(); break;
    case 'settings': renderSettings(); break;
    default: renderOverview();
  }
}

function renderOverview() {
  const cfg = state.config;
  const nextTask = [...state.tasks]
    .filter((t) => !t.paused && t.schedule.enabled && t.nextRunAt)
    .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))[0];

  contentEl.innerHTML = `
    <div class="page-header">
      <div><h2>总览</h2><div class="sub">专用值守电脑的巡检状态一览</div></div>
    </div>

    <div class="grid">
      <div class="stat">
        <div class="label">Bridge 端口</div>
        <div class="value">${cfg?.bridgePort ?? '-'}</div>
        <div class="muted" style="margin-top:.35rem">需桌面 Chrome 安装 Midscene 扩展并点击「允许连接」</div>
      </div>
      <div class="stat">
        <div class="label">任务总数 / 启用中</div>
        <div class="value">${state.tasks.length} / ${state.tasks.filter((t) => !t.paused && t.schedule.enabled).length}</div>
      </div>
      <div class="stat ${state.stats.todayAlerts > 0 ? 'warn' : 'ok'}">
        <div class="label">今日执行 / 异常 / 出错</div>
        <div class="value">${state.stats.todayCount} · ${state.stats.todayAlerts} · ${state.stats.todayErrors}</div>
      </div>
      <div class="stat">
        <div class="label">下次计划执行</div>
        <div class="value" style="font-size:1rem">${nextTask ? escapeHtml(nextTask.name) : '-'}</div>
        <div class="muted" style="margin-top:.35rem">${nextTask ? fmtTime(nextTask.nextRunAt) : '暂无计划'}</div>
      </div>
    </div>

    <div class="card">
      <h3>正在执行</h3>
      ${renderRunningList()}
    </div>

    <div class="card">
      <h3>最近执行记录</h3>
      ${renderRunsTable(state.runs.slice(0, 8), true)}
    </div>

    <div class="card">
      <h3>实时日志</h3>
      <pre class="log" id="globalLog">${escapeHtml(state.logs.join('\n'))}</pre>
    </div>
  `;

  const logEl = document.getElementById('globalLog');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

function renderRunningList() {
  const running = Array.from(state.running.values());
  if (!running.length) return '<div class="muted">无任务执行中。</div>';
  return `<table class="table">
    <thead><tr><th>任务</th><th>开始时间</th><th>状态</th></tr></thead>
    <tbody>
      ${running.map((r) => `<tr>
        <td>${escapeHtml(r.taskName)}</td>
        <td>${fmtTime(r.startedAt)}</td>
        <td>${statusPill('running')}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function renderTasks() {
  contentEl.innerHTML = `
    <div class="page-header">
      <div><h2>任务</h2><div class="sub">结构化巡检任务；默认新建标签页执行。</div></div>
      <div class="row">
        <button class="primary" id="btnNewTask">新建任务</button>
      </div>
    </div>
    <div id="taskList">
      ${state.tasks.length ? state.tasks.map(renderTaskCard).join('') : '<div class="empty">还没有任务，点右上角「新建任务」开始。</div>'}
    </div>
  `;

  document.getElementById('btnNewTask').addEventListener('click', () => openTaskWizard(null));

  for (const card of document.querySelectorAll('[data-task-id]')) {
    const id = card.dataset.taskId;
    card.querySelector('[data-action="run"]')?.addEventListener('click', async () => {
      await api.runTaskNow(id);
    });
    card.querySelector('[data-action="edit"]')?.addEventListener('click', () => openTaskWizard(id));
    card.querySelector('[data-action="pause"]')?.addEventListener('click', async () => {
      const t = state.tasks.find((x) => x.id === id);
      if (t) await api.pauseTask(id, !t.paused);
      await refreshDataSilent();
      render();
    });
    card.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      if (!confirm('确认删除此任务？相关执行记录将保留，可在执行记录页查看。')) return;
      await api.deleteTask(id);
      await refreshDataSilent();
      render();
    });
    card.querySelector('[data-action="runs"]')?.addEventListener('click', () => {
      state.filterTaskId = id;
      setRoute('runs');
    });
  }
}

function renderTaskCard(t) {
  const interval = t.schedule.intervalMinutes;
  return `
  <div class="task-card" data-task-id="${t.id}">
    <div>
      <div class="row" style="gap:.4rem">
        <span class="title">${escapeHtml(t.name)}</span>
        ${t.paused ? '<span class="status-pill paused">已暂停</span>' : statusPill(t.lastStatus)}
      </div>
      <div class="meta">
        <span>系统：${escapeHtml(t.systemName || '-')}</span>
        <span>模式：${t.runMode === 'currentTab' ? 'currentTab（调试）' : 'newTabWithUrl'}</span>
        <span>频率：每 ${interval} 分钟（${t.schedule.activeFrom}-${t.schedule.activeTo}）</span>
        <span>规则数：${t.rules?.length || 0}</span>
        <span>上次：${fmtTime(t.lastRunAt)}</span>
        <span>下次：${fmtTime(t.nextRunAt)}</span>
      </div>
    </div>
    <div class="row">
      <button class="small" data-action="run">立即执行</button>
      <button class="small" data-action="edit">编辑</button>
      <button class="small" data-action="runs">记录</button>
      <button class="small" data-action="pause">${t.paused ? '恢复' : '暂停'}</button>
      <button class="small danger ghost" data-action="delete">删除</button>
    </div>
  </div>`;
}

function renderRuns() {
  const runs = state.filterTaskId
    ? state.runs.filter((r) => r.taskId === state.filterTaskId)
    : state.runs;
  const filtered = state.filterTaskId
    ? state.tasks.find((t) => t.id === state.filterTaskId)?.name || ''
    : '';

  contentEl.innerHTML = `
    <div class="page-header">
      <div><h2>执行记录</h2><div class="sub">${filtered ? `筛选：${escapeHtml(filtered)}` : '最近 30 条所有任务执行'}</div></div>
      <div class="row">
        ${state.filterTaskId ? `<button class="small" id="btnClearFilter">清除筛选</button>` : ''}
        <button class="small" id="btnRefreshRuns">刷新</button>
      </div>
    </div>
    ${renderRunsTable(runs, false)}
  `;

  document.getElementById('btnClearFilter')?.addEventListener('click', () => {
    state.filterTaskId = null;
    render();
  });
  document.getElementById('btnRefreshRuns')?.addEventListener('click', async () => {
    await refreshDataSilent();
    render();
  });

  for (const btn of document.querySelectorAll('[data-run-view]')) {
    btn.addEventListener('click', () => openRunDetail(btn.dataset.runView));
  }
  for (const btn of document.querySelectorAll('[data-run-report]')) {
    btn.addEventListener('click', () => api.openReport(btn.dataset.runReport));
  }
}

function renderRunsTable(runs, compact) {
  if (!runs.length) return '<div class="empty">暂无执行记录。</div>';
  return `<table class="table">
    <thead><tr>
      <th>任务</th><th>开始</th><th>耗时</th><th>状态</th><th>命中规则</th><th></th>
    </tr></thead>
    <tbody>
      ${runs.map((r) => {
        const failed = (r.ruleResults || []).filter((x) => !x.ok).length;
        return `<tr>
          <td>${escapeHtml(r.taskName)}</td>
          <td>${fmtTime(r.startedAt)}</td>
          <td>${fmtDuration(r.durationMs)}</td>
          <td>${statusPill(r.status)}</td>
          <td>${failed ? `<span class="status-pill alert">${failed}</span>` : (r.status === 'ok' ? '-' : '-')}</td>
          <td class="row" style="justify-content:flex-end;gap:.35rem">
            <button class="small" data-run-view="${r.id}">详情</button>
            ${r.reportPath ? `<button class="small" data-run-report="${escapeHtml(r.reportPath)}">报告</button>` : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function openRunDetail(runId) {
  const rec = await api.getRun(runId);
  if (!rec) return alert('记录不存在');
  openModal({
    title: `执行详情 · ${rec.taskName}`,
    body: `
      <dl class="kv">
        <dt>开始 / 结束</dt><dd>${fmtTime(rec.startedAt)} → ${fmtTime(rec.finishedAt)}</dd>
        <dt>耗时</dt><dd>${fmtDuration(rec.durationMs)}</dd>
        <dt>状态</dt><dd>${statusPill(rec.status)}</dd>
        <dt>错误</dt><dd>${escapeHtml(rec.error || '无')}</dd>
        <dt>报告</dt><dd>${rec.reportPath ? `<a href="#" id="openReportLink">${escapeHtml(rec.reportPath)}</a>` : '无'}</dd>
      </dl>
      <div class="section-title"><h3>提取结果</h3></div>
      <pre class="log">${escapeHtml(JSON.stringify(rec.extracted, null, 2))}</pre>
      <div class="section-title"><h3>规则判定</h3></div>
      ${
        (rec.ruleResults || []).length
          ? `<table class="table"><thead><tr><th>规则</th><th>严重度</th><th>结果</th><th>说明</th></tr></thead><tbody>${rec.ruleResults.map((r) => `<tr><td>${escapeHtml(r.ruleId)}</td><td>${r.severity}</td><td>${r.ok ? '<span class="status-pill ok">通过</span>' : '<span class="status-pill alert">未通过</span>'}</td><td>${escapeHtml(r.message)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="muted">无规则</div>'
      }
      <div class="section-title"><h3>执行日志</h3></div>
      <pre class="log">${escapeHtml((rec.log || []).join('\n'))}</pre>
    `,
    primary: null,
    onRender: () => {
      document.getElementById('openReportLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        api.openReport(rec.reportPath);
      });
    },
  });
}

function renderAlerts() {
  const alerts = state.alerts;
  contentEl.innerHTML = `
    <div class="page-header">
      <div><h2>告警中心</h2><div class="sub">异常事件；支持确认 / 静默 / 手动标记恢复</div></div>
      <div class="row"><button class="small" id="btnRefreshAlerts">刷新</button></div>
    </div>
    ${
      alerts.length
        ? alerts.map((a) => `
          <div class="alert-row" data-alert-id="${a.id}">
            <div>
              <div class="row" style="gap:.4rem">
                <span class="msg">${escapeHtml(a.taskName)}</span>
                ${alertStatePill(a.state)}
                <span class="status-pill ${a.lastSeverity === 'critical' ? 'err' : 'alert'}">${a.lastSeverity}</span>
              </div>
              <div class="detail">${escapeHtml(a.lastMessage)}</div>
              <div class="detail">首次：${fmtTime(a.firstSeenAt)} · 最近：${fmtTime(a.lastSeenAt)} · 计数：${a.count}${a.recoveredAt ? ' · 恢复：' + fmtTime(a.recoveredAt) : ''}${a.silencedUntil ? ' · 静默至：' + fmtTime(a.silencedUntil) : ''}</div>
            </div>
            <div class="row">
              ${a.state === 'active' ? '<button class="small" data-alert-action="ack">确认</button>' : ''}
              ${a.state !== 'silenced' && a.state !== 'recovered' ? '<button class="small" data-alert-action="silence">静默 1 小时</button>' : ''}
              ${a.state !== 'recovered' ? '<button class="small primary" data-alert-action="recover">标记恢复</button>' : ''}
              ${a.lastRunId ? `<button class="small" data-alert-view="${a.lastRunId}">最近执行</button>` : ''}
            </div>
          </div>
        `).join('')
        : '<div class="empty">暂无告警。</div>'
    }
  `;

  document.getElementById('btnRefreshAlerts')?.addEventListener('click', async () => {
    await refreshAlerts();
    render();
  });

  for (const row of document.querySelectorAll('[data-alert-id]')) {
    const id = row.dataset.alertId;
    row.querySelectorAll('[data-alert-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.alertAction;
        await api.updateAlertState(id, action, action === 'silence' ? 60 : undefined);
        await refreshAlerts();
        render();
      });
    });
    row.querySelectorAll('[data-alert-view]').forEach((btn) => {
      btn.addEventListener('click', () => openRunDetail(btn.dataset.alertView));
    });
  }
}

function renderSettings() {
  const cfg = state.config || {};
  const d = cfg.defaultModel || {};
  const p = cfg.planningModel;
  const i = cfg.insightModel;

  contentEl.innerHTML = `
    <div class="page-header">
      <div><h2>设置</h2><div class="sub">连接方式仅 Bridge；模型支持分层配置。</div></div>
    </div>

    <div class="card">
      <h3>Bridge 连接</h3>
      <p class="hint">桌面 Chrome 需安装 <a href="https://midscenejs.com/bridge-mode" target="_blank" rel="noreferrer">Midscene 扩展</a>，在扩展里切到 Bridge 模式并点击「允许连接」。</p>
      <label class="field">Bridge 端口</label>
      <input id="bridgePort" type="number" min="1" max="65535" step="1" value="${cfg.bridgePort ?? 3766}" />
      <label class="toggle" style="margin-top:.75rem">
        <input id="notifSound" type="checkbox" ${cfg.notificationSound !== false ? 'checked' : ''} />
        告警时使用系统默认声音
      </label>
      <div class="row" style="margin-top:.75rem">
        <button class="primary" id="btnSaveBridge">保存</button>
        <span class="muted" id="saveBridgeHint"></span>
      </div>
    </div>

    <div class="card">
      <h3>默认执行模型（必填 · 视觉多模态）</h3>
      <p class="hint">用于元素定位以及未单独配置的其他意图。AGENTS.md 要求此模型不可缺省、不可用纯文本模型。</p>
      <div class="row-2">
        <div><label class="field">API Key</label><input id="defApiKey" type="password" value="${escapeHtml(d.apiKey || '')}" /></div>
        <div><label class="field">Base URL</label><input id="defBaseUrl" type="url" value="${escapeHtml(d.baseUrl || '')}" /></div>
      </div>
      <div class="row-2">
        <div><label class="field">模型名称</label><input id="defModelName" type="text" value="${escapeHtml(d.modelName || '')}" /></div>
        <div><label class="field">MIDSCENE_MODEL_FAMILY</label><input id="defModelFamily" type="text" value="${escapeHtml(d.modelFamily || '')}" /></div>
      </div>
      <div class="row" style="margin-top:.75rem">
        <button class="primary" id="btnSaveDefault">保存默认模型</button>
        <span class="muted" id="saveDefHint"></span>
      </div>
    </div>

    <details class="collapse" ${p || i ? 'open' : ''}>
      <summary>高级模型策略（可选：Planning / Insight）</summary>
      <div class="collapse-body">
        <h4 style="margin:.25rem 0 .5rem;font-size:.9rem">任务规划 Planning 模型（aiAct / ai）</h4>
        <p class="hint">规划 **不是** 纯文本通道；建议选择对 UI 交互理解较好的多模态模型。留空走默认模型。</p>
        <div class="row-2">
          <div><label class="field">API Key</label><input id="planApiKey" type="password" value="${escapeHtml(p?.apiKey || '')}" /></div>
          <div><label class="field">Base URL</label><input id="planBaseUrl" type="url" value="${escapeHtml(p?.baseUrl || '')}" /></div>
        </div>
        <div class="row-2">
          <div><label class="field">模型名称</label><input id="planModelName" type="text" value="${escapeHtml(p?.modelName || '')}" /></div>
          <div><label class="field">FAMILY</label><input id="planModelFamily" type="text" value="${escapeHtml(p?.modelFamily || '')}" /></div>
        </div>

        <h4 style="margin:1rem 0 .5rem;font-size:.9rem">页面理解 Insight 模型（aiQuery / aiAssert / aiAsk / aiWaitFor）</h4>
        <p class="hint">巡检场景最常用。留空走默认模型。</p>
        <div class="row-2">
          <div><label class="field">API Key</label><input id="insApiKey" type="password" value="${escapeHtml(i?.apiKey || '')}" /></div>
          <div><label class="field">Base URL</label><input id="insBaseUrl" type="url" value="${escapeHtml(i?.baseUrl || '')}" /></div>
        </div>
        <div class="row-2">
          <div><label class="field">模型名称</label><input id="insModelName" type="text" value="${escapeHtml(i?.modelName || '')}" /></div>
          <div><label class="field">FAMILY</label><input id="insModelFamily" type="text" value="${escapeHtml(i?.modelFamily || '')}" /></div>
        </div>

        <div class="row" style="margin-top:.85rem">
          <button class="primary" id="btnSaveAdv">保存高级模型</button>
          <button class="small" id="btnClearPlan">清除 Planning</button>
          <button class="small" id="btnClearIns">清除 Insight</button>
          <span class="muted" id="saveAdvHint"></span>
        </div>
      </div>
    </details>
  `;

  document.getElementById('btnSaveBridge').addEventListener('click', async () => {
    const port = Number.parseInt(document.getElementById('bridgePort').value, 10);
    await api.saveConfig({
      bridgePort: Number.isFinite(port) ? port : 3766,
      notificationSound: document.getElementById('notifSound').checked,
    });
    document.getElementById('saveBridgeHint').textContent = '已保存';
    await refreshDataSilent();
  });

  document.getElementById('btnSaveDefault').addEventListener('click', async () => {
    await api.saveConfig({
      defaultModel: {
        apiKey: document.getElementById('defApiKey').value,
        baseUrl: document.getElementById('defBaseUrl').value,
        modelName: document.getElementById('defModelName').value,
        modelFamily: document.getElementById('defModelFamily').value,
      },
    });
    document.getElementById('saveDefHint').textContent = '已保存';
    await refreshDataSilent();
  });

  document.getElementById('btnSaveAdv').addEventListener('click', async () => {
    await api.saveConfig({
      planningModel: {
        apiKey: document.getElementById('planApiKey').value,
        baseUrl: document.getElementById('planBaseUrl').value,
        modelName: document.getElementById('planModelName').value,
        modelFamily: document.getElementById('planModelFamily').value,
      },
      insightModel: {
        apiKey: document.getElementById('insApiKey').value,
        baseUrl: document.getElementById('insBaseUrl').value,
        modelName: document.getElementById('insModelName').value,
        modelFamily: document.getElementById('insModelFamily').value,
      },
    });
    document.getElementById('saveAdvHint').textContent = '已保存';
    await refreshDataSilent();
  });

  document.getElementById('btnClearPlan').addEventListener('click', async () => {
    await api.saveConfig({ planningModel: null });
    await refreshDataSilent();
    render();
  });
  document.getElementById('btnClearIns').addEventListener('click', async () => {
    await api.saveConfig({ insightModel: null });
    await refreshDataSilent();
    render();
  });
}

// -------------- Task Wizard (5 steps) --------------

const WIZARD_STEPS = [
  '连接与运行方式',
  '目标页面',
  '就绪与取数',
  '异常规则',
  '调度与告警',
];

function openTaskWizard(taskId) {
  const tpl = {
    name: '',
    systemName: '',
    entryUrl: '',
    description: '',
    runMode: 'newTabWithUrl',
    closeTabAfter: true,
    readyPrompt: '请在页面上确认主要指标卡片/表格已经加载完成',
    extractPrompt: '请提取页面上的关键指标，返回 JSON 对象',
    extractSchema: '',
    loginAssertPrompt: '当前页面是业务后台页面，不是登录页、错误页、空白页',
    rules: [],
    schedule: {
      enabled: true,
      intervalMinutes: 10,
      activeFrom: '00:00',
      activeTo: '23:59',
      timeoutSeconds: 180,
      retry: 1,
    },
    alert: { enabled: true, repeatSuppressMinutes: 30 },
    paused: false,
  };
  const existing = taskId ? state.tasks.find((t) => t.id === taskId) : null;
  const draft = JSON.parse(JSON.stringify(existing || tpl));
  let step = 0;

  const renderStep = () => {
    modalBox.innerHTML = `
      <div class="modal-head">
        <h3>${existing ? '编辑任务' : '新建任务'} · ${WIZARD_STEPS[step]}</h3>
        <button class="ghost" id="wzClose">关闭</button>
      </div>
      <div class="modal-body">
        <div class="stepper">
          ${WIZARD_STEPS.map((s, i) => `<div class="step ${i === step ? 'active' : i < step ? 'done' : ''}">${i + 1}. ${s}</div>`).join('')}
        </div>
        <div id="wzBody">${renderWizardBody(step, draft)}</div>
      </div>
      <div class="modal-foot">
        <div class="row">
          ${step === 2 ? '<button class="small" id="wzTest">测试执行一次</button><span class="muted" id="wzTestHint"></span>' : ''}
        </div>
        <div class="row">
          ${step > 0 ? '<button id="wzPrev">上一步</button>' : ''}
          ${step < WIZARD_STEPS.length - 1 ? '<button class="primary" id="wzNext">下一步</button>' : '<button class="primary" id="wzSave">保存</button>'}
        </div>
      </div>
    `;
    bindWizard();
  };

  const bindWizard = () => {
    document.getElementById('wzClose').addEventListener('click', closeModal);
    document.getElementById('wzPrev')?.addEventListener('click', () => {
      readStep(step, draft);
      step--;
      renderStep();
    });
    document.getElementById('wzNext')?.addEventListener('click', () => {
      if (!readStep(step, draft, true)) return;
      step++;
      renderStep();
    });
    document.getElementById('wzSave')?.addEventListener('click', async () => {
      if (!readStep(step, draft, true)) return;
      if (existing) {
        await api.updateTask(existing.id, draft);
      } else {
        await api.createTask(draft);
      }
      await refreshDataSilent();
      closeModal();
      setRoute('tasks');
    });
    document.getElementById('wzTest')?.addEventListener('click', async () => {
      readStep(step, draft);
      const hint = document.getElementById('wzTestHint');
      hint.textContent = '运行中…';
      const res = await api.testExtract(draft);
      if (!res.ok) {
        hint.textContent = '失败: ' + res.error;
        return;
      }
      hint.textContent = '完成：' + res.result.status + '，规则命中 ' + (res.result.ruleResults || []).filter((r) => !r.ok).length + ' 条';
      const body = document.getElementById('wzBody');
      const preview = document.createElement('pre');
      preview.className = 'log';
      preview.textContent = JSON.stringify(res.result.extracted, null, 2);
      body.appendChild(preview);
    });
    bindStepInputs(step, draft);
  };

  openModalRaw();
  renderStep();
}

function renderWizardBody(step, d) {
  if (step === 0) {
    return `
      <label class="field">任务名称</label>
      <input id="f_name" type="text" value="${escapeHtml(d.name)}" placeholder="例：订单系统-实时成交量" />
      <label class="field">目标系统（分组用）</label>
      <input id="f_systemName" type="text" value="${escapeHtml(d.systemName)}" />
      <label class="field">运行方式</label>
      <select id="f_runMode">
        <option value="newTabWithUrl" ${d.runMode !== 'currentTab' ? 'selected' : ''}>newTabWithUrl（推荐，定时任务）</option>
        <option value="currentTab" ${d.runMode === 'currentTab' ? 'selected' : ''}>currentTab（调试/手动）</option>
      </select>
      <label class="toggle" style="margin-top:.5rem">
        <input id="f_closeTabAfter" type="checkbox" ${d.closeTabAfter !== false ? 'checked' : ''} />
        任务结束后关闭自动打开的新标签页（仅 newTabWithUrl）
      </label>
      <p class="hint" style="margin-top:.6rem">AGENTS.md 建议：定时任务默认 <code>newTabWithUrl</code>，手动调试使用 <code>currentTab</code>。</p>
    `;
  }
  if (step === 1) {
    return `
      <label class="field">入口 URL（newTabWithUrl 必填）</label>
      <input id="f_entryUrl" type="url" value="${escapeHtml(d.entryUrl)}" placeholder="https://..." />
      <label class="field">页面说明 / 业务术语（作为 aiActContext 传给模型）</label>
      <textarea id="f_description" rows="4" placeholder="例：左侧菜单→统计分析→实时订单；金额单位为元；异常颜色 #f00 表示未支付">${escapeHtml(d.description)}</textarea>
    `;
  }
  if (step === 2) {
    return `
      <label class="field">页面就绪条件（aiWaitFor）</label>
      <textarea id="f_readyPrompt" rows="2">${escapeHtml(d.readyPrompt)}</textarea>
      <label class="field">粗粒度检查（aiAssert，用于排除登录页/错误页）</label>
      <textarea id="f_loginAssertPrompt" rows="2">${escapeHtml(d.loginAssertPrompt)}</textarea>
      <label class="field">结构化提取 Prompt（aiQuery）</label>
      <textarea id="f_extractPrompt" rows="3">${escapeHtml(d.extractPrompt)}</textarea>
      <label class="field">返回 Schema（可选，自然语言描述）</label>
      <textarea id="f_extractSchema" rows="3" placeholder='例：{ "orderCount": number, "todayAmount": number, "items": Array<{status:string,count:number}> }'>${escapeHtml(d.extractSchema)}</textarea>
      <p class="hint">建议先按步骤用「测试执行一次」验证 Prompt 与 Schema 能稳定返回结构化数据，再到下一步配置规则。</p>
    `;
  }
  if (step === 3) {
    return `
      <p class="hint">规则作用于 aiQuery 返回的 JSON；支持数值阈值、缺失检查、JS 表达式（变量名 <code>data</code>）。</p>
      <div id="rulesBox">${d.rules.map(renderRuleRow).join('')}</div>
      <div class="row" style="margin-top:.5rem">
        <button class="small" data-add-rule="threshold">+ 数值阈值</button>
        <button class="small" data-add-rule="missing">+ 缺失检查</button>
        <button class="small" data-add-rule="expression">+ JS 表达式</button>
      </div>
    `;
  }
  if (step === 4) {
    return `
      <div class="row-2">
        <div>
          <label class="toggle"><input id="f_schedEnabled" type="checkbox" ${d.schedule.enabled ? 'checked' : ''}/> 启用定时巡检</label>
          <label class="field">执行间隔（分钟）</label>
          <input id="f_interval" type="number" min="1" step="1" value="${d.schedule.intervalMinutes}" />
          <label class="field">工作时段（从）</label>
          <input id="f_from" type="time" value="${d.schedule.activeFrom}" />
          <label class="field">工作时段（到）</label>
          <input id="f_to" type="time" value="${d.schedule.activeTo}" />
        </div>
        <div>
          <label class="field">单次超时（秒）</label>
          <input id="f_timeout" type="number" min="30" step="10" value="${d.schedule.timeoutSeconds}" />
          <label class="field">失败重试次数</label>
          <input id="f_retry" type="number" min="0" step="1" value="${d.schedule.retry}" />
          <label class="toggle" style="margin-top:.75rem"><input id="f_alertEnabled" type="checkbox" ${d.alert.enabled ? 'checked' : ''}/> 异常/出错时本地告警</label>
          <label class="field">持续告警抑制（分钟）</label>
          <input id="f_alertSuppress" type="number" min="1" step="1" value="${d.alert.repeatSuppressMinutes}" />
        </div>
      </div>
    `;
  }
  return '';
}

function renderRuleRow(rule) {
  if (rule.type === 'expression') {
    return `<div class="rule-row expression" data-rule-id="${escapeHtml(rule.id || '')}">
      <select class="rule-type"><option value="threshold">阈值</option><option value="missing">缺失</option><option value="expression" selected>表达式</option></select>
      <input class="rule-expr" value="${escapeHtml(rule.expression || '')}" placeholder="例如: data.orderCount >= 10 && data.todayAmount > 0" />
      <select class="rule-severity">${['info','warning','critical'].map((s) => `<option value="${s}" ${s === (rule.severity || 'warning') ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="small danger ghost" data-del-rule>删</button>
    </div>`;
  }
  if (rule.type === 'missing') {
    return `<div class="rule-row missing" data-rule-id="${escapeHtml(rule.id || '')}">
      <select class="rule-type"><option value="threshold">阈值</option><option value="missing" selected>缺失</option><option value="expression">表达式</option></select>
      <input class="rule-field" value="${escapeHtml(rule.field || '')}" placeholder="字段路径，如 items 或 stats.total" />
      <input class="rule-msg" value="${escapeHtml(rule.message || '')}" placeholder="失败提示（可选）" />
      <select class="rule-severity">${['info','warning','critical'].map((s) => `<option value="${s}" ${s === (rule.severity || 'warning') ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="small danger ghost" data-del-rule>删</button>
    </div>`;
  }
  return `<div class="rule-row" data-rule-id="${escapeHtml(rule.id || '')}">
    <select class="rule-type"><option value="threshold" selected>阈值</option><option value="missing">缺失</option><option value="expression">表达式</option></select>
    <input class="rule-field" value="${escapeHtml(rule.field || '')}" placeholder="字段路径" />
    <select class="rule-op">${['>','>=','<','<=','==','!=','between'].map((o) => `<option value="${o}" ${o === (rule.op || '>=') ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <input class="rule-value" value="${escapeHtml(rule.value ?? '')}" placeholder="阈值或下限" />
    <select class="rule-severity">${['info','warning','critical'].map((s) => `<option value="${s}" ${s === (rule.severity || 'warning') ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <button class="small danger ghost" data-del-rule>删</button>
  </div>`;
}

function bindStepInputs(step, d) {
  if (step === 3) {
    const box = document.getElementById('rulesBox');
    const addBtns = document.querySelectorAll('[data-add-rule]');
    addBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.addRule;
        const rule = { id: 'r_' + Math.random().toString(36).slice(2, 8), type: t, severity: 'warning' };
        if (t === 'threshold') Object.assign(rule, { field: '', op: '>=', value: '' });
        if (t === 'missing') Object.assign(rule, { field: '' });
        if (t === 'expression') Object.assign(rule, { expression: '' });
        box.insertAdjacentHTML('beforeend', renderRuleRow(rule));
        bindRuleDeleteButtons(box);
      });
    });
    bindRuleDeleteButtons(box);
  }
}

function bindRuleDeleteButtons(box) {
  box.querySelectorAll('[data-del-rule]').forEach((btn) => {
    btn.onclick = () => btn.closest('[data-rule-id]').remove();
  });
}

function readStep(step, d, strict) {
  if (step === 0) {
    d.name = document.getElementById('f_name').value.trim();
    d.systemName = document.getElementById('f_systemName').value.trim();
    d.runMode = document.getElementById('f_runMode').value;
    d.closeTabAfter = document.getElementById('f_closeTabAfter').checked;
    if (strict && !d.name) { alert('请填写任务名称'); return false; }
  } else if (step === 1) {
    d.entryUrl = document.getElementById('f_entryUrl').value.trim();
    d.description = document.getElementById('f_description').value;
    if (strict && d.runMode !== 'currentTab' && !d.entryUrl) {
      alert('newTabWithUrl 模式需要入口 URL');
      return false;
    }
  } else if (step === 2) {
    d.readyPrompt = document.getElementById('f_readyPrompt').value;
    d.loginAssertPrompt = document.getElementById('f_loginAssertPrompt').value;
    d.extractPrompt = document.getElementById('f_extractPrompt').value;
    d.extractSchema = document.getElementById('f_extractSchema').value;
  } else if (step === 3) {
    const rows = document.querySelectorAll('#rulesBox [data-rule-id]');
    const rules = [];
    rows.forEach((row) => {
      const type = row.querySelector('.rule-type').value;
      const severity = row.querySelector('.rule-severity').value;
      const id = row.dataset.ruleId || 'r_' + Math.random().toString(36).slice(2, 8);
      if (type === 'threshold') {
        rules.push({ id, type, severity,
          field: row.querySelector('.rule-field').value.trim(),
          op: row.querySelector('.rule-op').value,
          value: row.querySelector('.rule-value').value,
        });
      } else if (type === 'missing') {
        rules.push({ id, type, severity,
          field: row.querySelector('.rule-field').value.trim(),
          message: row.querySelector('.rule-msg').value,
        });
      } else {
        rules.push({ id, type, severity,
          expression: row.querySelector('.rule-expr').value,
        });
      }
    });
    d.rules = rules;
  } else if (step === 4) {
    d.schedule.enabled = document.getElementById('f_schedEnabled').checked;
    d.schedule.intervalMinutes = Math.max(1, Number(document.getElementById('f_interval').value) || 10);
    d.schedule.activeFrom = document.getElementById('f_from').value || '00:00';
    d.schedule.activeTo = document.getElementById('f_to').value || '23:59';
    d.schedule.timeoutSeconds = Math.max(30, Number(document.getElementById('f_timeout').value) || 180);
    d.schedule.retry = Math.max(0, Number(document.getElementById('f_retry').value) || 0);
    d.alert.enabled = document.getElementById('f_alertEnabled').checked;
    d.alert.repeatSuppressMinutes = Math.max(1, Number(document.getElementById('f_alertSuppress').value) || 30);
  }
  return true;
}

// Modal helpers
function openModalRaw() {
  modalEl.classList.remove('hidden');
}
function openModal({ title, body, onRender }) {
  modalBox.innerHTML = `
    <div class="modal-head">
      <h3>${escapeHtml(title)}</h3>
      <button class="ghost" id="modalCloseBtn">关闭</button>
    </div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">
      <span></span>
      <button class="primary" id="modalOkBtn">关闭</button>
    </div>
  `;
  modalEl.classList.remove('hidden');
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalOkBtn').addEventListener('click', closeModal);
  onRender?.();
}
function closeModal() {
  modalEl.classList.add('hidden');
  modalBox.innerHTML = '';
}

// Boot
(async () => {
  await refreshDataSilent();
  render();
  setInterval(async () => {
    if (state.route === 'overview') {
      await refreshDataSilent();
      if (state.route === 'overview') render();
    }
  }, 15_000);
})();
