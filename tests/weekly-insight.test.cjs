const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
const core = require('../dist/core.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');
const { renderFinanceAdvisor } = require('../dist/ui.cjs');
const ai = require('../dist/ai.cjs');
const { createFinanceAdviceCache, assessFinanceAdvice } = require('../dist/advice-lifecycle.cjs');
const { markInsightSeen, withInsightHistory } = require('../dist/insights.cjs');
const now = new Date(2026, 9, 5, 8);

class Element {
  constructor(options = {}) { this.textContent = options.text ?? ''; this.classes = new Set((options.cls ?? '').split(' ')); this.children = []; this.listeners = {}; this.attributes = { ...options.attr }; this.ownerDocument = { hidden: true, querySelector: () => null }; }
  createEl(tag, options) { const child = new Element(options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addClass(name) { this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  hasClass(name) { return this.classes.has(name); }
  toggleClass(name, enabled) { if (enabled) this.addClass(name); else this.removeClass(name); }
  setText(value) { this.textContent = value; }
  focus() {}
  addEventListener(name, fn) { this.listeners[name] = fn; }
  getBoundingClientRect() { return { top: 0, bottom: 100 }; }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
  querySelector(selector) { return this.all().find(el => el.classes.has(selector.slice(1))); }
}

test('reopening, rollover and backfills retain the saved text and original week without AI requests', async () => {
  const data = [...files(), ...Array.from({ length: 16 }, (_, i) => file(core.addDays('2026-08-15', i), 5))], original = snapshot(data);
  const cache = JSON.parse(JSON.stringify(createFinanceAdviceCache(original, ai.parseFinanceAdvice('上次保存的分析。', original))));
  cache.advice.action = '上次保存的建议。';
  let requests = 0;
  global.__ledgerTestRequest = async () => { requests++; throw new Error('offline'); };
  try {
    for (const next of [original, snapshot(data, {}, new Date(2026, 9, 6)), snapshot([...data, file('2026-10-04', 999)])]) {
      const v = Object.create(LedgerStatisticsView.prototype), root = new Element();
      const saved = JSON.parse(JSON.stringify(cache));
      Object.assign(v, { closed: false, financeAdviceLoading: false, financeAdviceError: '', contentEl: root,
        currentFinanceSnapshot: () => next, refreshFinanceSection: () => {},
        app: { vault: { getName: () => 'manual-weekly-tests' } },
        plugin: { repository: { files: new Map(data.map((f, i) => [i, f])) }, settings: { salaryCents: 600000, financeAiEnabled: true,
          financeAiEndpoint: 'https://example.invalid/v1', financeAiApiKey: '', financeAiModel: 'test', financeAdviceCache: saved } } });
      v.renderFinanceSection(root, false);
      v.renderFinanceSection(root, false);
      assert.equal(requests, 0);
      assert.match(root.querySelector('.ledger-advisor-judgment').textContent, /上次保存的分析/);
      assert.match(root.querySelector('.ledger-advisor-period').textContent, /2026\.09\.28 — 2026\.10\.04 · 手动刷新/);
      assert.deepEqual(v.plugin.settings.financeAdviceCache, cache);
      const card = root.querySelector('.ledger-advisor-card');
      assert.ok(card.querySelector('.ledger-advisor-remaining'), 'original balance is retained');
      assert.match(card.querySelector('.ledger-advisor-action').children[1].textContent, /上次保存的建议/);
      const sidebar = card.querySelector('.ledger-advisor-summary');
      assert.equal(sidebar.children.length, 4, 'three cycle cards plus category references form the sidebar');
      assert.equal(card.querySelector('.ledger-advisor-actions').children[0], card.querySelector('.ledger-advisor-refresh'));
      assert.equal(card.querySelector('.ledger-advisor-refresh').children.length, 0, 'refresh is an icon with no visible caption');
      assert.equal(sidebar.children[3], card.querySelector('.ledger-advisor-categories'));
      assert.equal(card.querySelector('.ledger-advisor-heading').querySelector('.ledger-advisor-refresh'), undefined);
      assert.equal(card.querySelector('.ledger-advisor-daily-facts'), undefined, 'duplicate yesterday facts are removed');
      assert.equal(card.querySelector('.ledger-advisor-ongoing'), undefined, 'ongoing reminders do not expand the insight');
      assert.equal(card.querySelector('.ledger-advisor-ai-status'), undefined, 'generation timestamp does not occupy a row');
      assert.ok(card.querySelector('.ledger-advisor-categories'), 'original category references are retained');
      assert.equal(card.hasClass('is-ai-only'), false);
      assert.equal(card.all().some(el => el.textContent === '周预算 · 日预算 × 7' || el.textContent === '有效记账天数'), false);
      const info = card.querySelector('.ledger-advisor-info-panel'), toggle = card.querySelector('.ledger-advisor-info-toggle');
      assert.equal(info.hidden, true);
      toggle.listeners.click(); assert.equal(info.hidden, false);
      toggle.listeners.click(); assert.equal(info.hidden, true);
      assert.equal(sidebar.querySelector('.ledger-advisor-category-list').children.length, 1, 'only the first reference is initially shown');
      assert.ok(card.querySelector('.ledger-advisor-budget'), 'today budget lives inside the insight card');
      // Exercise the actual card button, including a failed request and re-render.
      root.querySelector('.ledger-advisor-refresh').listeners.click();
      await new Promise(done => setImmediate(done));
      assert.equal(requests > 0, true);
      assert.deepEqual(v.plugin.settings.financeAdviceCache, cache);
      const after = new Element(); v.renderFinanceSection(after, false);
      assert.match(after.querySelector('.ledger-advisor-judgment').textContent, /上次保存的分析/);
      assert.match(after.querySelector('.ledger-advisor-ai-status').textContent, /保留上次分析/);
      requests = 0;
    }
  } finally { delete global.__ledgerTestRequest; }
});

test('category references keep one visible and preserve the original remaining entries behind native disclosure', () => {
  const s = snapshot();
  s.historyCycleCount = 2;
  s.categories = ['购物', '零食', '娱乐'].map((category, i) => ({ category, baselineCycleCents: 10000 - i * 1000, currentCents: 2000, remainingReferenceCents: 8000 - i * 1000 }));
  const root = new Element(); let expanded;
  renderFinanceAdvisor(root, s, { status: 'local', advice: null, canRefresh: true, message: '' }, () => {}, false, undefined, undefined, undefined, false, value => { expanded = value; });
  const section = root.querySelector('.ledger-advisor-categories'), more = section.querySelector('.ledger-advisor-category-more');
  assert.equal(section.querySelector('.ledger-advisor-category-list').children.length, 1);
  assert.equal(more.open, false);
  assert.equal(more.querySelector('.ledger-advisor-category-list').children.length, 2);
  more.open = true; more.listeners.toggle(); assert.equal(expanded, true);
  more.open = false; more.listeners.toggle(); assert.equal(expanded, false);
});

test('reference disclosure starts closed, retains all data and remembers expansion independently of category disclosure', () => {
  const root = new Element(); let expanded;
  const state = { status: 'local', advice: null, canRefresh: true, message: '', todayBudget: { date: '2026-10-06', spentCents: 0, budgetCents: 5000, category: '', includeStarred: true } };
  const render = (parent, open) => renderFinanceAdvisor(parent, snapshot(), state, () => {}, false, undefined, undefined, undefined, false, undefined, undefined, open, value => { expanded = value; });
  render(root, false);
  const panel = root.querySelector('.ledger-advisor-references'), toggle = root.querySelector('.ledger-advisor-references-toggle');
  assert.equal(panel.hasClass('is-open'), false);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  assert.equal(panel.all().filter(el => el.hasClass('ledger-advisor-summary-item')).length, 3);
  assert.equal(panel.querySelector('.ledger-advisor-budget'), undefined, 'today budget remains outside the folded region');
  assert.ok(root.querySelector('.ledger-advisor-budget'));
  toggle.listeners.click(); assert.equal(expanded, true); assert.equal(panel.hasClass('is-open'), true); assert.equal(toggle.attributes['aria-expanded'], 'true');
  const rerender = new Element(); render(rerender, expanded);
  assert.equal(rerender.querySelector('.ledger-advisor-references').hasClass('is-open'), true);
  rerender.querySelector('.ledger-advisor-references-toggle').listeners.click(); assert.equal(expanded, false);
});

test('inline budget distinguishes normal, overspent and unset budgets without exceeding the track', () => {
  for (const [spent, limit, fill, phrase] of [[1500, 5000, '30', '剩余 ¥35.00'], [7500, 5000, '100', '超出 ¥25.00'], [2000, 0, null, '请在设置中填写每日预算']]) {
    const root = new Element();
    renderFinanceAdvisor(root, snapshot(), { status: 'local', advice: null, canRefresh: true, message: '', todayBudget: { date: '2026-10-06', spentCents: spent, budgetCents: limit, category: '', includeStarred: true } }, () => {}, false);
    const strip = root.querySelector('.ledger-advisor-budget'), track = strip.querySelector('.ledger-advisor-budget-track');
    assert.ok(strip.all().some(el => el.textContent.includes(phrase)), 'budget status remains readable beside the amount');
    if (fill === null) assert.equal(track, undefined);
    else { assert.equal(track.attributes['aria-valuenow'], fill); assert.equal(strip.querySelector('.ledger-advisor-budget-fill').attributes.style, `width: ${fill}%`); }
    assert.equal(root.querySelector('.ledger-budget-card'), undefined);
  }
});

test('today budget keeps category and star settings independent of cached yesterday insights and view filters', () => {
  const today = core.isoFromDate(new Date());
  const f = core.parseLedgerFile(`private/${today}.md`, `---\ndate: ${today}\ntotal: 55\n---\n# 今日消费记录\n- 12:00｜餐饮｜￥20.00（午饭）\n- 15:00｜购物｜￥35.00（采购）`);
  const v = Object.create(LedgerStatisticsView.prototype), s = snapshot();
  const cache = createFinanceAdviceCache(s, ai.parseFinanceAdvice('保留昨日洞察。', s));
  Object.assign(v, { closed: false, financeAdviceLoading: false, financeAdviceError: '', currentFinanceSnapshot: () => s,
    filter: { range: { start: '2020-01-01', end: '2020-01-02' }, categories: ['娱乐'], keyword: '无匹配' },
    plugin: { repository: { files: new Map([[f.path, f]]) }, settings: { financeAiEnabled: true, financeAiEndpoint: 'https://example.invalid/v1', financeAiModel: 'test', financeAdviceCache: cache,
      salaryCents: 600000, dailyBudgetCents: 5000, starredRecordIds: [f.records[0].id] } } });
  for (const [category, include, expected] of [['餐饮', false, '¥0.00'], ['餐饮', true, '¥20.00'], ['', false, '¥35.00'], ['', true, '¥55.00']]) {
    Object.assign(v.plugin.settings, { budgetCategory: category, includeStarredInBudget: include });
    const root = new Element(); v.contentEl = root; v.renderFinanceSection(root, false);
    assert.ok(root.querySelector('.ledger-advisor-budget-value').textContent.includes(`已花 ${expected} / ¥50.00`));
    assert.equal(v.plugin.settings.financeAdviceCache, cache);
    assert.match(root.querySelector('.ledger-advisor-judgment').textContent, /保留昨日洞察/);
  }
});
function file(date, amount, category = '餐饮', note = '午饭') {
  return core.parseLedgerFile(`private/${category}/${date}.md`, `---\ndate: ${date}\ntotal: ${amount}\n---\n# 今日消费记录\n${amount ? `- 12:00｜${category}｜￥${amount.toFixed(2)}（${note}）` : ''}`);
}
function files() { return Array.from({ length: 35 }, (_, i) => file(core.addDays('2026-10-04', -i), [10, 5, 20, 0, 15][Math.floor(i / 7)])); }
function snapshot(data = files(), settings = {}, date = now) {
  const v = Object.create(LedgerStatisticsView.prototype);
  v.plugin = { repository: { files: new Map(data.map((f, i) => [i, f])) }, settings: { dailyBudgetCents: 5000, budgetCategory: '', includeStarredInBudget: true, starredRecordIds: [], salaryCents: 600000, excludedCategories: [], fixedExpenses: [], insightHistory: [], ...settings } };
  return v.currentFinanceSnapshot(date);
}

test('only the visible and returned analysis body stays within 50 Unicode characters, preserving title and advice', async () => {
  const s = snapshot();
  const old = { ...ai.parseFinanceAdvice('🙂'.repeat(90), s), headline: '一条过长的洞察标题应当简化显示而不是占满手机屏幕', action: '接下来几天观察这一消费变化是否持续发生，再安排后续采购。', categoryLines: [{ category: '餐饮', text: '重复的分类分析。' }] };
  const saved = structuredClone(old);
  const compact = ai.compactFinanceAdvice(old);
  const count = a => Array.from(a.judgment).length;
  assert.ok(count(compact) <= 50);
  assert.ok(!/[\uD800-\uDBFF]$/.test(compact.judgment));
  assert.equal(compact.headline, old.headline);
  assert.equal(compact.action, old.action);
  assert.deepEqual(compact.categoryLines, old.categoryLines);
  assert.deepEqual(old, saved);
  const root = new Element();
  renderFinanceAdvisor(root, s, { status: 'ready', advice: old, message: '', canRefresh: true }, () => {}, false);
  assert.equal(root.querySelector('.ledger-advisor-judgment').textContent, compact.judgment);
  let body;
  global.__ledgerTestRequest = async request => {
    body = JSON.parse(request.body);
    return { status: 200, json: { choices: [{ message: { content: JSON.stringify({ headline: old.headline, cause_hypothesis: old.judgment, action: old.action }) } }] } };
  };
  try {
    const result = await ai.requestFinanceAdvice({ endpoint: 'https://example.invalid/v1/chat/completions', model: 'test', apiKey: '' }, s);
    assert.ok(count(result) <= 50);
    assert.equal(result.headline, old.headline);
    assert.equal(result.action, old.action);
    assert.match(body.messages[0].content, /正文 cause_hypothesis 不得超过 50 字/);
    assert.equal(body.max_completion_tokens, 600);
  } finally { delete global.__ledgerTestRequest; }
});

test('next-day hint only appears for a stale cached analysis and never requests AI automatically', () => {
  const data = files(), s = snapshot(data);
  const cache = createFinanceAdviceCache(s, ai.parseFinanceAdvice('本周消费平稳。', s));
  const v = Object.create(LedgerStatisticsView.prototype);
  let requests = 0;
  Object.assign(v, { contentEl: new Element(), financeAdviceError: '', financeAdviceLoading: false,
    currentFinanceSnapshot: () => s, loadFinanceAdvice: () => requests++,
    plugin: { repository: { files: new Map(data.map((f, i) => [i, f])) }, settings: { salaryCents: 600000, financeAiEnabled: true, financeAiEndpoint: 'https://example.invalid/v1', financeAiModel: 'test', financeAdviceCache: cache } } });
  const current = new Element(); v.renderFinanceSection(current, false);
  assert.equal(current.querySelector('.ledger-advisor-update-hint'), undefined);
  v.currentFinanceSnapshot = () => snapshot(data, {}, new Date(2026, 9, 6));
  const stale = new Element(); v.renderFinanceSection(stale, false);
  assert.equal(stale.querySelector('.ledger-advisor-update-hint').textContent, '可更新');
  assert.equal(requests, 0);
  assert.deepEqual(v.plugin.settings.financeAdviceCache, cache);
  stale.querySelector('.ledger-advisor-update-hint').listeners.click();
  assert.equal(requests, 1);
  v.financeAdviceLoading = true;
  const loading = new Element(); v.renderFinanceSection(loading, false);
  assert.equal(loading.querySelector('.ledger-advisor-update-hint'), undefined);
});

test('remaining salary and calibrated balances keep the negative sign after overspending', () => {
  const s = snapshot([file('2026-10-04', 6100)]);
  const root = new Element();
  renderFinanceAdvisor(root, s, { status: 'local', advice: null, canRefresh: false, message: '' }, () => {}, false);
  const remaining = root.querySelector('.ledger-advisor-remaining');
  assert.equal(remaining.children[1].textContent, '-¥100.00');
  assert.equal(remaining.hasClass('is-negative'), true);
  const calibrated = new Element();
  renderFinanceAdvisor(calibrated, s, { status: 'local', advice: null, canRefresh: false, message: '' }, () => {}, false, undefined, undefined, undefined, false, undefined, { remainingCents: -50, calibrated: true });
  assert.equal(calibrated.querySelector('.ledger-advisor-remaining').children[1].textContent, '-¥0.50');
  assert.equal(calibrated.querySelector('.ledger-advisor-remaining').children[0].textContent, '当前负债 · 已校准');
  assert.equal(remaining.children[0].textContent, '目前还剩');
});
test('rolling seven days cross the month and compare equal preceding windows with four complete historical weeks', () => {
  const s = snapshot(), w = s.weekly;
  assert.deepEqual(w.range, { start: '2026-09-28', end: '2026-10-04' });
  assert.deepEqual(w.previousRange, { start: '2026-09-21', end: '2026-09-27' });
  assert.equal(w.spentCents, 7000);
  assert.equal(w.count, 7);
  assert.equal(w.previousSpentCents, 3500);
  assert.equal(w.changeCents, 3500);
  assert.equal(w.changeRatio, 1);
  assert.equal(w.historicalWeeks, 4);
  assert.equal(w.historicalAverageCents, 7000);
  assert.equal(w.historicalChangeCents, 0);
  assert.equal(w.budgetCents, 35000);
  assert.equal(w.budgetRatio, .2);
  assert.equal(w.coverage.recordedDays, 7);
  assert.equal(s.events[0].type, 'weekly');
  assert.equal(s.events.some(e => e.type === 'daily'), false);
});
test('missing yesterday keeps the week visible but never claims missing consumption was zero', () => {
  const s = snapshot(files().filter(f => f.date !== '2026-10-04'));
  assert.equal(s.daily.status, 'unrecorded');
  assert.equal(s.weekly.spentCents, 6000);
  assert.equal(s.weekly.coverage.recordedDays, 6);
  assert.deepEqual(s.weekly.coverage.missingDates, ['2026-10-04']);
  assert.equal(s.weekly.changeCents, null);
  assert.equal(s.weekly.historicalChangeCents, null);
  assert.match(s.events[0].title, /6\/7/);
  assert.doesNotMatch(s.events[0].title, /预算内/);
  assert.equal(s.weekly.changes.some(c => c.kind === 'high-day' || c.kind === 'category'), false);
});
test('bad totals, duplicate bad files and undated records degrade coverage and historical comparison', () => {
  const data = files(), bad = file('2026-10-04', 30);
  bad.diagnostics.push({ kind: 'total', path: bad.path, reason: 'mismatch' });
  const s = snapshot([...data, bad]);
  assert.deepEqual(s.weekly.coverage.problemDates, ['2026-10-04']);
  assert.equal(s.weekly.coverage.recordedDays, 6);
  const undated = core.parseLedgerFile('private/unknown.md', '# 今日消费记录\n- 12:00｜餐饮｜￥42.00');
  const unknown = snapshot([...data, undated]);
  assert.equal(unknown.weekly.undatedCount, 1);
  assert.equal(unknown.weekly.coverage.complete, false);
  assert.equal(unknown.weekly.historicalWeeks, 0);
  const previousMissing = snapshot(data.filter(f => f.date !== '2026-09-22'));
  assert.equal(previousMissing.weekly.changeCents, null);
  assert.equal(previousMissing.weekly.historicalWeeks, 3);
});
test('explicit zero days count as recorded, with no division by zero or invented growth percentage', () => {
  const data = files().map(f => f.date >= '2026-09-21' && f.date <= '2026-09-27' ? file(f.date, 0) : f);
  const w = snapshot(data).weekly;
  assert.equal(w.previousCoverage.recordedDays, 7);
  assert.equal(w.previousSpentCents, 0);
  assert.equal(w.changeCents, 7000);
  assert.equal(w.changeRatio, null);
  const zero = snapshot(data.map(f => f.date >= '2026-09-28' ? file(f.date, 0) : f)).weekly;
  assert.equal(zero.coverage.complete, true);
  assert.equal(zero.spentCents, 0);
  assert.equal(zero.count, 0);
  assert.deepEqual(zero.changes, []);
});
test('week budget follows category and star settings while headline spending remains whole ledger', () => {
  const data = [...files(), file('2026-10-04', 100, '购物')];
  const w = snapshot(data, { budgetCategory: '餐饮', includeStarredInBudget: false, starredRecordIds: [data[0].records[0].id] }).weekly;
  assert.equal(w.spentCents, 17000);
  assert.equal(w.budgetSpentCents, 6000);
  assert.equal(w.budgetCategory, '餐饮');
  assert.equal(w.includeStarred, false);
  assert.equal(w.budgetCents, 35000);
  assert.equal(snapshot(data, { dailyBudgetCents: 0 }).weekly.budgetRatio, null);
});
test('change points preserve category decreases, the largest source record and a high spending day', () => {
  const data = files().map(f => f.date >= '2026-09-28' ? file(f.date, f.date === '2026-10-01' ? 100 : 0, '购物', '超市采购') : f);
  const w = snapshot(data).weekly;
  assert.equal(w.changes.length, 3);
  assert.equal(w.changes[0].kind, 'category');
  assert.match(w.changes[0].text, /增加 ¥100.00/);
  assert.equal(w.changes[1].records[0].date, '2026-10-01');
  assert.equal(w.changes[1].records[0].cents, 10000);
  assert.match(w.changes[2].text, /100.0%/);
  assert.ok(w.changes.every(c => c.records.every(r => data.some(f => f.records.includes(r)))));
});
test('today does not invalidate cached weekly text, while backfills and a new cutoff do', () => {
  const data = files(), s = snapshot(data), advice = ai.parseFinanceAdvice('AI 周分析无需内容校验，金额 9999 元也不拦截。', s);
  const cache = createFinanceAdviceCache(s, advice);
  assert.equal(advice.primaryEventId, 'weekly:2026-09-28:2026-10-04');
  assert.equal(assessFinanceAdvice(snapshot([...data, file('2026-10-05', 999)]), cache).needsRefresh, false);
  assert.equal(assessFinanceAdvice(snapshot(data.slice(1)), cache).needsRefresh, true);
  assert.equal(assessFinanceAdvice(snapshot(data, {}, new Date(2026, 9, 6, 8)), cache).advice, null);
  assert.equal(assessFinanceAdvice(s, { ...cache, advice: { ...advice, primaryEventId: 'daily:2026-10-04' } }).advice, null);
  assert.deepEqual(markInsightSeen([], s, advice.primaryEventId), []);
  assert.equal(withInsightHistory(s, [{ cycle: s.currentRange.start, id: advice.primaryEventId }]).repeatedEvents.length, 0);
});
test('AI receives weekly calculations and coverage without local file paths or today data', () => {
  const s = snapshot([...files(), file('2026-10-05', 999, '今天专属分类')]);
  const input = ai.financeAiInput(s), data = JSON.parse(input);
  assert.equal(data.weekly_brief.range.end, '2026-10-04');
  assert.equal(data.weekly_brief.coverage.recordedDays, 7);
  assert.equal(data.numeric_facts['week.spent'].value, 70);
  assert.equal(data.numeric_facts['week.change_percent'].value, 100);
  assert.doesNotMatch(input, /private\/|今天专属分类/);
  assert.ok(data.weekly_brief.changes.every(c => !('records' in c)));
  assert.equal(s.weekly.spentCents, 7000);
});
