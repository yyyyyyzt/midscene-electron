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

function fmtCountdown(ts) {
  if (!ts) return '-';
  const diff = ts - Date.now();
  if (diff <= 0) return '即将执行';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `还有 ${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `还有 ${min} 分钟`;
  const hr = Math.floor(min / 60);
  return `还有 ${hr} 小时 ${min % 60} 分`;
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

function defaultDeveloperExtract() {
  return {
    mode: 'http',
    method: 'GET',
    url: '',
    headers: {},
    body: '',
    preScript: '',
    pageScript: '',
    fieldMappings: [],
  };
}

function ensureDeveloperExtract(d) {
  if (!d.developerExtract || typeof d.developerExtract !== 'object') {
    d.developerExtract = defaultDeveloperExtract();
  } else {
    d.developerExtract = { ...defaultDeveloperExtract(), ...d.developerExtract };
    if (!d.developerExtract.headers || typeof d.developerExtract.headers !== 'object') {
      d.developerExtract.headers = {};
    }
    if (!Array.isArray(d.developerExtract.fieldMappings)) d.developerExtract.fieldMappings = [];
  }
}

function devHeadersText(d) {
  try {
    return JSON.stringify(d.developerExtract?.headers || {}, null, 2);
  } catch {
    return '{}';
  }
}

function renderDevMappingRows(mappings) {
  const list = Array.isArray(mappings) && mappings.length ? mappings : [{ key: '', path: '', expression: '' }];
  return list.map((m, i) => `<div class="dev-map-row" data-i="${i}">
    <input class="dev-map-key" type="text" placeholder="输出字段名，如 stats.total" value="${escapeHtml(m.key || '')}" />
    <input class="dev-map-path" type="text" placeholder="JSON 路径，如 data.items.0.count" value="${escapeHtml(m.path || '')}" />
    <input class="dev-map-expr" type="text" placeholder="或 JS 表达式（优先），如 raw.json.total" value="${escapeHtml(m.expression || '')}" />
    <button type="button" class="small danger ghost dev-map-del" title="删除">×</button>
  </div>`).join('');
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

const VALID_ALERT_UI_STATES = new Set(['active', 'ack', 'silenced', 'recovered']);

/** @param {unknown} raw */
function normalizeAlertStateForUi(raw) {
  if (raw == null || raw === '') return 'active';
  const s = String(raw).trim().toLowerCase();
  if (VALID_ALERT_UI_STATES.has(s)) return /** @type {'active' | 'ack' | 'silenced' | 'recovered'} */ (s);
  return 'active';
}

function alertStatePill(s) {
  const st = normalizeAlertStateForUi(s);
  const map = {
    active: ['err', '未处理'],
    ack: ['ack', '已确认'],
    silenced: ['silenced', '已静默'],
    recovered: ['recovered', '已恢复'],
  };
  const [cls, label] = map[st] || ['paused', String(s || '-')];
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
  const needsAttention = state.alerts.filter((a) => normalizeAlertStateForUi(a.state) === 'active').length;
  alertBadge.textContent = needsAttention ? String(needsAttention) : '';
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
  const enabledTasks = state.tasks.filter((t) => !t.paused && t.schedule.enabled !== false);
  const nextTask = [...enabledTasks]
    .filter((t) => t.nextRunAt)
    .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))[0];

  contentEl.innerHTML = `
    <div class="page-header">
      <div><h2>总览</h2><div class="sub">专用值守电脑的巡检状态一览</div></div>
      <div class="row"><button class="small" id="btnOnboarding">新手引导</button></div>
    </div>

    <div class="grid">
      <div class="stat">
        <div class="label">Bridge 端口</div>
        <div class="value">${cfg?.bridgePort ?? '-'}</div>
        <div class="muted" style="margin-top:.35rem">需桌面 Chrome 安装 Midscene 扩展并点击「允许连接」</div>
      </div>
      <div class="stat">
        <div class="label">任务总数 / 启用中</div>
        <div class="value">${state.tasks.length} / ${enabledTasks.length}</div>
      </div>
      <div class="stat ${state.stats.todayAlerts > 0 ? 'warn' : 'ok'}">
        <div class="label">今日执行 / 异常 / 出错</div>
        <div class="value">${state.stats.todayCount} · ${state.stats.todayAlerts} · ${state.stats.todayErrors}</div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="card">
        <h3>当前执行</h3>
        ${renderRunningList()}
      </div>
      <div class="card">
        <h3>下一个计划执行</h3>
        ${nextTask ? `
          <div class="row" style="gap:.5rem;margin-bottom:.4rem">
            <span class="status-pill ok">定时中</span>
            <strong>${escapeHtml(nextTask.name)}</strong>
          </div>
          <dl class="kv">
            <dt>计划时间</dt><dd>${fmtTime(nextTask.nextRunAt)}（${fmtCountdown(nextTask.nextRunAt)}）</dd>
            <dt>系统</dt><dd>${escapeHtml(nextTask.systemName || '-')}</dd>
            <dt>频率</dt><dd>每 ${nextTask.schedule.intervalMinutes} 分钟（${nextTask.schedule.activeFrom}-${nextTask.schedule.activeTo}）</dd>
          </dl>
        ` : '<div class="muted">暂无启用中的任务计划。</div>'}
      </div>
    </div>

    <div class="card">
      <h3>实时日志</h3>
      <pre class="log" id="globalLog">${escapeHtml(state.logs.join('\n'))}</pre>
    </div>
  `;

  const logEl = document.getElementById('globalLog');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;

  document.getElementById('btnOnboarding')?.addEventListener('click', () => {
    openOnboardingModal();
  });
}

function openOnboardingModal() {
  const cfg = state.config || {};
  const needSetup = !cfg?.defaultModel?.apiKey;
  const noTask = state.tasks.length === 0;
  openModal({
    title: '新手引导',
    body: `
      <ol style="padding-left:1.2rem;line-height:1.95">
        <li>在桌面 Chrome 安装 <a href="https://midscenejs.com/bridge-mode" target="_blank" rel="noreferrer">Midscene 扩展</a> 并切到 Bridge 模式。</li>
        <li>${needSetup ? '<a href="#" data-route-link="settings">前往「设置」</a> 填写默认执行模型（API Key / Base URL / 模型名 / Family）。豆包接入：Base URL <code>https://ark.cn-beijing.volces.com/api/v3</code>，Model 例如 <code>doubao-seed-2-0-mini-260215</code>，Family <code>doubao-seed</code>。' : '<span class="muted">设置：默认模型已就绪。</span>'}</li>
        <li>${noTask ? '<a href="#" data-route-link="tasks">前往「任务」</a> 点「新建任务（AI 帮手）」，用一句话描述要监控什么；如有复杂操作可在 Recorder 录制后粘贴 YAML / Playwright 代码。' : '<span class="muted">任务：已有 ' + state.tasks.length + ' 个任务。</span>'}</li>
        <li>在桌面 Chrome 中手工登录目标系统，让扩展点击「允许连接」即可。</li>
        <li>回到本工具点「立即执行」或等待调度触发，结果会写到执行记录与告警中心。</li>
      </ol>
    `,
    onRender: () => {
      document.querySelectorAll('[data-route-link]').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          closeModal();
          setRoute(a.dataset.routeLink);
        });
      });
    },
  });
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
        <button class="primary" id="btnNewTask">+ 新建任务（AI 帮手）</button>
        <button class="small ghost" id="btnNewTaskAdvanced">高级模式</button>
      </div>
    </div>
    <div id="taskList">
      ${state.tasks.length ? state.tasks.map(renderTaskCard).join('') : '<div class="empty">还没有任务，点右上角「新建任务」开始。</div>'}
    </div>
  `;

  document.getElementById('btnNewTask').addEventListener('click', () => openTaskAssistant());
  document.getElementById('btnNewTaskAdvanced')?.addEventListener('click', () => openTaskWizard(null));

  for (const card of document.querySelectorAll('[data-task-id]')) {
    const id = card.dataset.taskId;
    card.querySelector('[data-action="run"]')?.addEventListener('click', async () => {
      await api.runTaskNow(id);
    });
    card.querySelector('[data-action="edit"]')?.addEventListener('click', () => openTaskWizard(id));
    card.querySelector('[data-action="toggle"]')?.addEventListener('click', async () => {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) return;
      const willEnable = t.paused || t.schedule.enabled === false;
      await api.pauseTask(id, !willEnable);
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
  const scheduleEnabled = t.schedule.enabled !== false && !t.paused;
  return `
  <div class="task-card" data-task-id="${t.id}">
    <div>
      <div class="row" style="gap:.4rem">
        <span class="title">${escapeHtml(t.name)}</span>
        ${scheduleEnabled ? '<span class="status-pill ok">定时中</span>' : '<span class="status-pill paused">已暂停</span>'}
        ${statusPill(t.lastStatus)}
      </div>
      <div class="meta">
        <span>系统：${escapeHtml(t.systemName || '-')}</span>
        <span>模式：${t.runMode === 'currentTab' ? 'currentTab（调试）' : 'newTabWithUrl'}</span>
        <span>频率：每 ${interval} 分钟（${t.schedule.activeFrom}-${t.schedule.activeTo}）</span>
        <span>规则数：${t.rules?.length || 0}</span>
        ${t.flowYaml ? `<span>📜 含 ${t.flowSource === 'playwright' ? 'PW' : t.flowSource === 'yaml' ? 'YAML' : '操作'} 流程</span>` : ''}
        <span>上次：${fmtTime(t.lastRunAt)}</span>
        <span>下次：${scheduleEnabled ? fmtTime(t.nextRunAt) : '-'}</span>
      </div>
    </div>
    <div class="row">
      <button class="small primary" data-action="run">测试执行一次</button>
      <button class="small" data-action="toggle">${scheduleEnabled ? '暂停定时' : '开启定时'}</button>
      <button class="small" data-action="edit">编辑</button>
      <button class="small" data-action="runs">记录</button>
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

  if (!state.runSelection) state.runSelection = new Set();
  // 清掉不在当前列表的选项
  const visibleIds = new Set(runs.map((r) => r.id));
  for (const id of [...state.runSelection]) if (!visibleIds.has(id)) state.runSelection.delete(id);

  contentEl.innerHTML = `
    <div class="page-header">
      <div><h2>执行记录</h2><div class="sub">${filtered ? `筛选：${escapeHtml(filtered)}` : '最近 30 条所有任务执行'}</div></div>
      <div class="row">
        ${state.filterTaskId ? `<button class="small" id="btnClearFilter">清除筛选</button>` : ''}
        <button class="small" id="btnRefreshRuns">刷新</button>
        <button class="small danger ghost" id="btnDeleteSelectedRuns" ${state.runSelection.size ? '' : 'disabled'}>删除所选 (<span id="runSelCount">${state.runSelection.size}</span>)</button>
        <button class="small danger ghost" id="btnClearRuns">${state.filterTaskId ? '清空当前任务记录' : '清空全部记录'}</button>
      </div>
    </div>
    ${renderRunsTable(runs, false)}
  `;

  document.getElementById('btnClearFilter')?.addEventListener('click', () => {
    state.filterTaskId = null;
    state.runSelection = new Set();
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

  document.querySelectorAll('[data-run-check]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.runCheck;
      if (cb.checked) state.runSelection.add(id);
      else state.runSelection.delete(id);
      const c = document.getElementById('runSelCount');
      if (c) c.textContent = String(state.runSelection.size);
      const del = document.getElementById('btnDeleteSelectedRuns');
      if (del) del.disabled = state.runSelection.size === 0;
      const head = document.getElementById('runCheckAll');
      if (head) head.checked = runs.length > 0 && runs.every((r) => state.runSelection.has(r.id));
    });
  });

  document.getElementById('runCheckAll')?.addEventListener('change', (e) => {
    if (e.target.checked) for (const r of runs) state.runSelection.add(r.id);
    else state.runSelection.clear();
    render();
  });

  document.getElementById('btnDeleteSelectedRuns')?.addEventListener('click', async () => {
    const ids = [...state.runSelection];
    if (!ids.length) return;
    if (!confirm(`确认删除选中的 ${ids.length} 条执行记录？`)) return;
    await api.deleteRuns(ids);
    state.runSelection = new Set();
    await refreshDataSilent();
    render();
  });

  document.getElementById('btnClearRuns')?.addEventListener('click', async () => {
    const scope = state.filterTaskId ? '当前任务' : '全部';
    if (!confirm(`确认清空${scope}的执行记录？此操作不可撤销。`)) return;
    await api.clearRuns(state.filterTaskId || null);
    state.runSelection = new Set();
    await refreshDataSilent();
    render();
  });
}

function renderRunsTable(runs, compact) {
  if (!runs.length) return '<div class="empty">暂无执行记录。</div>';
  const showCheck = !compact;
  const selection = state.runSelection || new Set();
  const allChecked = runs.length > 0 && runs.every((r) => selection.has(r.id));
  return `<table class="table">
    <thead><tr>
      ${showCheck ? `<th style="width:32px"><input type="checkbox" id="runCheckAll" ${allChecked ? 'checked' : ''} /></th>` : ''}
      <th>任务</th><th>开始</th><th>耗时</th><th>状态</th><th>规则</th><th></th>
    </tr></thead>
    <tbody>
      ${runs.map((r) => {
        const total = (r.ruleResults || []).length;
        const triggered = (r.ruleResults || []).filter((x) => x.triggered ?? !x.ok).length;
        const tCell = total
          ? (triggered ? `<span class="status-pill alert">${triggered} / ${total} 触发</span>` : `<span class="status-pill ok">${total} 条 全部未触发</span>`)
          : '-';
        const checked = selection.has(r.id) ? 'checked' : '';
        return `<tr>
          ${showCheck ? `<td><input type="checkbox" data-run-check="${r.id}" ${checked} /></td>` : ''}
          <td>${escapeHtml(r.taskName)}</td>
          <td>${fmtTime(r.startedAt)}</td>
          <td>${fmtDuration(r.durationMs)}</td>
          <td>${statusPill(r.status)}</td>
          <td>${tCell}</td>
          <td class="row" style="justify-content:flex-end;gap:.35rem">
            <button class="small" data-run-view="${r.id}">详情</button>
            ${r.reportPath ? `<button class="small" data-run-report="${escapeHtml(r.reportPath)}">报告</button>` : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function renderPhaseTimeline(phases) {
  if (!phases?.length) return '<div class="muted">无阶段记录</div>';
  return `<table class="table">
    <thead><tr><th>步骤</th><th>状态</th><th>耗时</th><th>详情</th></tr></thead>
    <tbody>${phases.map((p) => {
      const cls = p.status === 'ok' ? 'ok' : p.status === 'error' ? 'err' : 'paused';
      const label = p.status === 'ok' ? '完成' : p.status === 'error' ? '失败' : '跳过';
      let detail = '';
      if (p.status === 'error') detail = escapeHtml(p.error || '');
      else if (typeof p.detail === 'string') detail = escapeHtml(p.detail);
      else if (p.detail && typeof p.detail === 'object') {
        if (p.name === 'connect') detail = `${escapeHtml(p.detail.runMode)} · ${escapeHtml(p.detail.entryUrl || '当前标签')}`;
        else if (p.name === 'extract') {
          if (p.detail?.extractSource === 'developer') {
            const req = p.detail.requestSummary ? `<pre class="log">${escapeHtml(JSON.stringify(p.detail.requestSummary, null, 2))}</pre>` : '';
            const mapErr = p.detail.mappingErrors?.length
              ? `<div class="muted">映射警告：${escapeHtml(p.detail.mappingErrors.join('；'))}</div>`
              : '';
            detail = `<div><span class="status-pill paused">developer · ${escapeHtml(p.detail.developerMode || '')}</span> · ${p.detail.durationMs ?? '-'} ms</div>
              ${req}
              <label class="field">原始响应摘要</label><pre class="log">${escapeHtml(p.detail.rawSummary || '')}</pre>
              <label class="field">字段映射结果（规则输入）</label><pre class="log">${escapeHtml(JSON.stringify(p.detail.mapped, null, 2))}</pre>
              ${mapErr}
              <details class="collapse"><summary>完整原始对象</summary><div class="collapse-body"><pre class="log">${escapeHtml(JSON.stringify(p.detail.rawFromPage, null, 2))}</pre></div></details>`;
          } else {
            detail = `<details class="collapse"><summary>查看提示词与返回</summary><div class="collapse-body"><label class="field">prompt</label><pre class="log">${escapeHtml(p.detail.prompt || '')}</pre><label class="field">value</label><pre class="log">${escapeHtml(JSON.stringify(p.detail.value, null, 2))}</pre></div></details>`;
          }
        }
        else if (p.name === 'flow') {
          const sr = p.detail.stepResults || [];
          const ok = sr.filter((s) => s.status === 'ok').length;
          const recovered = sr.filter((s) => s.status === 'recovered').length;
          const failed = sr.filter((s) => s.status === 'error').length;
          const w = (p.detail.warnings || []).length ? '；警告: ' + p.detail.warnings.join('；') : '';
          const head = `<div>${p.detail.source === 'playwright' ? 'Playwright' : 'YAML'} · 重放 ${p.detail.total} 步：通过 ${ok}${recovered ? `（兜底 ${recovered}）` : ''} / 失败 ${failed}${w}</div>`;
          const body = sr.length
            ? `<details class="collapse"><summary>查看每一步</summary><div class="collapse-body">${renderStepResults(sr)}</div></details>`
            : '';
          detail = head + body;
        }
        else if (p.name === 'rules') detail = `${p.detail.total} 条规则，触发 ${p.detail.triggered?.length || 0} 条`;
        else if (p.detail.prompt) detail = escapeHtml(p.detail.prompt);
      }
      return `<tr>
        <td>${escapeHtml(p.label)}</td>
        <td><span class="status-pill ${cls}">${label}</span></td>
        <td>${fmtDuration(p.durationMs)}</td>
        <td>${detail}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function renderRuleResultsCards(rs) {
  if (!rs?.length) return '<div class="muted">无规则</div>';
  return rs.map((r) => {
    const triggered = r.triggered ?? !r.ok;
    const headPill = triggered
      ? `<span class="status-pill alert">已触发</span>`
      : `<span class="status-pill ok">未触发</span>`;
    const whenLabel = (r.when || 'fail') === 'pass' ? '条件成立 → 通过' : '条件成立 → 报警';
    return `<div class="card" style="margin-bottom:.6rem">
      <div class="row" style="justify-content:space-between">
        <div class="row" style="gap:.4rem">
          <strong>${escapeHtml(r.ruleId)}</strong>
          <span class="status-pill ${r.severity === 'critical' ? 'err' : r.severity === 'info' ? 'paused' : 'alert'}">${escapeHtml(r.severity)}</span>
          <span class="muted">[${escapeHtml(r.ruleType || '')}]</span>
          <span class="muted">${escapeHtml(whenLabel)}</span>
        </div>
        ${headPill}
      </div>
      <dl class="kv" style="margin-top:.5rem">
        <dt>条件</dt><dd>${escapeHtml(r.conditionLabel || '')}</dd>
        <dt>条件成立</dt><dd>${r.conditionMet ? '是' : '否'}</dd>
        <dt>实际值</dt><dd><code>${escapeHtml(JSON.stringify(r.actual))}</code></dd>
        <dt>结论</dt><dd>${escapeHtml(r.message)}</dd>
        ${r.error ? `<dt>错误</dt><dd>${escapeHtml(r.error)}</dd>` : ''}
      </dl>
    </div>`;
  }).join('');
}

function buildRunMarkdown(rec) {
  const triggered = (rec.ruleResults || []).filter((r) => r.triggered ?? !r.ok);
  const lines = [];
  lines.push(`# 巡检记录 · ${rec.taskName}`);
  lines.push('');
  lines.push(`- 状态: **${rec.status}**`);
  lines.push(`- 开始: ${new Date(rec.startedAt).toISOString()}`);
  lines.push(`- 结束: ${rec.finishedAt ? new Date(rec.finishedAt).toISOString() : '-'}`);
  lines.push(`- 耗时: ${rec.durationMs ?? '-'} ms`);
  lines.push(`- 错误: ${rec.error || '无'}`);
  lines.push(`- 报告: ${rec.reportPath || '无'}`);
  lines.push('');
  lines.push('## 阶段时间线');
  lines.push('| 步骤 | 状态 | 耗时 | 备注 |');
  lines.push('|---|---|---|---|');
  for (const p of rec.phases || []) {
    let note = '';
    if (p.status === 'error') note = p.error || '';
    else if (p.detail && typeof p.detail === 'object') {
      if (p.name === 'connect') note = `${p.detail.runMode} ${p.detail.entryUrl || ''}`;
      else if (p.name === 'extract') {
        note = p.detail?.extractSource === 'developer'
          ? `developer · ${p.detail.developerMode || ''} · ${(p.detail.rawSummary || '').length} 字摘要`
          : `prompt 字数=${(p.detail.prompt || '').length}`;
      }
      else if (p.name === 'rules') note = `${p.detail.total} 条，触发 ${p.detail.triggered?.length || 0}`;
      else if (p.name === 'flow') {
        const sr = p.detail.stepResults || [];
        const ok = sr.filter((s) => s.status === 'ok').length;
        const recv = sr.filter((s) => s.status === 'recovered').length;
        const fail = sr.filter((s) => s.status === 'error').length;
        note = `${p.detail.source} · ${p.detail.total} 步 · ok=${ok} recovered=${recv} failed=${fail}`;
      }
    }
    lines.push(`| ${p.label} | ${p.status} | ${p.durationMs} ms | ${note.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  const flowPhase = (rec.phases || []).find((p) => p.name === 'flow');
  if (flowPhase?.detail?.stepResults?.length) {
    lines.push('## 操作流程逐步结果');
    lines.push('| # | 动作 | 定位 / 内容 | 状态 | 耗时 | 错误 |');
    lines.push('|---|---|---|---|---|---|');
    for (const s of flowPhase.detail.stepResults) {
      const desc = (s.description || '').replace(/\|/g, '\\|');
      const err = (s.error || '').replace(/\|/g, '\\|');
      lines.push(`| ${s.index + 1} | ${s.action} | ${desc} | ${s.status} | ${s.durationMs} ms | ${err} |`);
    }
    lines.push('');
  }
  lines.push('## 提取结果');
  lines.push('```json');
  lines.push(JSON.stringify(rec.extracted, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(`## 规则判定（共 ${(rec.ruleResults || []).length} 条，触发 ${triggered.length} 条）`);
  for (const r of rec.ruleResults || []) {
    const trig = r.triggered ?? !r.ok;
    lines.push(`### ${r.ruleId} · ${r.ruleType || ''} · ${r.severity} · when=${r.when || 'fail'} · ${trig ? '已触发' : '未触发'}`);
    lines.push(`- 条件: ${r.conditionLabel || ''}`);
    lines.push(`- 条件成立: ${r.conditionMet ? '是' : '否'}`);
    lines.push(`- 实际值: \`${JSON.stringify(r.actual)}\``);
    lines.push(`- 结论: ${r.message}`);
    if (r.error) lines.push(`- 错误: ${r.error}`);
    lines.push('');
  }
  lines.push('## 执行日志');
  lines.push('```');
  lines.push((rec.log || []).join('\n'));
  lines.push('```');
  return lines.join('\n');
}

async function openRunDetail(runId) {
  const rec = await api.getRun(runId);
  if (!rec) return alert('记录不存在');
  const triggered = (rec.ruleResults || []).filter((r) => r.triggered ?? !r.ok);
  const overview = `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:.4rem">
      <div class="row" style="gap:.5rem">
        ${statusPill(rec.status)}
        <strong>${escapeHtml(rec.taskName)}</strong>
        <span class="muted">${fmtTime(rec.startedAt)} → ${fmtTime(rec.finishedAt)}</span>
      </div>
      <div class="row" style="gap:.4rem">
        <button class="small" id="copyMdBtn">复制为 Markdown</button>
        ${rec.reportPath ? '<button class="small" id="openReportBtn">打开 Midscene 报告</button>' : ''}
      </div>
    </div>
    <dl class="kv" style="margin-top:.6rem">
      <dt>耗时</dt><dd>${fmtDuration(rec.durationMs)}</dd>
      <dt>规则触发</dt><dd>${triggered.length} / ${(rec.ruleResults || []).length}</dd>
      <dt>错误</dt><dd>${escapeHtml(rec.error || '无')}</dd>
      <dt>报告</dt><dd>${rec.reportPath ? `<code>${escapeHtml(rec.reportPath)}</code>` : '无'}</dd>
    </dl>
  `;

  openModal({
    title: `执行详情 · ${rec.taskName}`,
    body: `
      ${overview}
      <div class="section-title"><h3>① 阶段时间线</h3></div>
      ${renderPhaseTimeline(rec.phases || [])}
      <div class="section-title"><h3>② 提取结果（规则判定输入）</h3></div>
      <pre class="log">${escapeHtml(JSON.stringify(rec.extracted, null, 2))}</pre>
      <div class="section-title"><h3>③ 规则判定（${triggered.length} / ${(rec.ruleResults || []).length} 触发）</h3></div>
      ${renderRuleResultsCards(rec.ruleResults || [])}
      <div class="section-title"><h3>④ 执行日志</h3></div>
      <pre class="log">${escapeHtml((rec.log || []).join('\n'))}</pre>
    `,
    primary: null,
    onRender: () => {
      document.getElementById('openReportBtn')?.addEventListener('click', () => {
        api.openReport(rec.reportPath);
      });
      document.getElementById('copyMdBtn')?.addEventListener('click', async () => {
        const md = buildRunMarkdown(rec);
        try {
          await navigator.clipboard.writeText(md);
          document.getElementById('copyMdBtn').textContent = '已复制 ✓';
        } catch {
          alert(md);
        }
      });
    },
  });
}

function renderAlerts() {
  const alerts = state.alerts;

  contentEl.innerHTML = `
    <div class="page-header">
      <div><h2>告警中心</h2><div class="sub">未处理告警可点「确认无误」；确认后仅保留查看执行详情、删除。后台仍合并同类告警并在任务恢复时自动标记已恢复。</div></div>
      <div class="row">
        <button class="small" id="btnRefreshAlerts">刷新</button>
      </div>
    </div>
    ${
      alerts.length
        ? `<div class="muted" style="margin-bottom:.6rem">共 ${alerts.length} 条</div>` + alerts.map((a) => {
          const st = normalizeAlertStateForUi(a.state);
          const showAck = st === 'active';
          const ackTitle = '标记为已知晓（仍会继续合并计数与恢复检测）';
          const ackBtn = showAck
            ? `<button class="small" data-alert-action="ack" title="${escapeHtml(ackTitle)}">确认无误</button>`
            : '';
          return `
          <div class="alert-row" data-alert-id="${a.id}">
            <div>
              <div class="row" style="gap:.4rem;flex-wrap:wrap">
                <span class="msg">${escapeHtml(a.taskName)}</span>
                ${alertStatePill(st)}
                <span class="status-pill ${a.lastSeverity === 'critical' ? 'err' : 'alert'}">${a.lastSeverity}</span>
              </div>
              <div class="detail">${escapeHtml(a.lastMessage)}</div>
              <div class="detail">首次：${fmtTime(a.firstSeenAt)} · 最近：${fmtTime(a.lastSeenAt)} · 合并计数：${a.count}${a.recoveredAt ? ' · 恢复：' + fmtTime(a.recoveredAt) : ''}${a.silencedUntil ? ' · 曾静默至：' + fmtTime(a.silencedUntil) : ''}</div>
            </div>
            <div class="row alert-row-actions">
              ${ackBtn}
              <button class="small primary" data-alert-view="${a.lastRunId || ''}" ${a.lastRunId ? '' : 'disabled'} title="${a.lastRunId ? '打开对应执行记录' : '暂无关联执行记录'}">查看执行详情</button>
              <button class="small danger ghost" data-alert-delete="${a.id}">删除</button>
            </div>
          </div>
        `;
        }).join('')
        : '<div class="empty">暂无告警。</div>'
    }
  `;

  document.getElementById('btnRefreshAlerts')?.addEventListener('click', async () => {
    await refreshAlerts();
    render();
  });

  document.querySelectorAll('[data-alert-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('确认删除这条告警？')) return;
      await api.deleteAlerts([btn.dataset.alertDelete]);
      await refreshAlerts();
      render();
    });
  });

  for (const row of document.querySelectorAll('[data-alert-id]')) {
    const id = row.dataset.alertId;
    row.querySelectorAll('[data-alert-action="ack"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const updated = await api.updateAlertState(id, 'ack');
          if (updated == null) {
            alert('未找到该告警，可能已被删除');
          }
          await refreshAlerts();
          render();
        } catch (e) {
          btn.disabled = false;
          btn.textContent = prev;
          alert(e instanceof Error ? e.message : String(e));
        }
      });
    });
    row.querySelectorAll('[data-alert-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rid = btn.dataset.alertView;
        if (!rid) return;
        openRunDetail(rid);
      });
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
      <p class="hint">用于元素定位、AI 任务生成以及未单独配置的其他意图。豆包接入：Base URL <code>https://ark.cn-beijing.volces.com/api/v3</code>，Model 例如 <code>doubao-seed-2-0-mini-260215</code>，Family <code>doubao-seed</code>。</p>
      <div class="row-2">
        <div><label class="field">API Key</label><input id="defApiKey" type="text" value="${escapeHtml(d.apiKey || '')}" /></div>
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
          <div><label class="field">API Key</label><input id="planApiKey" type="text" value="${escapeHtml(p?.apiKey || '')}" /></div>
          <div><label class="field">Base URL</label><input id="planBaseUrl" type="url" value="${escapeHtml(p?.baseUrl || '')}" /></div>
        </div>
        <div class="row-2">
          <div><label class="field">模型名称</label><input id="planModelName" type="text" value="${escapeHtml(p?.modelName || '')}" /></div>
          <div><label class="field">FAMILY</label><input id="planModelFamily" type="text" value="${escapeHtml(p?.modelFamily || '')}" /></div>
        </div>

        <h4 style="margin:1rem 0 .5rem;font-size:.9rem">页面理解 Insight 模型（aiQuery / aiAssert / aiAsk / aiWaitFor）</h4>
        <p class="hint">巡检场景最常用。留空走默认模型。</p>
        <div class="row-2">
          <div><label class="field">API Key</label><input id="insApiKey" type="text" value="${escapeHtml(i?.apiKey || '')}" /></div>
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

// -------------- Task Assistant (one-shot AI) --------------

const ASSISTANT_EXAMPLES = [
  '每 10 分钟巡检 https://admin.example.com/orders 的「今日订单数」，少于 10 单时报警',
  '每 5 分钟看 https://crm.example.com/dashboard 的「待处理工单」是否大于 0，有就提醒我',
  '检查报表页 https://bi.example.com/sales 是否能正常打开、是否还显示「最近 30 分钟成交额」',
];

function openTaskAssistant() {
  let currentTask = null;
  let lastPrompt = '';
  let lastYaml = '';
  let yamlPreview = null;

  const renderAssistant = (phase) => {
    const examplesHtml = ASSISTANT_EXAMPLES
      .map((s) => `<button class="small ghost" data-example="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
      .join('');

    const summaryHtml = currentTask ? renderTaskSummary(currentTask) : '';

    modalBox.innerHTML = `
      <div class="modal-head">
        <h3>新建任务 · AI 帮手</h3>
        <button class="ghost" id="asstClose">关闭</button>
      </div>
      <div class="modal-body">
        <p class="hint">用一句中文描述你想监控的页面与异常条件；如果涉及下拉、滚动、点击等复杂导航，可以同时粘贴 Midscene Recorder 录制的 YAML，AI 会一并整合。</p>
        <label class="field">任务描述</label>
        <textarea id="asstPrompt" rows="3" placeholder="例如：监控腾讯云费用中心-资源包页面，资源包总览下拉选择「实时音视频」，找到总剩余量中的余量数值，低于 38 万分钟报警">${escapeHtml(lastPrompt)}</textarea>
        <div class="row" style="margin-top:.4rem;flex-wrap:wrap">
          <span class="muted">试试这些：</span>
          ${examplesHtml}
        </div>

        <details class="collapse" style="margin-top:.85rem" ${lastYaml ? 'open' : ''}>
          <summary>📜 操作流程（可选 · 粘贴 Recorder 输出的 YAML 或 Playwright 代码）</summary>
          <div class="collapse-body">
            <p class="hint">复杂交互（下拉、滚动、跨标签页跳转）建议用 Midscene 扩展的 Recorder 录制好再粘贴。系统会按录制顺序逐步重放，每步实时上报；某一步失败时可启用 AI 兜底。</p>
            <textarea id="asstYaml" rows="8" placeholder="可粘贴 Recorder 的 YAML 或 Playwright 代码 — 系统会自动识别格式">${escapeHtml(lastYaml)}</textarea>
            <div class="row" style="margin-top:.4rem">
              <button class="small" id="asstYamlPreview">解析并预览步骤</button>
              <span class="muted" id="asstYamlHint"></span>
            </div>
            <div id="asstYamlSteps">${yamlPreview ? renderFlowSteps(yamlPreview) : ''}</div>
          </div>
        </details>

        <div class="row" style="margin-top:.85rem">
          <button class="primary" id="asstGenerate" ${phase === 'loading' ? 'disabled' : ''}>${phase === 'loading' ? 'AI 正在生成…' : '生成任务'}</button>
          <button class="small" id="asstAdvanced">改用高级模式</button>
          <span class="muted" id="asstHint"></span>
        </div>

        <div id="asstResult">${summaryHtml}</div>
      </div>
      <div class="modal-foot">
        <span class="muted">${currentTask ? '可直接保存，也可微调 URL / 规则后再保存。' : '生成后可直接保存。'}</span>
        <div class="row">
          ${currentTask ? '<button class="small" id="asstOpenWizard">在向导里继续编辑</button>' : ''}
          <button class="primary" id="asstSave" ${currentTask ? '' : 'disabled'}>保存任务</button>
        </div>
      </div>
    `;
    bindAssistant();
  };

  const bindAssistant = () => {
    document.getElementById('asstClose').addEventListener('click', () => {
      closeModal();
    });
    document.getElementById('asstAdvanced').addEventListener('click', () => {
      closeModal();
      openTaskWizard(null);
    });
    document.querySelectorAll('[data-example]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('asstPrompt').value = btn.dataset.example;
        lastPrompt = btn.dataset.example;
      });
    });
    document.getElementById('asstYamlPreview')?.addEventListener('click', async () => {
      const txt = document.getElementById('asstYaml').value.trim();
      const hint = document.getElementById('asstYamlHint');
      const stepsBox = document.getElementById('asstYamlSteps');
      if (!txt) { hint.textContent = '请先粘贴 YAML'; stepsBox.innerHTML = ''; return; }
      const r = await api.parseFlow(txt);
      if (!r.ok) {
        hint.textContent = r.error || '解析失败';
        stepsBox.innerHTML = '';
        yamlPreview = null;
        return;
      }
      yamlPreview = r.steps;
      const meta = r.meta || {};
      const sourceLabel = r.source === 'playwright' ? 'Playwright 代码' : 'YAML';
      hint.textContent = `识别为 ${sourceLabel}，共 ${r.steps.length} 步${meta.entryUrl ? ' · ' + meta.entryUrl : ''}${r.warnings?.length ? ' · ' + r.warnings.join('；') : ''}`;
      stepsBox.innerHTML = renderFlowSteps(r.steps);
    });
    document.getElementById('asstGenerate').addEventListener('click', async () => {
      const desc = document.getElementById('asstPrompt').value.trim();
      const yamlText = document.getElementById('asstYaml')?.value?.trim() || '';
      lastPrompt = desc;
      lastYaml = yamlText;
      const hint = document.getElementById('asstHint');
      if (!desc && !yamlText) {
        hint.textContent = '请先输入任务描述或粘贴 YAML';
        return;
      }
      hint.textContent = '调用模型中…';
      renderAssistant('loading');
      try {
        const res = await api.generateTask(desc, yamlText);
        if (!res?.ok) {
          currentTask = null;
          renderAssistant('idle');
          document.getElementById('asstHint').textContent = res?.error || '生成失败';
          return;
        }
        currentTask = res.task;
        if (res.flowSummary) yamlPreview = res.flowSummary;
        renderAssistant('done');
      } catch (e) {
        currentTask = null;
        renderAssistant('idle');
        document.getElementById('asstHint').textContent = e instanceof Error ? e.message : String(e);
      }
    });
    document.getElementById('asstSave')?.addEventListener('click', async () => {
      if (!currentTask) return;
      await api.createTask(currentTask);
      await refreshDataSilent();
      closeModal();
      setRoute('tasks');
    });
    document.getElementById('asstOpenWizard')?.addEventListener('click', () => {
      const draft = currentTask;
      closeModal();
      openTaskWizard(null, draft);
    });

    // 编辑摘要里的 URL / 间隔
    document.getElementById('asstUrl')?.addEventListener('input', (e) => {
      if (currentTask) currentTask.entryUrl = e.target.value.trim();
    });
    document.getElementById('asstInterval')?.addEventListener('input', (e) => {
      const v = Math.max(1, Number(e.target.value) || 10);
      if (currentTask) currentTask.schedule.intervalMinutes = v;
    });
    document.getElementById('asstName')?.addEventListener('input', (e) => {
      if (currentTask) currentTask.name = e.target.value;
    });
  };

  openModalRaw();
  renderAssistant('idle');
}

function renderStepResults(steps) {
  return `<table class="table" style="margin-top:.35rem">
    <thead><tr><th style="width:48px">#</th><th style="width:130px">动作</th><th>定位 / 内容</th><th style="width:90px">状态</th><th style="width:80px">耗时</th></tr></thead>
    <tbody>${steps.map((s) => {
      const cls = s.status === 'ok' ? 'ok' : s.status === 'recovered' ? 'ack' : 'err';
      const label = s.status === 'ok' ? '通过' : s.status === 'recovered' ? '兜底通过' : '失败';
      return `<tr>
        <td>${s.index + 1}</td>
        <td><span class="status-pill paused">${escapeHtml(s.action)}</span></td>
        <td>${escapeHtml(s.description || '')}${s.error ? `<div class="muted" style="margin-top:.25rem">原始错误：${escapeHtml(s.error)}</div>` : ''}${s.recoveredError ? `<div class="muted" style="margin-top:.25rem">兜底错误：${escapeHtml(s.recoveredError)}</div>` : ''}</td>
        <td><span class="status-pill ${cls}">${label}</span></td>
        <td>${fmtDuration(s.durationMs)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function renderFlowSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return '';
  return `<table class="table" style="margin-top:.5rem">
    <thead><tr><th style="width:48px">#</th><th style="width:130px">动作</th><th>定位 / 内容</th></tr></thead>
    <tbody>${steps.map((s) => `<tr>
      <td>${s.index + 1}</td>
      <td><span class="status-pill paused">${escapeHtml(s.action)}</span></td>
      <td>${escapeHtml(s.summary || '')}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function ruleHumanLabel(r) {
  const when = r.when === 'pass' ? '【期望成立】' : '【条件成立报警】';
  if (r.type === 'threshold') {
    const valLabel = r.op === 'between'
      ? `[${r.value}, ${r.value2}]`
      : `${r.op} ${r.value}`;
    return `${when} 数值：<code>${escapeHtml(r.field || '')}</code> ${escapeHtml(valLabel)}（${r.severity || 'warning'}）`;
  }
  if (r.type === 'missing') {
    return `${when} 缺失：<code>${escapeHtml(r.field || '')}</code> 为空（${r.severity || 'warning'}）`;
  }
  return `${when} 表达式：<code>${escapeHtml(r.expression || '')}</code>（${r.severity || 'warning'}）`;
}

function renderTaskSummary(t) {
  const ruleLines = (t.rules || []).map(ruleHumanLabel);
  const yamlLines = (t.flowYaml || '').trim().split('\n').filter(Boolean);
  const flowSummary = t.flowYaml
    ? `<div class="muted" style="margin:.25rem 0 .25rem">📜 已绑定 ${yamlLines.length} 行 Recorder YAML（执行时由 Midscene 重放）</div>`
    : '';
  return `
    <div class="card" style="margin-top:1rem">
      <h3>AI 生成结果</h3>
      <p class="hint">关键字段已可直接编辑；点「在向导里继续编辑」可逐步精调。</p>
      <div class="row-2">
        <div>
          <label class="field">任务名称</label>
          <input id="asstName" type="text" value="${escapeHtml(t.name)}" />
        </div>
        <div>
          <label class="field">入口 URL</label>
          <input id="asstUrl" type="url" value="${escapeHtml(t.entryUrl || '')}" placeholder="https://..." />
        </div>
      </div>
      <div class="row-2">
        <div>
          <label class="field">运行模式</label>
          <input value="${t.runMode === 'currentTab' ? 'currentTab（已打开页面）' : 'newTabWithUrl（自动开新标签页）'}" disabled />
        </div>
        <div>
          <label class="field">巡检间隔（分钟）</label>
          <input id="asstInterval" type="number" min="1" step="1" value="${t.schedule.intervalMinutes}" />
        </div>
      </div>
      <label class="field">业务背景（AI 推断）</label>
      <textarea rows="2" disabled>${escapeHtml(t.description || '（无）')}</textarea>
      <label class="field">页面就绪条件</label>
      <textarea rows="2" disabled>${escapeHtml(t.readyPrompt)}</textarea>
      <label class="field">取数方式</label>
      <input value="${t.extractMode === 'developer' ? '开发者取数（页面上下文）' : 'AI 视觉取数（aiQuery）'}" disabled />
      ${t.extractMode === 'developer'
        ? `<label class="field">开发者配置摘要</label><textarea rows="3" disabled>${escapeHtml(JSON.stringify(t.developerExtract || {}, null, 2))}</textarea>`
        : `<label class="field">取数 Prompt</label><textarea rows="2" disabled>${escapeHtml(t.extractPrompt)}</textarea>
      <label class="field">取数 Schema</label><textarea rows="2" disabled>${escapeHtml(t.extractSchema || '（未指定，模型自由返回）')}</textarea>`}
      ${flowSummary}
      <label class="field">规则（${ruleLines.length} 条）</label>
      <div class="muted" style="background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:.5rem .65rem">
        ${ruleLines.length ? ruleLines.join('<br/>') : '（无规则；将默认仅校验「页面非登录页/非错误页」）'}
      </div>
    </div>
  `;
}

// -------------- Task Wizard (5 steps, advanced) --------------

const WIZARD_STEPS = [
  '连接与运行方式',
  '目标页面',
  '就绪与取数',
  '异常规则',
  '调度与告警',
];

function openTaskWizard(taskId, draftStart) {
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
    extractMode: 'aiQuery',
    developerExtract: defaultDeveloperExtract(),
  };
  const existing = taskId ? state.tasks.find((t) => t.id === taskId) : null;
  const seed = existing || draftStart || tpl;
  const draft = JSON.parse(JSON.stringify(seed));
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
    ensureDeveloperExtract(d);
    const dev = d.developerExtract;
    const modeAi = d.extractMode !== 'developer';
    const devHttp = dev.mode !== 'script';
    return `
      <label class="field">页面就绪条件（aiWaitFor）</label>
      <textarea id="f_readyPrompt" rows="2">${escapeHtml(d.readyPrompt)}</textarea>
      <p class="hint" style="margin-top:.25rem">若下方已填写操作流程，执行时会<strong>跳过</strong>本项，由流程内首条 <code>aiWaitFor</code> 判断入口页就绪。请勿把「点完筛选后的最终页面状态」写在这里。</p>

      <details class="collapse" style="margin-top:.6rem" ${d.flowYaml ? 'open' : ''}>
        <summary>📜 操作流程（可选 · YAML 或 Playwright 代码，适合下拉/滚动/复杂导航）</summary>
        <div class="collapse-body">
          <p class="hint">用 Midscene 扩展 Recorder 录制后，YAML 或 Playwright 代码任选一种粘贴。执行时按录制顺序<strong>逐步重放</strong>，并实时上报每步的状态与耗时；有本段内容时不会先单独执行上方的「页面就绪」。下方可开启 AI 兜底。</p>
          <textarea id="f_flowYaml" rows="10" placeholder="粘贴 YAML 或 Playwright 代码 — 系统会自动识别">${escapeHtml(d.flowYaml || '')}</textarea>
          <div class="row" style="margin-top:.4rem">
            <button class="small" type="button" id="wzYamlPreview">解析并预览步骤</button>
            <span class="muted" id="wzYamlHint"></span>
          </div>
          <div id="wzYamlSteps"></div>
          <label class="toggle" style="margin-top:.6rem">
            <input id="f_aiFallback" type="checkbox" ${d.aiFallback !== false ? 'checked' : ''} />
            某一步失败时自动用 aiAct 兜底（推荐开启）
          </label>
        </div>
      </details>

      <label class="field" style="margin-top:.6rem">粗粒度检查（aiAssert，用于排除登录页/错误页）</label>
      <textarea id="f_loginAssertPrompt" rows="2">${escapeHtml(d.loginAssertPrompt)}</textarea>

      <div class="section-title" style="margin-top:.75rem"><h3 style="margin:0;font-size:1rem">取数方式</h3></div>
      <p class="hint">开发者取数在<strong>已打开的 Chrome 页面上下文</strong>内执行 <code>fetch</code> 或自定义脚本，复用 Cookie 与登录态，适合内网接口；规则仍作用于下方「字段映射」后的 JSON（未配置映射时直接使用接口返回体）。设置页仍需填写默认模型配置（Midscene Agent 初始化要求），但本模式不会调用模型做取数。</p>
      <div class="row" style="gap:1rem;flex-wrap:wrap;margin:.4rem 0">
        <label class="toggle"><input type="radio" name="f_extractMode" id="f_extractMode_ai" value="aiQuery" ${modeAi ? 'checked' : ''} /> AI 视觉取数（aiQuery）</label>
        <label class="toggle"><input type="radio" name="f_extractMode" id="f_extractMode_dev" value="developer" ${!modeAi ? 'checked' : ''} /> 开发者取数（页面上下文）</label>
      </div>

      <div id="wzAiExtractPanel" class="${modeAi ? '' : 'hidden'}">
        <label class="field">结构化提取 Prompt（aiQuery）</label>
        <textarea id="f_extractPrompt" rows="3">${escapeHtml(d.extractPrompt)}</textarea>
        <label class="field">返回 Schema（可选，自然语言描述）</label>
        <textarea id="f_extractSchema" rows="3" placeholder='例：{ "orderCount": number, "todayAmount": number, "items": Array<{status:string,count:number}> }'>${escapeHtml(d.extractSchema)}</textarea>
        <p class="hint">建议用「测试执行一次」验证 Prompt 与 Schema 能稳定返回结构化数据。</p>
      </div>

      <div id="wzDevExtractPanel" class="${modeAi ? 'hidden' : ''}">
        <label class="field">执行前脚本（可选，在取数前运行于页面内）</label>
        <textarea id="f_devPreScript" rows="2" placeholder="例如从页面读取 token：window.__TOKEN__ = document.querySelector('#csrf')?.value">${escapeHtml(dev.preScript || '')}</textarea>
        <div class="row" style="gap:1rem;flex-wrap:wrap;margin:.35rem 0">
          <label class="toggle"><input type="radio" name="f_devMode" id="f_devMode_http" value="http" ${devHttp ? 'checked' : ''} /> HTTP 请求（相对 URL 相对当前页）</label>
          <label class="toggle"><input type="radio" name="f_devMode" id="f_devMode_script" value="script" ${!devHttp ? 'checked' : ''} /> 页面脚本（async 函数体）</label>
        </div>
        <div id="wzDevHttpBlock" class="${devHttp ? '' : 'hidden'}">
          <div class="row-2">
            <div>
              <label class="field">Method</label>
              <select id="f_devMethod">
                ${['GET','POST','PUT','PATCH','DELETE'].map((m) => `<option value="${m}" ${(dev.method || 'GET').toUpperCase() === m ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="field">URL</label>
              <input id="f_devUrl" type="text" value="${escapeHtml(dev.url || '')}" placeholder="/api/stats 或 https://..." />
            </div>
          </div>
          <label class="field">Headers（JSON 对象）</label>
          <textarea id="f_devHeaders" rows="3" placeholder='{ "Content-Type": "application/json" }'>${escapeHtml(devHeadersText(d))}</textarea>
          <label class="field">Body（非 GET 时作为请求体发送）</label>
          <textarea id="f_devBody" rows="3" placeholder='{"range":"today"}'>${escapeHtml(dev.body || '')}</textarea>
        </div>
        <div id="wzDevScriptBlock" class="${devHttp ? 'hidden' : ''}">
          <label class="field">页面上下文 JavaScript</label>
          <p class="hint">写入 async IIFE 的<strong>函数体</strong>，需 <code>return</code> 或最后一行表达式为结果；可使用 <code>fetch</code>、<code>document</code> 等。</p>
          <textarea id="f_devPageScript" rows="8" placeholder="return await fetch('/api/x').then(r => r.json());">${escapeHtml(dev.pageScript || '')}</textarea>
        </div>
        <label class="field" style="margin-top:.5rem">字段映射（可选，输出给规则引擎；留空则规则直接读接口 JSON）</label>
        <p class="hint">每行：输出字段名、JSON 路径（从根对象起，如 <code>json.data.total</code>）、或 JS 表达式（变量 <code>raw</code> 为页面返回对象，表达式优先于路径）。</p>
        <div id="wzDevMappings">${renderDevMappingRows(dev.fieldMappings)}</div>
        <button type="button" class="small" id="wzDevMapAdd">+ 添加映射行</button>
      </div>
    `;
  }
  if (step === 3) {
    return `
      <p class="hint">规则作用于<strong>字段映射之后</strong>的 JSON（开发者取数未配置映射时，为接口/脚本的原始返回）；支持数值阈值、缺失检查、JS 表达式（变量名 <code>data</code>）。</p>
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

function whenSelect(rule) {
  const when = rule.when === 'pass' ? 'pass' : 'fail';
  return `<select class="rule-when" title="触发方向">
    <option value="fail" ${when === 'fail' ? 'selected' : ''}>条件成立 → 报警</option>
    <option value="pass" ${when === 'pass' ? 'selected' : ''}>条件成立 → 通过</option>
  </select>`;
}

function severitySelect(rule) {
  return `<select class="rule-severity">${['info','warning','critical'].map((s) => `<option value="${s}" ${s === (rule.severity || 'warning') ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
}

function renderRuleRow(rule) {
  if (rule.type === 'expression') {
    return `<div class="rule-row expression" data-rule-id="${escapeHtml(rule.id || '')}">
      <select class="rule-type"><option value="threshold">阈值</option><option value="missing">缺失</option><option value="expression" selected>表达式</option></select>
      ${whenSelect(rule)}
      <input class="rule-expr" value="${escapeHtml(rule.expression || '')}" placeholder="例如: data.balance < 10" />
      ${severitySelect(rule)}
      <button class="small danger ghost" data-del-rule>删</button>
    </div>`;
  }
  if (rule.type === 'missing') {
    return `<div class="rule-row missing" data-rule-id="${escapeHtml(rule.id || '')}">
      <select class="rule-type"><option value="threshold">阈值</option><option value="missing" selected>缺失</option><option value="expression">表达式</option></select>
      ${whenSelect(rule)}
      <input class="rule-field" value="${escapeHtml(rule.field || '')}" placeholder="字段路径，如 items 或 stats.total" />
      <input class="rule-msg" value="${escapeHtml(rule.message || '')}" placeholder="告警标题（可选）" />
      ${severitySelect(rule)}
      <button class="small danger ghost" data-del-rule>删</button>
    </div>`;
  }
  return `<div class="rule-row" data-rule-id="${escapeHtml(rule.id || '')}">
    <select class="rule-type"><option value="threshold" selected>阈值</option><option value="missing">缺失</option><option value="expression">表达式</option></select>
    ${whenSelect(rule)}
    <input class="rule-field" value="${escapeHtml(rule.field || '')}" placeholder="字段路径" />
    <select class="rule-op">${['>','>=','<','<=','==','!=','between'].map((o) => `<option value="${o}" ${o === (rule.op || '<') ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <input class="rule-value" value="${escapeHtml(rule.value ?? '')}" placeholder="阈值或下限" />
    ${severitySelect(rule)}
    <button class="small danger ghost" data-del-rule>删</button>
  </div>`;
}

function bindStepInputs(step, d) {
  if (step === 2) {
    const syncExtractPanels = () => {
      const ai = document.getElementById('f_extractMode_ai')?.checked;
      document.getElementById('wzAiExtractPanel')?.classList.toggle('hidden', !ai);
      document.getElementById('wzDevExtractPanel')?.classList.toggle('hidden', Boolean(ai));
    };
    const syncDevBlocks = () => {
      const http = document.getElementById('f_devMode_http')?.checked;
      document.getElementById('wzDevHttpBlock')?.classList.toggle('hidden', !http);
      document.getElementById('wzDevScriptBlock')?.classList.toggle('hidden', Boolean(http));
    };
    document.querySelectorAll('input[name="f_extractMode"]').forEach((el) => {
      el.addEventListener('change', syncExtractPanels);
    });
    document.querySelectorAll('input[name="f_devMode"]').forEach((el) => {
      el.addEventListener('change', syncDevBlocks);
    });
    const mapBox = document.getElementById('wzDevMappings');
    const bindMapDeletes = () => {
      mapBox?.querySelectorAll('.dev-map-del').forEach((btn) => {
        btn.onclick = () => {
          const row = btn.closest('.dev-map-row');
          if (mapBox.querySelectorAll('.dev-map-row').length > 1) row?.remove();
        };
      });
    };
    document.getElementById('wzDevMapAdd')?.addEventListener('click', () => {
      mapBox?.insertAdjacentHTML('beforeend', renderDevMappingRows([{ key: '', path: '', expression: '' }]));
      bindMapDeletes();
    });
    bindMapDeletes();
    document.getElementById('wzYamlPreview')?.addEventListener('click', async () => {
      const txt = document.getElementById('f_flowYaml').value.trim();
      const hint = document.getElementById('wzYamlHint');
      const stepsBox = document.getElementById('wzYamlSteps');
      if (!txt) { hint.textContent = '请先粘贴 YAML'; stepsBox.innerHTML = ''; return; }
      const r = await api.parseFlow(txt);
      if (!r.ok) {
        hint.textContent = r.error || '解析失败';
        stepsBox.innerHTML = '';
        return;
      }
      const meta = r.meta || {};
      const sourceLabel = r.source === 'playwright' ? 'Playwright 代码' : 'YAML';
      hint.textContent = `识别为 ${sourceLabel}，共 ${r.steps.length} 步${meta.entryUrl ? ' · ' + meta.entryUrl : ''}${r.warnings?.length ? ' · ' + r.warnings.join('；') : ''}`;
      stepsBox.innerHTML = renderFlowSteps(r.steps);
    });
  }
  if (step === 3) {
    const box = document.getElementById('rulesBox');
    const addBtns = document.querySelectorAll('[data-add-rule]');
    addBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.addRule;
        const rule = { id: 'r_' + Math.random().toString(36).slice(2, 8), type: t, when: 'fail', severity: 'warning' };
        if (t === 'threshold') Object.assign(rule, { field: '', op: '<', value: '' });
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
    d.flowYaml = document.getElementById('f_flowYaml')?.value ?? d.flowYaml ?? '';
    const fb = document.getElementById('f_aiFallback');
    if (fb) d.aiFallback = fb.checked;
    const modeEl = document.querySelector('input[name="f_extractMode"]:checked');
    d.extractMode = modeEl?.value === 'developer' ? 'developer' : 'aiQuery';
    ensureDeveloperExtract(d);
    if (d.extractMode === 'aiQuery') {
      d.extractPrompt = document.getElementById('f_extractPrompt')?.value ?? '';
      d.extractSchema = document.getElementById('f_extractSchema')?.value ?? '';
    } else {
      d.developerExtract.preScript = document.getElementById('f_devPreScript')?.value ?? '';
      const dm = document.querySelector('input[name="f_devMode"]:checked');
      d.developerExtract.mode = dm?.value === 'script' ? 'script' : 'http';
      d.developerExtract.method = document.getElementById('f_devMethod')?.value || 'GET';
      d.developerExtract.url = document.getElementById('f_devUrl')?.value?.trim() ?? '';
      const ht = document.getElementById('f_devHeaders')?.value?.trim() || '{}';
      try {
        const parsed = JSON.parse(ht);
        d.developerExtract.headers = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        if (strict) {
          alert('Headers 须为合法 JSON 对象');
          return false;
        }
        d.developerExtract.headers = {};
      }
      d.developerExtract.body = document.getElementById('f_devBody')?.value ?? '';
      d.developerExtract.pageScript = document.getElementById('f_devPageScript')?.value ?? '';
      const mappings = [];
      document.querySelectorAll('#wzDevMappings .dev-map-row').forEach((row) => {
        const key = row.querySelector('.dev-map-key')?.value?.trim() || '';
        const path = row.querySelector('.dev-map-path')?.value?.trim() || '';
        const expression = row.querySelector('.dev-map-expr')?.value?.trim() || '';
        if (!key && !path && !expression) return;
        mappings.push({ key, path, expression });
      });
      d.developerExtract.fieldMappings = mappings;
      if (strict) {
        if (d.developerExtract.mode === 'http' && !d.developerExtract.url) {
          alert('开发者取数（HTTP）：请填写 URL');
          return false;
        }
        if (d.developerExtract.mode === 'script' && !d.developerExtract.pageScript.trim()) {
          alert('开发者取数（脚本）：请填写页面上下文 JavaScript');
          return false;
        }
      }
    }
  } else if (step === 3) {
    const rows = document.querySelectorAll('#rulesBox [data-rule-id]');
    const rules = [];
    rows.forEach((row) => {
      const type = row.querySelector('.rule-type').value;
      const severity = row.querySelector('.rule-severity').value;
      const when = row.querySelector('.rule-when')?.value === 'pass' ? 'pass' : 'fail';
      const id = row.dataset.ruleId || 'r_' + Math.random().toString(36).slice(2, 8);
      if (type === 'threshold') {
        rules.push({ id, type, when, severity,
          field: row.querySelector('.rule-field').value.trim(),
          op: row.querySelector('.rule-op').value,
          value: row.querySelector('.rule-value').value,
        });
      } else if (type === 'missing') {
        rules.push({ id, type, when, severity,
          field: row.querySelector('.rule-field').value.trim(),
          message: row.querySelector('.rule-msg').value,
        });
      } else {
        rules.push({ id, type, when, severity,
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
