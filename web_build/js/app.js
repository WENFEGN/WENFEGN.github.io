/* ═══════════════════════════════════════════════════════════
   CoupleLife 情侣生活管家 - 核心应用逻辑
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ────────────────────────────────────────────────
   数据层：Supabase 已配置则用云数据库（含 Realtime），
   未配置则降级为 LocalStorage 本地模式（可离线单机预览）
   ──────────────────────────────────────────────── */
const DB = (() => {
  let sb = null;
  const COUPLE = () => getConfig('COUPLE_ID') || 'couple_001';

  function init() {
    const url = getConfig('SUPABASE_URL');
    const key = getConfig('SUPABASE_ANON_KEY');
    if (url && key && window.supabase) {
      try {
        sb = window.supabase.createClient(url, key, { auth: { persistSession: true } });
        console.log('[DB] Supabase 已连接');
      } catch (e) { console.warn('[DB] Supabase 初始化失败，降级本地模式', e); sb = null; }
    } else {
      console.warn('[DB] 未配置 Supabase，使用本地模式（仅本机可见）');
    }
  }
  function isCloud() { return !!sb; }

  /* 通用查询/写入封装 */
  async function select(table, opts = {}) {
    const cid = COUPLE();
    if (isCloud()) {
      let q = sb.from(table).select('*').eq('couple_id', cid);
      if (opts.order) q = q.order(opts.order[0], { ascending: opts.order[1] !== false });
      if (opts.limit) q = q.limit(opts.limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }
    return localRead(table).filter(r => r.couple_id === cid);
  }

  async function insert(table, row) {
    const cid = COUPLE();
    const full = Object.assign({ couple_id: cid, id: uid(), created_at: new Date().toISOString() }, row, { couple_id: cid });
    if (isCloud()) {
      const { data, error } = await sb.from(table).insert(full).select();
      if (error) throw error;
      return data[0] || full;
    }
    const all = localRead(table);
    all.push(full);
    localWrite(table, all);
    return full;
  }

  async function update(table, id, patch) {
    const cid = COUPLE();
    if (isCloud()) {
      const { data, error } = await sb.from(table).update(patch).eq('id', id).eq('couple_id', cid).select();
      if (error) throw error;
      return data && data[0];
    }
    const all = localRead(table);
    const idx = all.findIndex(r => r.id === id && r.couple_id === cid);
    if (idx >= 0) { all[idx] = Object.assign({}, all[idx], patch); localWrite(table, all); return all[idx]; }
    return null;
  }

  async function remove(table, id) {
    const cid = COUPLE();
    if (isCloud()) {
      const { error } = await sb.from(table).delete().eq('id', id).eq('couple_id', cid);
      if (error) throw error;
      return;
    }
    localWrite(table, localRead(table).filter(r => !(r.id === id && r.couple_id === cid)));
  }

  /* 本地存储辅助 */
  function localKey(table) { return 'cl_' + table; }
  function localRead(table) { try { return JSON.parse(localStorage.getItem(localKey(table)) || '[]'); } catch (e) { return []; } }
  function localWrite(table, arr) { localStorage.setItem(localKey(table), JSON.stringify(arr)); }
  function localListen(table, cb) {
    // 本地模式：监听同一标签页的 storage 事件即可（多标签页同步）
    window.addEventListener('storage', e => {
      if (e.key === localKey(table)) cb();
    });
  }
  function uid() { return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* Realtime 订阅（云模式）：对方新增订单/记录时本机实时刷新 */
  function subscribe(table, cb) {
    if (!isCloud()) { localListen(table, cb); return null; }
    const channel = sb.channel('rt_' + table)
      .on('postgres_changes', { event: '*', schema: 'public', table: table, filter: 'couple_id=eq.' + COUPLE() }, () => cb())
      .subscribe();
    return channel;
  }

  return { init, isCloud, select, insert, update, remove, subscribe, COUPLE, localRead, localWrite };
})();

/* ────────────────────────────────────────────────
   全局工具
   ──────────────────────────────────────────────── */
function uid() { return DB.uid ? 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) : 'id_' + Math.random().toString(36).slice(2, 10); }
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtMoney(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(d) { if (!d) return ''; const dt = new Date(d); return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
function todayStr() { return fmtDate(new Date()); }

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}

function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modalOverlay').classList.remove('hidden');
}
function closeModal() { $('#modalOverlay').classList.add('hidden'); $('#modalBox').innerHTML = ''; }
$('#modalOverlay') && $('#modalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

/* ────────────────────────────────────────────────
   主应用
   ──────────────────────────────────────────────── */
const App = {

  state: {
    recipes: [], orders: [], restrictions: [], health: [], periods: [],
    events: [], kids: [], growths: [], milestones: [], schedules: [],
    txs: [], currentTab: 'canteen', workMonth: new Date(),
    charts: {}, loveTimer: null
  },

  async init() {
    DB.init();
    this.bindNav();
    this.bindGlobal();
    this.registerSW();
    this.setupRealtime();
    await this.loadAll();
    this.startLoveCounter();
    this.checkOffline();
    // 经期提前3天提醒
    setTimeout(() => this.checkPeriodReminder(), 1500);
  },

  /* ── 导航 ── */
  bindNav() {
    $$('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });
    $$('.sub-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = btn.closest('.tab-page');
        parent.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        parent.querySelectorAll('.sub-page').forEach(p => p.classList.remove('active'));
        const target = parent.querySelector('#' + btn.dataset.sub);
        if (target) target.classList.add('active');
        // 切到图表页时重绘
        if (btn.dataset.sub === 'canteen-rank') this.renderRecipeRank();
        if (btn.dataset.sub === 'ledger-chart') this.renderLedgerCharts();
        if (btn.dataset.sub === 'health-period') this.renderPeriodCalendar();
      });
    });
  },

  switchTab(tab) {
    this.state.currentTab = tab;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    if (tab === 'canteen') { this.renderRecipes(); this.renderOrders(); this.renderRestrictionBanner(); }
    if (tab === 'health') { this.renderHealth(); }
    if (tab === 'days') { this.renderEvents(); this.renderKids(); }
    if (tab === 'work') { this.renderWorkCalendar(); this.renderScheduleList(); }
    if (tab === 'ledger') { this.renderTxList(); this.updateLedgerSummary(); }
    if (tab === 'work') setTimeout(() => this.renderWorkCalendar(), 50);
  },

  bindGlobal() {
    $('#btnProfile').addEventListener('click', () => this.openProfile());
    $('#btnAddRecipe').addEventListener('click', () => this.openRecipeModal());
    $('#btnAddEvent').addEventListener('click', () => this.openEventModal());
    $('#btnAddTx').addEventListener('click', () => this.openTxModal());
    $('#btnAddGrowth').addEventListener('click', () => this.openGrowthModal());
    $('#btnAddMilestone').addEventListener('click', () => this.openMilestoneModal());
    $('#btnClearPeriods').addEventListener('click', () => this.clearPeriods());
    $('#btnPrevMonth').addEventListener('click', () => { this.state.workMonth.setMonth(this.state.workMonth.getMonth() - 1); this.renderWorkCalendar(); this.renderScheduleList(); });
    $('#btnNextMonth').addEventListener('click', () => { this.state.workMonth.setMonth(this.state.workMonth.getMonth() + 1); this.renderWorkCalendar(); this.renderScheduleList(); });

    /* AI 相关 */
    $('#aiFab').addEventListener('click', () => this.openAiSheet());
    $('#aiSheetOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) this.closeAiSheet(); });
    $('#aiTakePhoto').addEventListener('click', () => { $('#aiFileInput').click(); });
    $('#aiPickImage').addEventListener('click', () => { $('#aiFileInputGallery').click(); });
    $('#aiPasteLink').addEventListener('click', () => this.aiPasteLink());
    $('#aiFileInput').addEventListener('change', e => this.handleAiFile(e.target.files[0]));
    $('#aiFileInputGallery').addEventListener('change', e => this.handleAiFile(e.target.files[0]));
    $('#aiAnalyzeBtn').addEventListener('click', () => this.aiAnalyze());
  },

  /* ── PWA / 离线 ── */
  registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  },
  checkOffline() {
    const update = () => $('#offlineBanner').classList.toggle('hidden', navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  },

  /* ── Realtime 订阅 ── */
  setupRealtime() {
    DB.subscribe('order_history', () => { this.loadOrders(); this.renderOrders(); this.updateBadges(); });
    DB.subscribe('transactions', () => { this.loadTxs(); this.renderTxList(); this.updateLedgerSummary(); });
    DB.subscribe('schedules', () => { if (this.state.currentTab === 'work') { this.renderWorkCalendar(); this.renderScheduleList(); } });
    DB.subscribe('anniversaries', () => { this.renderEvents(); });
    DB.subscribe('health_data', () => { this.renderHealth(); });
    DB.subscribe('recipes', () => { this.renderRecipes(); });
  },

  /* ── 数据加载 ── */
  async loadAll() {
    try {
      this.state.recipes = await DB.select('recipes', { order: ['created_at', false] });
      this.state.orders = await DB.select('order_history', { order: ['created_at', false] });
      this.state.restrictions = await DB.select('dietary_restrictions');
      this.state.health = await DB.select('health_data', { order: ['record_date', true] });
      this.state.events = await DB.select('anniversaries');
      this.state.kids = await DB.select('kids');
      this.state.growths = await DB.select('kid_growth', { order: ['record_date', true] });
      this.state.milestones = await DB.select('kid_milestones', { order: ['event_date', true] });
      this.state.schedules = await DB.select('schedules');
      this.state.txs = await DB.select('transactions', { order: ['tx_date', false] });
    } catch (e) {
      console.error('加载数据失败', e);
      toast('⚠️ 数据加载失败：' + e.message);
    }
    this.renderAll();
  },
  renderAll() {
    this.renderRecipes(); this.renderOrders(); this.renderRestrictionBanner();
    this.renderHealth(); this.renderEvents(); this.renderKids();
    this.renderWorkCalendar(); this.renderScheduleList();
    this.renderTxList(); this.updateLedgerSummary(); this.updateBadges();
  },

  /* ═════════════════════════════════════════════
     Tab 1 食堂
     ═════════════════════════════════════════════ */
  async loadRecipes() { this.state.recipes = await DB.select('recipes', { order: ['created_at', false] }); this.renderRecipes(); },
  async loadOrders() { this.state.orders = await DB.select('order_history', { order: ['created_at', false] }); this.renderOrders(); this.updateBadges(); },
  async loadTxs() { this.state.txs = await DB.select('transactions', { order: ['tx_date', false] }); },

  renderRecipes() {
    const list = $('#recipeList');
    const recipes = this.state.recipes;
    if (!recipes.length) {
      list.innerHTML = '<div class="empty-state">还没有菜谱，点击右上角"上传菜谱"添加第一道菜吧 🍳</div>';
      return;
    }
    list.innerHTML = recipes.map(r => `
      <div class="recipe-card">
        ${r.image_url ? `<img class="recipe-img" src="${esc(r.image_url)}" alt="${esc(r.name)}">`
                      : `<div class="recipe-img">🍲</div>`}
        <div class="recipe-body">
          <div class="recipe-name">${esc(r.name)}</div>
          <div class="recipe-ingredients">🥬 ${esc(r.ingredients || '')}</div>
          <details class="recipe-detail"><summary style="font-size:12px;color:var(--text-light);cursor:pointer;">👩‍🍳 查看做法</summary>
            <div class="recipe-steps">${esc(r.steps || '暂无做法')}</div>
          </details>
          <div class="recipe-actions">
            <button class="btn btn-primary btn-sm" onclick="App.orderRecipe('${r.id}')">点这道菜 🍽️</button>
            <button class="btn btn-outline btn-sm" onclick="App.deleteRecipe('${r.id}')">🗑️</button>
          </div>
        </div>
      </div>`).join('');
  },

  async orderRecipe(id) {
    const r = this.state.recipes.find(x => x.id === id);
    if (!r) return;
    const who = this.pickWho('谁想吃这道菜？');
    if (!who) return;
    openModal(`
      <h3>🍽️ 确认点菜</h3>
      <p style="text-align:center;margin-bottom:14px;font-size:15px;">确认要点「<b>${esc(r.name)}</b>」吗？<br>
      <small style="color:var(--text-light);">对方打开应用后将看到红点提醒</small></p>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">再想想</button>
        <button class="btn btn-primary" onclick="App.confirmOrder('${id}', '${who}')">确认下单 ✅</button>
      </div>`);
  },

  async confirmOrder(id, who) {
    const r = this.state.recipes.find(x => x.id === id);
    if (!r) return;
    await DB.insert('order_history', {
      recipe_id: r.id, recipe_name: r.name, ordered_by: who,
      status: 'pending', order_date: todayStr()
    });
    closeModal();
    toast('✅ 已下单！等 TA 接单做饭吧～');
    await this.loadOrders();
  },

  async acceptOrder(id) {
    await DB.update('order_history', id, { status: 'cooking', accepted_by: whoAmI(), accepted_at: new Date().toISOString() });
    toast('🔥 接单！开始做饭啦');
    await this.loadOrders();
  },
  async finishOrder(id) {
    await DB.update('order_history', id, { status: 'done', finished_at: new Date().toISOString() });
    toast('🎉 完成！辛苦啦');
    await this.loadOrders();
  },
  async deleteRecipe(id) {
    if (!confirm('确定删除这道菜谱吗？')) return;
    await DB.remove('recipes', id);
    await this.loadRecipes();
    toast('已删除');
  },

  renderOrders() {
    const list = $('#orderHistoryList');
    const orders = this.state.orders.filter(o => o.status !== 'done').slice(0, 30);
    const done = this.state.orders.filter(o => o.status === 'done').slice(0, 20);
    const statusMap = { pending: ['待接单', 'status-pending'], cooking: ['做饭中', 'status-cooking'], done: ['已完成', 'status-done'] };
    let html = '';
    if (!orders.length && !done.length) {
      html = '<div class="empty-state">还没有点餐记录 📭</div>';
    } else {
      if (orders.length) {
        html += orders.map(o => {
          const [st, cls] = statusMap[o.status];
          return `<div class="order-item">
            <div style="flex:1">
              <div style="font-weight:600;">${esc(o.recipe_name)}</div>
              <div style="font-size:11px;color:var(--text-light);">${esc(o.ordered_by === 'male' ? '👦 男方' : '👧 女方')} · ${esc(o.order_date)}</div>
            </div>
            <span class="order-status ${cls}">${st}</span>
            ${o.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="App.acceptOrder('${o.id}')">接单做饭</button>` : ''}
            ${o.status === 'cooking' ? `<button class="btn btn-primary btn-sm" onclick="App.finishOrder('${o.id}')">已做好 ✅</button>` : ''}
          </div>`;
        }).join('');
      }
      if (done.length) {
        html += `<div style="font-size:12px;color:var(--text-light);margin:10px 0 6px;">— 最近完成 —</div>`;
        html += done.map(o => `<div class="order-item" style="opacity:0.7">
          <div style="flex:1"><div style="font-weight:600;">${esc(o.recipe_name)}</div><div style="font-size:11px;color:var(--text-light);">${esc(o.order_date)}</div></div>
          <span class="order-status status-done">已完成</span>
        </div>`).join('');
      }
    }
    list.innerHTML = html;
  },

  renderRestrictionBanner() {
    const r = this.state.restrictions.find(x => x.couple_id === DB.COUPLE());
    const banner = $('#restrictionBanner');
    const text = $('#restrictionText');
    if (r && (r.male_restrictions || r.female_restrictions)) {
      let parts = [];
      if (r.male_restrictions) parts.push('👦 男方忌口：' + r.male_restrictions);
      if (r.female_restrictions) parts.push('👧 女方忌口：' + r.female_restrictions);
      text.textContent = '🚫 ' + parts.join('　｜　') + '　';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  },

  renderRecipeRank() {
    // 统计每道菜被点次数
    const counts = {};
    this.state.orders.forEach(o => { counts[o.recipe_name] = (counts[o.recipe_name] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = $('#rankLabels');
    if (!entries.length) {
      labels.innerHTML = '<div class="empty-state">暂无点餐数据，快去点菜吧～</div>';
      this.destroyChart('recipeRank');
      return;
    }
    // 最爱标签
    const maleC = {}; const femaleC = {};
    this.state.orders.forEach(o => { const t = o.ordered_by === 'male' ? maleC : femaleC; t[o.recipe_name] = (t[o.recipe_name] || 0) + 1; });
    const topMale = Object.entries(maleC).sort((a, b) => b[1] - a[1])[0];
    const topFemale = Object.entries(femaleC).sort((a, b) => b[1] - a[1])[0];
    let tagHtml = '';
    if (topFemale) tagHtml += `<span class="rank-tag pink">👧 女友最爱点：${esc(topFemale[0])} ×${topFemale[1]}</span>`;
    if (topMale) tagHtml += `<span class="rank-tag gold">👦 男友最爱点：${esc(topMale[0])} ×${topMale[1]}</span>`;
    labels.innerHTML = tagHtml || '';
    this.renderBarChart('recipeRankChart', 'recipeRank',
      entries.map(e => e[0]), entries.map(e => e[1]),
      '被点次数', '#ff6b81');
  },

  /* ═════════════════════════════════════════════
     Tab 2 身心
     ═════════════════════════════════════════════ */
  renderHealth() {
    ['male', 'female'].forEach(person => {
      const rows = this.state.health.filter(h => h.person === person);
      const latest = rows[rows.length - 1];
      const height = latest ? latest.height : null;
      const weight = latest ? latest.weight : null;
      $(`#height${cap(person)}`).textContent = height || '--';
      $(`#weight${cap(person)}`).textContent = weight || '--';
      const bmiNum = $(`#bmi${cap(person)}`);
      const bmiStatus = $(`#bmiStatus${cap(person)}`);
      if (height && weight) {
        const bmi = weight / Math.pow(height / 100, 2);
        bmiNum.textContent = bmi.toFixed(1);
        let status, cls;
        if (bmi < 18.5) { status = '偏瘦'; cls = 'bmi-thin'; }
        else if (bmi < 24) { status = '正常'; cls = 'bmi-normal'; }
        else { status = '偏胖'; cls = 'bmi-fat'; }
        bmiStatus.textContent = status;
        bmiStatus.className = 'bmi-status ' + cls;
      } else {
        bmiNum.textContent = '--';
        bmiStatus.textContent = '--';
        bmiStatus.className = 'bmi-status';
      }
    });
    // 体重趋势图
    this.renderWeightChart();
  },

  renderWeightChart() {
    const dates = [...new Set(this.state.health.map(h => h.record_date))].sort();
    const maleData = dates.map(d => { const r = this.state.health.find(h => h.record_date === d && h.person === 'male'); return r ? r.weight : null; });
    const femaleData = dates.map(d => { const r = this.state.health.find(h => h.record_date === d && h.person === 'female'); return r ? r.weight : null; });
    this.renderLineChart('weightChart', 'weightChart', dates, [
      { label: '👦 男方体重', data: maleData, color: '#4dabf7' },
      { label: '👧 女方体重', data: femaleData, color: '#f783ac' }
    ]);
  },

  openPersonEdit(person) {
    const rows = this.state.health.filter(h => h.person === person);
    const latest = rows[rows.length - 1];
    openModal(`
      <h3>${person === 'male' ? '👦' : '👧'} 录入健康数据</h3>
      <div class="form-group">
        <label>身高（cm，仅首次填一次）</label>
        <input type="number" id="peHeight" placeholder="如 175" value="${latest && latest.height ? latest.height : ''}">
      </div>
      <div class="form-group">
        <label>今日体重（kg）</label>
        <input type="number" id="peWeight" placeholder="如 65.5" step="0.1" value="${latest ? latest.weight : ''}">
      </div>
      <div class="form-group">
        <label>运动类型</label>
        <select id="peSport"><option value="">无</option><option value="跑步">🏃 跑步</option><option value="游泳">🏊 游泳</option><option value="健身">🏋️ 健身</option><option value="其他">其他</option></select>
      </div>
      <div class="form-group">
        <label>运动时长（分钟）</label>
        <input type="number" id="peDuration" placeholder="如 30">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.saveHealth('${person}')">保存</button>
      </div>`);
  },

  async saveHealth(person) {
    const height = parseFloat($('#peHeight').value);
    const weight = parseFloat($('#peWeight').value);
    const sport = $('#peSport').value;
    const duration = parseInt($('#peDuration').value) || 0;
    if (!weight) { toast('请填写体重'); return; }
    await DB.insert('health_data', { person, height: height || null, weight, sport, duration, record_date: todayStr() });
    closeModal();
    toast('✅ 已保存');
    this.state.health = await DB.select('health_data', { order: ['record_date', true] });
    this.renderHealth();
  },

  /* ── 经期 ── */
  getPeriods() { return this.state.health.filter(h => h.period_flag && h.person === 'female').map(h => h.record_date).sort(); },

  renderPeriodCalendar() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const periods = new Set(this.getPeriods());
    const predicted = new Set(this.predictPeriodDays());
    const firstDay = new Date(y, m, 1);
    const startDow = (firstDay.getDay() + 6) % 7; // 周一为第一天
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    let head = '<div class="cal-head">' + ['一','二','三','四','五','六','日'].map(d => `<span>${d}</span>`).join('') + '</div>';
    let grid = '<div class="cal-grid">';
    for (let i = 0; i < startDow; i++) grid += '<div class="cal-day empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = fmtDate(new Date(y, m, d));
      const isPeriod = periods.has(ds);
      const isPred = predicted.has(ds);
      const isToday = ds === todayStr();
      grid += `<div class="cal-day ${isPeriod ? 'period' : ''} ${isPred && !isPeriod ? 'predicted' : ''} ${isToday ? 'today' : ''}" onclick="App.togglePeriod('${ds}')">
        <span>${d}</span>${isPeriod ? '<span class="period-mark">🌸</span>' : ''}${isPred && !isPeriod ? '<span class="period-mark">~</span>' : ''}
      </div>`;
    }
    grid += '</div>';
    $('#periodCalendar').innerHTML = head + grid;

    // 下次预计经期
    const next = this.calcNextPeriod();
    if (next) {
      const days = Math.ceil((next - new Date()) / 86400000);
      $('#periodNextDate').textContent = fmtDate(next);
      $('#periodNextDays').textContent = days >= 0 ? `还有 ${days} 天` : `已过去 ${-days} 天`;
    } else {
      $('#periodNextDate').textContent = '--';
      $('#periodNextDays').textContent = '点击日历标记经期开始后自动预测';
    }
  },

  /* 简单预测：取最近2个经期开始日，间隔28天为周期，下次=最后一次+周期 */
  calcNextPeriod() {
    const periods = this.getPeriods().sort();
    if (!periods.length) return null;
    if (periods.length >= 2) {
      const lastTwo = periods.slice(-2);
      const cycle = Math.round((new Date(lastTwo[1]) - new Date(lastTwo[0])) / 86400000);
      const cycleLen = (cycle >= 21 && cycle <= 40) ? cycle : 28;
      const next = new Date(lastTwo[1]);
      next.setDate(next.getDate() + cycleLen);
      return next;
    }
    const next = new Date(periods[0]);
    next.setDate(next.getDate() + 28);
    return next;
  },

  predictPeriodDays() {
    const next = this.calcNextPeriod();
    if (!next) return [];
    const days = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(next); d.setDate(d.getDate() + i);
      days.push(fmtDate(d));
    }
    return days;
  },

  async togglePeriod(date) {
    const existing = this.state.health.find(h => h.person === 'female' && h.record_date === date && h.period_flag);
    openModal(`
      <h3>🌸 ${date}</h3>
      <p style="text-align:center;margin-bottom:14px;">当前状态：${existing ? '已标记为经期' : '未标记'}</p>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn ${existing ? 'btn-danger' : 'btn-primary'}" onclick="App.setPeriod('${date}', ${existing ? 'false' : 'true'})">
          ${existing ? '取消标记' : '标记经期开始 ✅'}
        </button>
      </div>`);
  },

  async setPeriod(date, on) {
    if (on) {
      const existing = this.state.health.find(h => h.person === 'female' && h.record_date === date && h.period_flag);
      if (!existing) {
        await DB.insert('health_data', { person: 'female', period_flag: true, weight: null, height: null, record_date: date });
      }
    } else {
      const existing = this.state.health.find(h => h.person === 'female' && h.record_date === date && h.period_flag);
      if (existing) await DB.remove('health_data', existing.id);
    }
    closeModal();
    this.state.health = await DB.select('health_data', { order: ['record_date', true] });
    this.renderPeriodCalendar();
  },

  async clearPeriods() {
    if (!confirm('确定清空所有经期记录吗？')) return;
    const rows = this.state.health.filter(h => h.period_flag && h.person === 'female');
    for (const r of rows) await DB.remove('health_data', r.id);
    this.state.health = await DB.select('health_data', { order: ['record_date', true] });
    this.renderPeriodCalendar();
  },

  checkPeriodReminder() {
    const next = this.calcNextPeriod();
    if (!next) return;
    const diff = Math.ceil((next - new Date()) / 86400000);
    if (diff >= 0 && diff <= 3) {
      setTimeout(() => toast(`🌸 提醒：预计 ${diff === 0 ? '今天' : diff + ' 天后'}（${fmtDate(next)}）是经期，提前准备哦～`), 2000);
    }
  },

  /* ═════════════════════════════════════════════
     Tab 3 日子
     ═════════════════════════════════════════════ */
  startLoveCounter() {
    const startDate = localStorage.getItem('cl_love_start') || new Date().toISOString().slice(0, 10);
    $('#loveStartDate').textContent = '开始于 ' + startDate;
    const update = () => {
      const start = new Date(startDate);
      const now = new Date();
      let diff = Math.max(0, now - start);
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor(diff % 86400000 / 3600000);
      const mins = Math.floor(diff % 3600000 / 60000);
      const secs = Math.floor(diff % 60000 / 1000);
      $('#loveCounter').textContent = `${days} 天 ${String(hours).padStart(2,'0')} 时 ${String(mins).padStart(2,'0')} 分 ${String(secs).padStart(2,'0')} 秒`;
    };
    update();
    clearInterval(this.state.loveTimer);
    this.state.loveTimer = setInterval(update, 1000);
  },

  renderEvents() {
    const list = $('#eventList');
    const events = this.state.events;
    if (!events.length) {
      list.innerHTML = '<div class="empty-state">还没有记录重要日子，点"添加"创建一个吧 💝</div>';
      return;
    }
    const now = new Date();
    list.innerHTML = events.map(e => {
      const target = new Date(e.event_date);
      let diff = Math.floor((target - now) / 86400000);
      let sub;
      if (e.count_type === 'countdown') {
        sub = diff >= 0 ? `还有 ${diff} 天` : `已过 ${-diff} 天`;
      } else {
        sub = `已 ${diff < 0 ? -diff : 0} 天`;
      }
      return `<div class="event-card">
        <span class="event-icon">${esc(e.icon || '📌')}</span>
        <div class="event-body">
          <div class="event-name">${esc(e.name)}</div>
          <div class="event-sub">${esc(e.event_date)}</div>
        </div>
        ${e.image_url ? `<img class="event-photo" src="${esc(e.image_url)}" alt="">` : ''}
        <div class="event-countdown">${sub}</div>
        <button class="icon-btn" style="background:var(--primary-light);color:var(--primary);" onclick="App.deleteEvent('${e.id}')">🗑️</button>
      </div>`;
    }).join('');
  },

  openEventModal() {
    openModal(`
      <h3>📅 添加重要日子</h3>
      <div class="form-group"><label>事件名称</label><input id="evName" placeholder="如：恋爱周年 / 对方生日 / 发薪日"></div>
      <div class="form-group"><label>日期</label><input type="date" id="evDate"></div>
      <div class="form-group"><label>类型</label>
        <select id="evType"><option value="countdown">⏳ 倒计时（距离还有X天）</option><option value="countup">⏱️ 正计时（已过X天）</option></select>
      </div>
      <div class="form-group"><label>图标（emoji）</label><input id="evIcon" placeholder="💝" value="💝"></div>
      <div class="form-group">
        <label>纪念日照片（可选）</label>
        <div class="photo-upload-btn" onclick="document.getElementById('evPhoto').click()">📷 拍照 / 选择照片</div>
        <input type="file" id="evPhoto" accept="image/*" class="hidden" onchange="App.previewPhoto(this, 'evPhotoPreview')">
        <div class="photo-preview" id="evPhotoPreview"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.saveEvent()">保存</button>
      </div>`);
  },

  async saveEvent() {
    const name = $('#evName').value.trim();
    const date = $('#evDate').value;
    const type = $('#evType').value;
    const icon = $('#evIcon').value || '📌';
    if (!name || !date) { toast('请填写名称和日期'); return; }
    const file = $('#evPhoto').files[0];
    let image_url = null;
    if (file) image_url = await this.uploadImage(file, 'anniversaries');
    await DB.insert('anniversaries', { name, event_date: date, count_type: type, icon, image_url });
    closeModal();
    toast('✅ 已添加');
    this.state.events = await DB.select('anniversaries');
    this.renderEvents();
  },

  async deleteEvent(id) {
    if (!confirm('删除这个日子？')) return;
    await DB.remove('anniversaries', id);
    this.state.events = await DB.select('anniversaries');
    this.renderEvents();
  },

  /* ── 崽崽 ── */
  renderKids() {
    const area = $('#kidProfileArea');
    const kid = this.state.kids[0];
    if (!kid) {
      area.innerHTML = `<div class="empty-state" style="padding:20px;">还没有崽崽档案
        <button class="btn btn-primary btn-sm" style="display:block;margin:10px auto 0;" onclick="App.openKidModal()">👶 创建档案</button>
      </div>`;
      this.destroyChart('kidGrowth');
      $('#milestoneList').innerHTML = '<div class="empty-state" style="padding:16px;">创建档案后可记录成长轨迹和大事记</div>';
      return;
    }
    const age = this.calcKidAge(kid.birth_date);
    area.innerHTML = `<div class="kid-profile">
      <span class="kid-avatar">👶</span>
      <div class="kid-info">
        <div class="kid-name">${esc(kid.name)}</div>
        <div class="kid-age">🎂 ${esc(kid.birth_date)} · ${age}</div>
      </div>
      <button class="icon-btn" style="background:var(--primary-light);color:var(--primary);margin-left:auto;" onclick="App.openKidModal()">✏️</button>
    </div>`;
    // 成长曲线
    const growths = this.state.growths;
    if (growths.length) {
      this.renderLineChart('kidGrowthChart', 'kidGrowth',
        growths.map(g => g.record_date), [
          { label: '身高 (cm)', data: growths.map(g => g.height), color: '#4dabf7' },
          { label: '体重 (kg)', data: growths.map(g => g.weight), color: '#f783ac' }
        ]);
    } else {
      this.destroyChart('kidGrowth');
      $('#kidGrowthChart').parentElement.innerHTML += '<div class="empty-state" style="padding:16px;margin-top:8px;">还没有成长记录，点"+ 记录"添加</div>';
    }
    // 里程碑
    const milestones = this.state.milestones;
    $('#milestoneList').innerHTML = milestones.length ? milestones.map(m => `
      <div class="timeline-item">
        <div class="tl-title">${esc(m.title)}</div>
        <div class="tl-date">${esc(m.event_date)}</div>
      </div>`).join('') : '<div class="empty-state" style="padding:16px;">还没有大事记，点"+ 里程碑"记录第一次～</div>';
  },

  calcKidAge(birth) {
    const b = new Date(birth); const now = new Date();
    let years = now.getFullYear() - b.getFullYear();
    let months = now.getMonth() - b.getMonth();
    if (months < 0) { years--; months += 12; }
    if (years > 0) return `${years} 岁 ${months} 个月`;
    return `${months} 个月`;
  },

  openKidModal() {
    const kid = this.state.kids[0];
    openModal(`
      <h3>${kid ? '✏️ 编辑崽崽档案' : '👶 创建崽崽档案'}</h3>
      <div class="form-group"><label>姓名 / 小名</label><input id="kidName" value="${kid ? esc(kid.name) : ''}" placeholder="如：小团子"></div>
      <div class="form-group"><label>出生日期</label><input type="date" id="kidBirth" value="${kid ? kid.birth_date : ''}"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.saveKid()">保存</button>
      </div>`);
  },

  async saveKid() {
    const name = $('#kidName').value.trim();
    const birth = $('#kidBirth').value;
    if (!name || !birth) { toast('请填写完整'); return; }
    const existing = this.state.kids[0];
    if (existing) await DB.update('kids', existing.id, { name, birth_date: birth });
    else await DB.insert('kids', { name, birth_date: birth });
    closeModal();
    toast('✅ 已保存');
    this.state.kids = await DB.select('kids');
    this.renderKids();
  },

  openGrowthModal() {
    openModal(`
      <h3>📈 记录成长</h3>
      <div class="form-row">
        <div class="form-group"><label>日期</label><input type="date" id="grDate" value="${todayStr()}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>身高 (cm)</label><input type="number" id="grHeight" step="0.1" placeholder="如 75"></div>
        <div class="form-group"><label>体重 (kg)</label><input type="number" id="grWeight" step="0.1" placeholder="如 9.5"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.saveGrowth()">保存</button>
      </div>`);
  },

  async saveGrowth() {
    const date = $('#grDate').value;
    const height = parseFloat($('#grHeight').value);
    const weight = parseFloat($('#grWeight').value);
    if (!date || (!height && !weight)) { toast('请填写日期和至少一项数据'); return; }
    const kid = this.state.kids[0];
    await DB.insert('kid_growth', { kid_id: kid.id, record_date: date, height: height || null, weight: weight || null });
    closeModal();
    toast('✅ 已记录');
    this.state.growths = await DB.select('kid_growth', { order: ['record_date', true] });
    this.renderKids();
  },

  openMilestoneModal() {
    openModal(`
      <h3>🏅 记录里程碑</h3>
      <div class="form-group"><label>事件</label><input id="msTitle" placeholder="如：第一次走路 / 第一次叫妈妈"></div>
      <div class="form-group"><label>日期</label><input type="date" id="msDate" value="${todayStr()}"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.saveMilestone()">保存</button>
      </div>`);
  },

  async saveMilestone() {
    const title = $('#msTitle').value.trim();
    const date = $('#msDate').value;
    if (!title) { toast('请填写事件'); return; }
    const kid = this.state.kids[0];
    await DB.insert('kid_milestones', { kid_id: kid.id, title, event_date: date });
    closeModal();
    toast('✅ 已记录');
    this.state.milestones = await DB.select('kid_milestones', { order: ['event_date', true] });
    this.renderKids();
  },

  /* ═════════════════════════════════════════════
     Tab 4 搬砖
     ═════════════════════════════════════════════ */
  renderWorkCalendar() {
    const y = this.state.workMonth.getFullYear();
    const m = this.state.workMonth.getMonth();
    $('#monthTitle').textContent = `${y} 年 ${m + 1} 月`;
    const schedMap = {};
    this.state.schedules.forEach(s => {
      if (s.sched_date.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`)) {
        schedMap[s.sched_date] = schedMap[s.sched_date] || [];
        schedMap[s.sched_date].push(s);
      }
    });
    const firstDay = new Date(y, m, 1);
    const startDow = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    let html = '<div class="cal-head">' + ['一','二','三','四','五','六','日'].map(d => `<span>${d}</span>`).join('') + '</div><div class="cal-row">';
    for (let i = 0; i < startDow; i++) html += '<div class="cal-day empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const scheds = schedMap[ds] || [];
      const dots = scheds.map(s => {
        const cfg = CONFIG.SCHEDULE_TYPES[s.shift_type] || CONFIG.SCHEDULE_TYPES.day;
        return `<span class="sched-dot" style="background:${cfg.color}" title="${esc(s.person === 'male' ? '男方' : '女方')} ${cfg.name}"></span>`;
      }).join('');
      const isToday = ds === todayStr();
      html += `<div class="cal-day ${isToday ? 'today' : ''}" onclick="App.openSchedModal('${ds}')">
        <span class="day-num">${d}</span>
        <span class="sched-dots">${dots}</span>
      </div>`;
    }
    html += '</div>';
    $('#workCalendar').innerHTML = html;

    // 计算下次共同休息日
    this.calcNextRestDay();
  },

  calcNextRestDay() {
    const schedMap = {};
    this.state.schedules.forEach(s => { schedMap[s.sched_date] = schedMap[s.sched_date] || []; schedMap[s.sched_date].push(s); });
    const today = new Date();
    for (let i = 0; i < 90; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const ds = fmtDate(d);
      const scheds = schedMap[ds] || [];
      const maleRest = scheds.some(s => s.person === 'male' && s.shift_type === 'rest');
      const femaleRest = scheds.some(s => s.person === 'female' && s.shift_type === 'rest');
      if (maleRest && femaleRest) {
        $('#nextRestDay').textContent = `📅 下次双人共同休息日：${ds}${i === 0 ? '（就是今天！）' : `（还有 ${i} 天）`}`;
        return;
      }
    }
    $('#nextRestDay').textContent = '📅 下次双人共同休息日：未安排，点日历格子录入排班吧';
  },

  openSchedModal(date) {
    const existing = this.state.schedules.filter(s => s.sched_date === date);
    let html = `<h3>📅 ${date} 排班</h3>`;
    if (existing.length) {
      html += existing.map(s => {
        const cfg = CONFIG.SCHEDULE_TYPES[s.shift_type] || CONFIG.SCHEDULE_TYPES.day;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:var(--primary-light);border-radius:8px;margin-bottom:6px;">
          <span>${s.person === 'male' ? '👦 男方' : '👧 女方'} · <span class="sched-badge" style="background:${cfg.color}">${cfg.name}</span></span>
          <button class="icon-btn" style="background:#fff;color:var(--danger);" onclick="App.deleteSched('${s.id}')">🗑️</button>
        </div>`;
      }).join('');
    }
    html += `<div class="form-group"><label>人员</label>
        <select id="scPerson"><option value="male">👦 男方</option><option value="female">👧 女方</option></select></div>
      <div class="form-group"><label>班次</label>
        <select id="scShift">
          <option value="day">🌞 白班</option>
          <option value="night">🌙 夜班</option>
          <option value="rest">😴 休息</option>
          <option value="trip">✈️ 出差</option>
        </select></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.saveSched('${date}')">保存</button>
      </div>`;
    openModal(html);
  },

  async saveSched(date) {
    const person = $('#scPerson').value;
    const shift = $('#scShift').value;
    await DB.insert('schedules', { sched_date: date, person, shift_type: shift });
    closeModal();
    toast('✅ 已录入');
    this.state.schedules = await DB.select('schedules');
    this.renderWorkCalendar();
    this.renderScheduleList();
  },

  async deleteSched(id) {
    await DB.remove('schedules', id);
    closeModal();
    this.state.schedules = await DB.select('schedules');
    this.renderWorkCalendar();
    this.renderScheduleList();
  },

  renderScheduleList() {
    const y = this.state.workMonth.getFullYear();
    const m = this.state.workMonth.getMonth();
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    const list = this.state.schedules.filter(s => s.sched_date.startsWith(prefix))
      .sort((a, b) => a.sched_date < b.sched_date ? -1 : 1);
    const wrap = $('#scheduleList');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state" style="padding:20px;">本月暂无排班记录</div>';
      return;
    }
    wrap.innerHTML = list.map(s => {
      const cfg = CONFIG.SCHEDULE_TYPES[s.shift_type] || CONFIG.SCHEDULE_TYPES.day;
      return `<div class="schedule-item">
        <span class="sched-date">${s.sched_date.slice(5)}</span>
        <span class="sched-info">${s.person === 'male' ? '👦 男方' : '👧 女方'}</span>
        <span class="sched-badge" style="background:${cfg.color}">${cfg.name}</span>
      </div>`;
    }).join('');
  },

  /* ═════════════════════════════════════════════
     Tab 5 账本
     ═════════════════════════════════════════════ */
  renderTxList() {
    const list = $('#txList');
    const txs = this.state.txs;
    if (!txs.length) {
      list.innerHTML = '<div class="empty-state">还没有记账，点"➕ 记账"开始吧 💰</div>';
      return;
    }
    list.innerHTML = txs.map(t => {
      const icon = CONFIG.TX_CATEGORY_ICONS[t.category] || '📦';
      const sign = t.type === 'income' ? '+' : '-';
      return `<div class="tx-item">
        <div class="tx-cat-icon">${icon}</div>
        <div class="tx-body">
          <div class="tx-cat">${esc(t.category)} <small style="color:var(--text-light)">· ${esc(t.payer === 'male' ? '男方' : t.payer === 'female' ? '女方' : '共同')}</small></div>
          <div class="tx-note">${esc(t.note || t.tx_date)}</div>
        </div>
        ${t.receipt_url ? `<img class="tx-receipt" src="${esc(t.receipt_url)}" onclick="App.viewReceipt('${esc(t.receipt_url)}')">` : ''}
        <button class="tx-cam-btn" onclick="App.attachReceipt('${t.id}')">📷</button>
        <div class="tx-amount ${t.type === 'income' ? 'income' : 'expense'}">${sign}${fmtMoney(t.amount)}</div>
        <button class="icon-btn" style="background:var(--primary-light);color:var(--primary);" onclick="App.deleteTx('${t.id}')">🗑️</button>
      </div>`;
    }).join('');
  },

  updateLedgerSummary() {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let exp = 0, inc = 0;
    this.state.txs.forEach(t => {
      if (t.tx_date.startsWith(prefix)) {
        if (t.type === 'income') inc += Number(t.amount) || 0;
        else exp += Number(t.amount) || 0;
      }
    });
    $('#monthExpense').textContent = fmtMoney(exp);
    $('#monthIncome').textContent = fmtMoney(inc);
  },

  openTxModal() {
    openModal(`
      <h3>💰 记一笔</h3>
      <div class="form-row">
        <div class="form-group"><label>类型</label>
          <select id="txType"><option value="expense">支出</option><option value="income">收入</option></select></div>
        <div class="form-group"><label>金额（元）</label><input type="number" id="txAmount" step="0.01" placeholder="0.00"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>类别</label>
          <select id="txCategory">${CONFIG.TX_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></div>
        <div class="form-group"><label>支付人</label>
          <select id="txPayer"><option value="male">👦 男方</option><option value="female">👧 女方</option><option value="both">🤝 共同</option></select></div>
      </div>
      <div class="form-group"><label>日期</label><input type="date" id="txDate" value="${todayStr()}"></div>
      <div class="form-group"><label>备注</label><input id="txNote" placeholder="如：周末火锅"></div>
      <div class="form-group">
        <label>凭证照片（可选）</label>
        <div class="photo-upload-btn" onclick="document.getElementById('txPhoto').click()">📷 拍照 / 选择付款截图</div>
        <input type="file" id="txPhoto" accept="image/*" class="hidden" onchange="App.previewPhoto(this, 'txPhotoPreview')">
        <div class="photo-preview" id="txPhotoPreview"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.saveTx()">保存</button>
      </div>`);
  },

  async saveTx() {
    const type = $('#txType').value;
    const amount = parseFloat($('#txAmount').value);
    const category = $('#txCategory').value;
    const payer = $('#txPayer').value;
    const date = $('#txDate').value;
    const note = $('#txNote').value.trim();
    if (!amount || amount <= 0) { toast('请填写有效金额'); return; }
    const file = $('#txPhoto').files[0];
    let receipt_url = null;
    if (file) receipt_url = await this.uploadImage(file, 'receipts');
    await DB.insert('transactions', { type, amount, category, payer, note, tx_date: date, receipt_url });
    closeModal();
    toast('✅ 已记账');
    this.state.txs = await DB.select('transactions', { order: ['tx_date', false] });
    this.renderTxList();
    this.updateLedgerSummary();
  },

  async attachReceipt(id) {
    // 简化：直接打开选择器，选定后上传并挂到该笔记录
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      toast('上传中…');
      const url = await this.uploadImage(file, 'receipts');
      await DB.update('transactions', id, { receipt_url: url });
      this.state.txs = await DB.select('transactions', { order: ['tx_date', false] });
      this.renderTxList();
      toast('✅ 凭证已上传');
    };
    input.click();
  },

  viewReceipt(url) {
    openModal(`<h3>🧾 凭证</h3><img src="${esc(url)}" style="width:100%;border-radius:10px;"><div class="modal-actions"><button class="btn btn-primary btn-block" onclick="closeModal()">关闭</button></div>`);
  },

  async deleteTx(id) {
    if (!confirm('删除这笔记录？')) return;
    await DB.remove('transactions', id);
    this.state.txs = await DB.select('transactions', { order: ['tx_date', false] });
    this.renderTxList();
    this.updateLedgerSummary();
  },

  renderLedgerCharts() {
    // 月度收支（最近6个月）
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${d.getMonth() + 1}月` });
    }
    const expData = months.map(mm => this.state.txs.filter(t => t.tx_date.startsWith(mm.key) && t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0));
    const incData = months.map(mm => this.state.txs.filter(t => t.tx_date.startsWith(mm.key) && t.type === 'income').reduce((s, t) => s + Number(t.amount), 0));
    this.renderBarChart('monthlyChart', 'monthlyChart', months.map(m => m.label), [
      { label: '支出', data: expData, color: '#fa5252' },
      { label: '收入', data: incData, color: '#40c057' }
    ]);
    // 分类占比
    const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const catCount = {};
    this.state.txs.filter(t => t.tx_date.startsWith(nowKey) && t.type === 'expense').forEach(t => {
      catCount[t.category] = (catCount[t.category] || 0) + Number(t.amount);
    });
    const entries = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
    if (entries.length) {
      this.renderPieChart('categoryChart', 'categoryChart', entries.map(e => e[0]), entries.map(e => e[1]));
    } else {
      this.destroyChart('categoryChart');
      const el = $('#categoryChart'); if (el) el.parentElement.innerHTML += '<div class="empty-state" style="padding:16px;">本月暂无支出数据</div>';
    }
  },

  /* ═════════════════════════════════════════════
     图表封装
     ═════════════════════════════════════════════ */
  destroyChart(key) { if (this.state.charts[key]) { this.state.charts[key].destroy(); delete this.state.charts[key]; } },

  renderBarChart(canvasId, key, labels, datasets, yLabel, singleColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    this.destroyChart(key);
    const ds = Array.isArray(datasets) ? datasets : [datasets];
    const data = ds.map(d => ({
      label: d.label || yLabel || '',
      data: d.data,
      backgroundColor: d.color || singleColor || '#ff6b81',
      borderRadius: 6
    }));
    this.state.charts[key] = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: data },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: ds.length > 1, position: 'bottom', labels: { font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
      }
    });
  },

  renderLineChart(canvasId, key, labels, series) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    this.destroyChart(key);
    this.state.charts[key] = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: series.map(s => ({
        label: s.label, data: s.data,
        borderColor: s.color, backgroundColor: s.color + '22',
        fill: true, tension: 0.35, pointRadius: 3,
        spanGaps: true
      })) },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
        scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
      }
    });
  },

  renderPieChart(canvasId, key, labels, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    this.destroyChart(key);
    const palette = ['#ff6b81', '#ffa94d', '#4dabf7', '#40c057', '#f783ac', '#748ffc', '#ffd43b', '#fa5252', '#868e96'];
    this.state.charts[key] = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: palette, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } }
      }
    });
  },

  /* ═════════════════════════════════════════════
     图片上传（Storage）
     ═════════════════════════════════════════════ */
  async uploadImage(file, folder) {
    // 本地模式：转 base64 存 localStorage
    const cid = DB.COUPLE();
    const dataUrl = await readFileAsDataURL(file);
    if (DB.isCloud() && window.supabase) {
      try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${cid}/${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const { error } = await window.supabase.storage.from('couplelife').upload(path, file, { contentType: file.type });
        if (error) throw error;
        const { data } = window.supabase.storage.from('couplelife').getPublicUrl(path);
        return data.publicUrl;
      } catch (e) {
        console.warn('Storage 上传失败，降级 base64', e);
        return dataUrl;
      }
    }
    return dataUrl; // 本地 base64 存储
  },

  previewPhoto(input, previewId) {
    const file = input.files[0];
    if (!file) return;
    readFileAsDataURL(file).then(url => {
      const box = document.getElementById(previewId);
      box.innerHTML = `<img src="${url}" alt="预览">`;
    });
  },

  /* ═════════════════════════════════════════════
     个人资料 / 设置
     ═════════════════════════════════════════════ */
  openProfile() {
    const maleR = this.state.restrictions.find(r => r.couple_id === DB.COUPLE());
    const loveStart = localStorage.getItem('cl_love_start') || '';
    const configUrl = getConfig('SUPABASE_URL');
    const configKey = getConfig('SUPABASE_ANON_KEY');
    openModal(`
      <h3>👤 资料与设置</h3>
      <div class="settings-group">
        <h4>🚫 忌口设置（显示在食堂顶部横幅）</h4>
        <div class="form-group"><label>👦 男方忌口</label><input id="rMale" placeholder="如：不吃香菜、海鲜过敏" value="${maleR && maleR.male_restrictions ? esc(maleR.male_restrictions) : ''}"></div>
        <div class="form-group"><label>👧 女方忌口</label><input id="rFemale" placeholder="如：不吃辣" value="${maleR && maleR.female_restrictions ? esc(maleR.female_restrictions) : ''}"></div>
        <button class="btn btn-outline btn-sm" onclick="App.saveRestrictions()">保存忌口</button>
      </div>
      <div class="settings-group">
        <h4>❤️ 在一起纪念日</h4>
        <div class="form-group"><label>开始日期</label><input type="date" id="loveStart" value="${loveStart}"></div>
        <button class="btn btn-outline btn-sm" onclick="App.saveLoveStart()">保存</button>
      </div>
      <div class="settings-group">
        <h4>☁️ 云端连接（Supabase）</h4>
        <p style="font-size:11px;color:var(--text-light);margin-bottom:8px;">当前：${DB.isCloud() ? '✅ 已连接云端（双方数据实时同步）' : '⚠️ 本地模式（仅本机可见）。按部署手册配置后此处填写即可联网同步。'}</p>
        <div class="form-group"><label>Supabase URL</label><input id="cfgUrl" placeholder="https://xxxx.supabase.co" value="${esc(configUrl)}"></div>
        <div class="form-group"><label>Supabase anon Key</label><input id="cfgKey" placeholder="eyJhbGci..." value="${esc(configKey)}"></div>
        <button class="btn btn-outline btn-sm" onclick="App.saveCloudConfig()">保存并重连</button>
      </div>
      <div class="settings-group">
        <h4>🤖 AI 助手 Key（仅存本机浏览器）</h4>
        <div class="form-group"><label>OpenAI API Key</label><input id="cfgOpenAI" type="password" placeholder="sk-..." value="${esc(getConfig('OPENAI_API_KEY'))}"></div>
        <div class="form-group"><label>DeepSeek API Key</label><input id="cfgDeepSeek" type="password" placeholder="sk-..." value="${esc(getConfig('DEEPSEEK_API_KEY'))}"></div>
        <div class="form-group"><label>Kimi API Key</label><input id="cfgKimi" type="password" placeholder="sk-..." value="${esc(getConfig('KIMI_API_KEY'))}"></div>
        <button class="btn btn-outline btn-sm" onclick="App.saveAiKeys()">保存 Key</button>
      </div>
      <div class="settings-group">
        <h4>🔓 安全（情侣密码锁）</h4>
        <p id="lockStatus" style="font-size:11px;color:var(--text-light);margin-bottom:8px;">${LockGate.isRemembered() ? '✅ 本机已开启免密：打开 App 直接进入，无需输密码' : '🔒 本机未免密：每次打开需输入情侣密码'}</p>
        <button class="btn btn-outline btn-sm" onclick="App.clearLocalLock()">${LockGate.isRemembered() ? '关闭本机免密（下次打开要输密码）' : '本机目前未开启免密'}</button>
      </div>
      <div class="modal-actions"><button class="btn btn-outline btn-block" onclick="closeModal()">关闭</button></div>`);
  },

  clearLocalLock() {
    LockGate.clearRemember();
    const s = document.getElementById('lockStatus');
    if (s) s.textContent = '🔒 本机未免密：每次打开需输入情侣密码';
    toast('🔒 已关闭本机免密，下次打开需输入密码');
  },

  async saveRestrictions() {
    const male = $('#rMale').value.trim();
    const female = $('#rFemale').value.trim();
    const existing = this.state.restrictions.find(r => r.couple_id === DB.COUPLE());
    if (existing) await DB.update('dietary_restrictions', existing.id, { male_restrictions: male, female_restrictions: female });
    else await DB.insert('dietary_restrictions', { male_restrictions: male, female_restrictions: female });
    this.state.restrictions = await DB.select('dietary_restrictions');
    this.renderRestrictionBanner();
    toast('✅ 忌口已保存');
  },

  saveLoveStart() {
    const v = $('#loveStart').value;
    if (!v) { toast('请选择日期'); return; }
    localStorage.setItem('cl_love_start', v);
    this.startLoveCounter();
    toast('✅ 已保存');
  },

  saveCloudConfig() {
    const url = $('#cfgUrl').value.trim();
    const key = $('#cfgKey').value.trim();
    if (!url || !key) { toast('请完整填写 URL 和 Key'); return; }
    saveConfig('SUPABASE_URL', url);
    saveConfig('SUPABASE_ANON_KEY', key);
    toast('✅ 已保存，重新连接…');
    setTimeout(() => location.reload(), 800);
  },

  saveAiKeys() {
    saveConfig('OPENAI_API_KEY', $('#cfgOpenAI').value.trim());
    saveConfig('DEEPSEEK_API_KEY', $('#cfgDeepSeek').value.trim());
    saveConfig('KIMI_API_KEY', $('#cfgKimi').value.trim());
    toast('✅ AI Keys 已保存（仅存本机）');
  },

  /* ═════════════════════════════════════════════
     AI 智能助手（多提供商）
     ═════════════════════════════════════════════ */
  aiState: { imageBase64: null, imageUrl: null, pendingLink: null },

  openAiSheet() {
    $('#aiSheetOverlay').classList.remove('hidden');
    $('#aiSheetBody').scrollTop = 0;
    this.aiState = { imageBase64: null, imageUrl: null, pendingLink: null };
    // 恢复用户上次选择的提供商
    const saved = localStorage.getItem('cl_ai_provider');
    if (saved) $('#aiProviderSelect').value = saved;
    this.hideManualModules();
    $('#aiPreviewArea').classList.add('hidden');
    $('#aiResultArea').innerHTML = '';
  },

  closeAiSheet() { $('#aiSheetOverlay').classList.add('hidden'); },

  handleAiFile(file) {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast('图片过大，请选择 6MB 以内'); return; }
    readFileAsDataURL(file).then(dataUrl => {
      this.aiState.imageBase64 = dataUrl;
      this.aiState.imageUrl = null;
      $('#aiPreviewImg').src = dataUrl;
      $('#aiPreviewArea').classList.remove('hidden');
      $('#aiResultArea').innerHTML = '';
    });
  },

  aiPasteLink() {
    const link = prompt('请输入图片或链接地址：');
    if (!link) return;
    if (/\.(png|jpe?g|gif|webp)/i.test(link)) {
      this.aiState.imageBase64 = null;
      this.aiState.imageUrl = link;
      $('#aiPreviewImg').src = link;
      $('#aiPreviewArea').classList.remove('hidden');
    } else {
      this.aiState.pendingLink = link;
      toast('🔗 链接已获取，点击"开始识别"处理');
    }
    $('#aiResultArea').innerHTML = '';
  },

  async aiAnalyze() {
    const provider = $('#aiProviderSelect').value;
    const apiKey = getConfig((CONFIG.AI_PROVIDERS[provider] || {}).apiKeyEnv || provider.toUpperCase() + '_API_KEY');
    $('#aiAnalyzeBtn').textContent = '⏳ 识别中…';
    $('#aiAnalyzeBtn').disabled = true;
    try {
      let result = null;
      if (apiKey) {
        try {
          result = await this.callAiVision(provider, apiKey);
        } catch (e) {
          console.warn('AI 调用失败，降级手动选择', e);
          result = null;
        }
      }
      if (result) {
        this.renderAiResult(result);
      } else {
        this.showManualModules();
        $('#aiResultArea').innerHTML = '<div class="ai-result"><div class="ai-result-title">⚠️ 未配置 Key 或识别失败</div><p style="font-size:13px;color:var(--text-light);">请手动选择要存入的模块：</p></div>';
      }
    } finally {
      $('#aiAnalyzeBtn').textContent = '🔍 开始识别';
      $('#aiAnalyzeBtn').disabled = false;
    }
  },

  async callAiVision(provider, apiKey) {
    const cfg = CONFIG.AI_PROVIDERS[provider];
    const prompt = CONFIG.AI_PROMPT;
    let messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }];
    // 图片
    const imageUrl = this.aiState.imageUrl;
    const imageBase64 = this.aiState.imageBase64;
    const linkText = this.aiState.pendingLink;
    if (imageUrl) messages[0].content.push({ type: 'image_url', image_url: { url: imageUrl } });
    if (imageBase64) messages[0].content.push({ type: 'image_url', image_url: { url: imageBase64 } });
    if (linkText) messages[0].content.push({ type: 'text', text: '附加链接内容地址：' + linkText });

    let baseUrl = cfg.baseUrl, model = cfg.model;
    if (provider === 'custom') {
      baseUrl = getConfig('CUSTOM_AI_BASE_URL') || localStorage.getItem('cl_custom_base') || '';
      model = getConfig('CUSTOM_AI_MODEL') || localStorage.getItem('cl_custom_model') || '';
      if (!baseUrl || !model) { toast('自定义提供商需先在设置填写 Base URL 和 Model'); this.showManualModules(); return null; }
    }
    if (!baseUrl || !model) throw new Error('提供商配置不完整');

    const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, max_tokens: 800 })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' ' + errText.slice(0, 120));
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('AI 无返回');
    try {
      // 提取 JSON（AI 可能输出 markdown 包裹）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('无法解析 JSON');
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn('JSON 解析失败，原文：', content);
      throw new Error('AI 返回格式异常');
    }
  },

  renderAiResult(result) {
    const area = $('#aiResultArea');
    const module = (result.module || '').trim();
    const data = result.data || {};
    let html = '<div class="ai-result"><div class="ai-result-title">✅ 识别结果</div>';
    html += `<p style="font-size:13px;">检测到模块：<b>${esc(this.moduleName(module))}</b></p>`;
    const detail = Object.entries(data).slice(0, 5).map(([k, v]) => `<span style="font-size:12px;color:var(--text-light);">${esc(k)}: ${esc(String(v).slice(0, 30))}</span>`).join('<br>');
    if (detail) html += `<p style="font-size:12px;margin-top:6px;">${detail}</p>`;
    html += `<div class="ai-result-confirm">
      <button class="btn btn-outline" onclick="App.showManualModules()">手动选择</button>
      <button class="btn btn-primary" onclick="App.applyAiResult()">确认录入 ✅</button>
    </div></div>`;
    area.innerHTML = html;
    this._aiResult = { module, data };
  },

  moduleName(m) {
    return { '菜谱': '菜谱', '排班表': '排班', '付款凭证': '付款凭证', '纪念日照片': '纪念日', '健康记录': '健康数据' }[m] || m || '未知';
  },

  applyAiResult() {
    const { module, data } = this._aiResult || {};
    if (!module) return;
    this.closeAiSheet();
    if (module.includes('付款') || module.includes('账') || module.includes('凭证')) {
      const amount = parseFloat(data.amount || data.金额 || data.price || 0);
      this.openTxModal();
      if ($('#txAmount')) $('#txAmount').value = amount || '';
      if (data.category && $('#txCategory')) $('#txCategory').value = data.category;
      if (data.note && $('#txNote')) $('#txNote').value = data.note;
      if (this.aiState.imageBase64) {
        // 把凭证图挂到记账弹窗
        setTimeout(() => {
          const preview = $('#txPhotoPreview');
          if (preview) preview.innerHTML = `<img src="${this.aiState.imageBase64}" alt="凭证">`;
        }, 200);
      }
      toast('💰 已填入账本表单，确认保存即可');
    } else if (module.includes('菜谱')) {
      this.openRecipeModal();
      if (data.name && $('#rpName')) $('#rpName').value = data.name;
      if (data.ingredients && $('#rpIngredients')) $('#rpIngredients').value = data.ingredients;
      if (data.steps && $('#rpSteps')) $('#rpSteps').value = data.steps;
    } else if (module.includes('排班')) {
      toast('📅 排班信息请在日历页手动点选日期录入');
      this.switchTab('work');
    } else if (module.includes('纪念日')) {
      this.openEventModal();
      if (data.name && $('#evName')) $('#evName').value = data.name;
      if (data.date && $('#evDate')) $('#evDate').value = data.date;
    } else if (module.includes('健康')) {
      this.switchTab('health');
      toast('💪 健康数据请手动录入（身高体重）');
    } else {
      this.showManualModules();
    }
  },

  showManualModules() {
    const grid = $('#aiManualGrid');
    const modules = [
      { key: 'recipe', label: '🍽️ 菜谱', act: () => { this.closeAiSheet(); this.openRecipeModal(); } },
      { key: 'schedule', label: '📅 排班', act: () => { this.closeAiSheet(); this.switchTab('work'); } },
      { key: 'receipt', label: '🧾 付款凭证', act: () => { this.closeAiSheet(); this.openTxModal(); } },
      { key: 'anniversary', label: '💝 纪念日', act: () => { this.closeAiSheet(); this.openEventModal(); } },
      { key: 'health', label: '💪 健康记录', act: () => { this.closeAiSheet(); this.switchTab('health'); } },
      { key: 'cancel', label: '🚪 取消', act: () => this.closeAiSheet() }
    ];
    grid.innerHTML = modules.map(m => `<button class="ai-manual-item" onclick="App.manualPick('${m.key}')">${m.label}</button>`).join('');
    $('#aiManualModules').classList.remove('hidden');
  },
  hideManualModules() { $('#aiManualModules').classList.add('hidden'); },

  manualPick(key) {
    const map = {
      recipe: () => { this.closeAiSheet(); this.openRecipeModal(); },
      schedule: () => { this.closeAiSheet(); this.switchTab('work'); },
      receipt: () => { this.closeAiSheet(); this.openTxModal(); },
      anniversary: () => { this.closeAiSheet(); this.openEventModal(); },
      health: () => { this.closeAiSheet(); this.switchTab('health'); },
      cancel: () => this.closeAiSheet()
    };
    if (map[key]) map[key]();
  },

  /* ── 菜谱录入弹窗 ── */
  openRecipeModal() {
    openModal(`
      <h3>🍳 上传菜谱</h3>
      <div class="form-group"><label>菜名</label><input id="rpName" placeholder="如：可乐鸡翅"></div>
      <div class="form-group"><label>食材</label><input id="rpIngredients" placeholder="如：鸡翅、可乐、姜、生抽"></div>
      <div class="form-group"><label>做法步骤</label><textarea id="rpSteps" placeholder="1. 鸡翅焯水\n2. 煎至金黄\n3. 倒入可乐焖煮…"></textarea></div>
      <div class="form-group">
        <label>成品图（可选）</label>
        <div class="photo-upload-btn" onclick="document.getElementById('rpPhoto').click()">📷 拍照 / 选择照片</div>
        <input type="file" id="rpPhoto" accept="image/*" class="hidden" onchange="App.previewPhoto(this, 'rpPhotoPreview')">
        <div class="photo-preview" id="rpPhotoPreview"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App.saveRecipe()">保存</button>
      </div>`);
  },

  async saveRecipe() {
    const name = $('#rpName').value.trim();
    const ingredients = $('#rpIngredients').value.trim();
    const steps = $('#rpSteps').value.trim();
    if (!name) { toast('请填写菜名'); return; }
    const file = $('#rpPhoto').files[0];
    let image_url = null;
    if (file) {
      toast('上传图片中…');
      image_url = await this.uploadImage(file, 'recipes');
    }
    await DB.insert('recipes', { name, ingredients, steps, image_url });
    closeModal();
    toast('✅ 菜谱已上传');
    this.state.recipes = await DB.select('recipes', { order: ['created_at', false] });
    this.renderRecipes();
  },

  /* ── 工具 ── */
  pickWho(title) {
    const who = prompt(title + '（输入 1 或 2）：\n1 = 男方，2 = 女方');
    if (who === '1') return 'male';
    if (who === '2') return 'female';
    return null;
  },

  updateBadges() {
    const pendingCount = this.state.orders.filter(o => o.status !== 'done').length;
    const badge = $('#badge-canteen');
    if (pendingCount > 0) {
      badge.textContent = pendingCount > 99 ? '99+' : pendingCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
};

/* ── 辅助函数 ── */
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function whoAmI() { return 'male'; }
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ═══════════════════════════════════════════════════════════
   情侣密码锁屏（防路人访问）
   说明：密码经本地哈希后存 localStorage（不存明文）。
   解锁方式：
   - 勾选「记住本设备」→ 解锁状态存 localStorage，这台设备永久免密
     （直到在设置页关闭免密或清除浏览器数据）
   - 不勾选 → 解锁状态存 sessionStorage，关掉页面后下次仍需输入
   注意：这是「门锁」级别的防护，防普通访客/搜索引擎；
   纯前端方案无法防住懂技术的人（源码公开可绕过），
   如数据极其敏感，应改用 Supabase Auth 登录方案。
   ═══════════════════════════════════════════════════════════ */
const LockGate = (() => {
  const KEY = 'cl_lock_hash';
  const UNLOCK_KEY = 'cl_unlocked';
  const SALT = 'couplelife_v3_2026';

  function hash(pwd) {
    let h = 5381;
    const s = SALT + pwd + SALT;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    let out = (h >>> 0).toString(16);
    for (let r = 0; r < 3; r++) {
      let h2 = 0;
      for (let i = 0; i < out.length; i++) h2 = ((h2 << 5) + h2 + out.charCodeAt(i)) | 0;
      out = (h2 >>> 0).toString(16);
    }
    return out;
  }
  const hasPwd = () => !!localStorage.getItem(KEY);
  const setPwd = p => localStorage.setItem(KEY, hash(p));
  const check = p => hash(p) === localStorage.getItem(KEY);
  const isRemembered = () => localStorage.getItem(UNLOCK_KEY) === '1';
  const isSession = () => sessionStorage.getItem(UNLOCK_KEY) === '1';
  const isUnlocked = () => isRemembered() || isSession();
  function unlock(remember) {
    if (remember) { localStorage.setItem(UNLOCK_KEY, '1'); sessionStorage.removeItem(UNLOCK_KEY); }
    else { sessionStorage.setItem(UNLOCK_KEY, '1'); }
  }
  function clearRemember() { localStorage.removeItem(UNLOCK_KEY); }

  function init() {
    const screen = document.getElementById('lockScreen');
    if (!screen) return;
    if (hasPwd() && isUnlocked()) { screen.classList.add('hidden'); return; }
    screen.classList.remove('hidden');

    const title = document.getElementById('lockTitle');
    const sub = document.getElementById('lockSub');
    const input = document.getElementById('lockInput');
    const input2 = document.getElementById('lockInput2');
    const btn = document.getElementById('lockBtn');
    const err = document.getElementById('lockErr');
    const rememberBox = document.getElementById('lockRemember');
    const isSetup = !hasPwd();

    if (isSetup) {
      title.textContent = '设置情侣密码';
      sub.textContent = '首次使用：设置一个只有你俩知道的密码';
      input2.classList.remove('hidden');
    } else {
      title.textContent = '欢迎回来';
      sub.textContent = '输入情侣密码进入 CoupleLife';
      input2.classList.add('hidden');
    }

    function tryUnlock() {
      err.classList.add('hidden');
      const p1 = input.value;
      if (!p1) { err.textContent = '请输入密码'; err.classList.remove('hidden'); return; }
      if (isSetup) {
        const p2 = input2.value;
        if (p1.length < 4) { err.textContent = '密码至少 4 位'; err.classList.remove('hidden'); return; }
        if (p1 !== p2) { err.textContent = '两次输入不一致'; err.classList.remove('hidden'); return; }
        setPwd(p1);
        unlock(rememberBox ? rememberBox.checked : true);
        screen.classList.add('hidden');
        return;
      }
      if (check(p1)) {
        unlock(rememberBox ? rememberBox.checked : true);
        screen.classList.add('hidden');
      } else { err.textContent = '密码不对，再试一次'; err.classList.remove('hidden'); input.value = ''; input.focus(); }
    }

    btn.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
    input2.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
    input.focus();
  }

  return { init, isRemembered, clearRemember };
})();

/* 页面加载后：先验证密码锁，再初始化应用 */
document.addEventListener('DOMContentLoaded', () => {
  LockGate.init();
  App.init();
});
