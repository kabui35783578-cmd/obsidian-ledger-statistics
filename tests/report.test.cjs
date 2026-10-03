const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/core.cjs');
const R = require('../dist/report.cjs');
const AI = require('../dist/report-ai.cjs');
const { RequestGate } = require('../dist/request-gate.cjs');
const { ReportPanel, ReportEvidenceModal, renderReportArticle } = require('../dist/report-ui.cjs');
const now = new Date(2026, 8, 30, 12);
const prefs = { ...R.defaultReportPreferences(now), mode: 'custom', customRange: { start: '2026-09-01', end: '2026-09-28' } };
function ledgers(start, end, entries = () => []) {
  const files = [];
  for (let d = start; d <= end; d = core.addDays(d, 1)) {
    const rs = entries(d); const total = rs.reduce((s, r) => s + r[1], 0);
    files.push(core.parseLedgerFile(`账本/${d}.md`, `---\ndate: ${d}\ntotal: ${(total / 100).toFixed(2)}\n---\n# 今日消费记录\n${rs.map((r, i) => `- ${r[3] || '12:00'}｜${r[0]}｜￥${(r[1] / 100).toFixed(2)} (${r[2]})`).join('\n')}\n`));
  }
  return files;
}
const snapshot = (files, p = prefs, day = now, exclusions = [], stars = []) => R.buildReportSnapshot(files, p, day, exclusions, stars);
function coffeeData() {
  return ledgers('2026-08-04', '2026-09-28', d => d < '2026-09-01' ? Number(d.slice(-2)) % 9 === 0 ? [['饮品', 900, '咖啡']] : [] : Number(d.slice(-2)) % 2 === 0 ? [['饮品', 800, '咖啡']] : []);
}
function goodResponse(s) {
  const f = s.findings[0];
  return { title: '消费行为报告', summary: '本期一些购买对象出现在更多日子里。', paragraphs: [{ heading: f.title, text: f.observation, finding_ids: [f.id], evidence_ids: f.evidenceIds }], fact_claims: [] };
}

test('salary report defaults to current cycle, cuts history at equal elapsed days and rolls on the 15th', () => {
  const p = R.defaultReportPreferences(new Date(2026, 9, 3));
  assert.equal(p.mode, 'salary');
  let r = R.reportPeriods(p, new Date(2026, 9, 3));
  assert.deepEqual(r.range, { start: '2026-09-15', end: '2026-10-03' });
  assert.deepEqual(r.previous, { start: '2026-08-15', end: '2026-09-02' });
  r = R.reportPeriods(p, new Date(2026, 9, 15));
  assert.deepEqual(r.range, { start: '2026-10-15', end: '2026-10-15' });
  assert.deepEqual(r.previous, { start: '2026-09-15', end: '2026-09-15' });
  const historical = R.reportPeriods({ ...p, offset: 1 }, new Date(2026, 9, 3));
  assert.deepEqual(historical.range, { start: '2026-08-15', end: '2026-09-14' });
  assert.deepEqual(historical.previous, { start: '2026-07-15', end: '2026-08-14' });
});
test('unequal salary cycle lengths clamp history; custom future ends use equal observed duration', () => {
  const p = R.defaultReportPreferences();
  const r = R.reportPeriods(p, new Date(2026, 2, 14));
  assert.equal(R.reportDays(r.range), 28);
  assert.equal(R.reportDays(r.previous), 28);
  const partial = R.reportPeriods({ ...prefs, customRange: { start: '2026-09-01', end: '2026-09-30' } }, new Date(2026, 8, 10));
  assert.equal(R.reportDays(partial.range), 10);
  assert.equal(R.reportDays(partial.previous), 10);
});
test('local objects unify aliases, distinguish brands and retain mixed amounts intact', () => {
  assert.equal(R.identifyReportObjects('午饭')[0].key, R.identifyReportObjects('午餐·面')[0].key);
  assert.equal(R.identifyReportObjects('瑞幸')[0].kind, 'brand');
  assert.ok(!R.identifyReportObjects('瑞幸').some(o => o.key === 'object:咖啡'));
  assert.deepEqual(R.identifyReportObjects('超市购物：牙膏+水果').map(o => o.kind), ['mixed']);
  assert.equal(R.identifyReportObjects('  特殊 服务  ')[0].label, '特殊 服务');
});
test('extra water records do not imply more meals; object analysis detects cross-category classification', () => {
  const files = ledgers('2026-08-04', '2026-09-28', d => [
    ['餐饮', 1200, '午饭'], ...(d >= '2026-09-01' ? [['餐饮', 200, '矿泉水']] : d === '2026-08-29' ? [['饮品', 200, '矿泉水']] : [])
  ]);
  const s = snapshot(files);
  const water = s.findings.find(f => f.subject === 'object:矿泉水');
  assert.ok(water);
  assert.match(water.title, /矿泉水/);
  assert.match(water.observation, /不能把分类变化泛化/);
  assert.match(water.observation, /分类|归类/);
  assert.ok(s.evidence.some(e => e.id.startsWith('classification')));
  assert.ok(!s.findings.some(f => f.subject === 'category:餐饮'));
});
test('average increase with median decrease is attributed to the distribution and large records', () => {
  const files = ledgers('2026-08-04', '2026-09-28', d => [[ '餐饮', d < '2026-09-01' ? 1500 : d === '2026-09-27' ? 40000 : 1200, d === '2026-09-27' ? '聚餐' : '午饭' ]]);
  const s = snapshot(files), f = s.findings.find(f => f.subject === 'category:餐饮');
  assert.match(f.title, /平均金额上升/);
  const e = s.evidence.find(e => f.evidenceIds.includes(e.id));
  assert.ok(e.facts.current_median.value < e.facts.previous_median.value);
  assert.ok(e.facts.top3_contribution.value >= 50);
  assert.match(f.observation, /中位数/);
});
test('stable category count can conceal more repeated coffee days', () => {
  const files = ledgers('2026-08-04', '2026-09-28', d => Number(d.slice(-2)) % 2 === 0 ? [['饮品', 800, d < '2026-09-01' && Number(d.slice(-2)) % 6 !== 0 ? '柠檬茶' : '咖啡']] : []);
  const s = snapshot(files);
  assert.ok(s.findings.some(f => f.subject === 'object:咖啡' && /更多日子/.test(f.title)));
  assert.ok(!s.findings.some(f => f.subject === 'category:饮品' && /记录频率/.test(f.title)));
});
test('missing files are unknown, zero ledgers are valid, diagnostics and undated files block comparison', () => {
  const files = coffeeData();
  assert.equal(snapshot(files).comparable, true);
  const missing = snapshot(files.filter(f => f.date !== '2026-09-02'));
  assert.equal(missing.comparable, false);
  assert.ok(missing.coverage[0].missingDates.includes('2026-09-02'));
  const bad = structuredClone(files); bad[0].diagnostics.push({ kind: 'total', path: bad[0].path, reason: '异常' });
  assert.equal(snapshot(bad).comparable, false);
  assert.equal(snapshot([...files, { path: '未知.md', date: null, records: [], diagnostics: [], frontmatterTotalCents: null }]).comparable, false);
});
test('filters and star exclusion apply symmetrically and duplicate IDs are not double-counted in evidence', () => {
  const files = coffeeData();
  const excluded = snapshot(files, prefs, now, ['饮品']); assert.equal(excluded.findings.length, 0);
  const noMatch = snapshot(files, { ...prefs, keyword: '不存在' }); assert.equal(noMatch.findings.length, 0);
  const only = snapshot(files, { ...prefs, category: '餐饮' }); assert.equal(only.findings.length, 0);
  const stars = files.flatMap(f => f.records).map(r => r.id);
  assert.equal(snapshot(files, { ...prefs, includeStarred: false }, now, [], stars).findings.length, 0);
  const s = snapshot(files); s.evidence.forEach(e => assert.equal(e.recordIds.length, new Set(e.recordIds).size));
});
test('zero baseline is new, stable input produces no invented changes; decomposition conserves amount difference', () => {
  const files = ledgers('2026-08-04', '2026-09-28', d => d >= '2026-09-01' ? [['饮品', 800, '咖啡']] : []);
  const s = snapshot(files); assert.ok(s.findings.some(f => /新增|更多日子/.test(f.title)));
  Object.values(R.symmetricDecomposition(10, 10000, 20, 15000)).reduce((a, b) => a + b, 0);
  const d = R.symmetricDecomposition(10, 10000, 20, 15000); assert.equal(d.frequency + d.ticket, 5000);
  const stable = snapshot(ledgers('2026-08-04', '2026-09-28', () => [['其他', 100, '日常']]));
  assert.ok(!stable.findings.some(f => f.type === 'comparison'));
  const none = snapshot(ledgers('2026-08-04', '2026-09-28'));
  assert.equal(none.findings.length, 0); assert.match(R.localSpendingReport(none).summary, /未发现/);
});
test('repeated purchases and weekend rhythms need verified weeks, while trends locate a week not a date', () => {
  const files = ledgers('2026-05-04', '2026-09-28', d => {
    const day = new Date(`${d}T12:00:00`).getDay();
    const n = d < '2026-08-03' ? 1 : 3;
    return Array.from({ length: n }, () => ['饮品', day === 0 || day === 6 ? 3000 : 500, '咖啡']);
  });
  const s = snapshot(files);
  assert.ok(s.findings.some(f => f.type === 'rhythm'));
  const coffee = s.findings.find(f => f.subject === 'object:咖啡');
  assert.ok(coffee.evidenceIds.some(id => id.startsWith('trend') || id.startsWith('level')));
  assert.match(coffee.observation, /周/);
  const short = snapshot(files.filter(f => f.date >= '2026-08-04'));
  assert.ok(!short.evidence.some(e => /^(trend|level|rhythm):/.test(e.id)));
});
test('matched weekday association ignores shared weekend exposure and detects excess same-day occurrence', () => {
  const start = '2026-05-04', end = '2026-09-28';
  const files = ledgers(start, end, d => {
    const n = R.reportDays({ start, end: d }) - 1;
    return [...(n % 2 === 0 ? [['饮品', 700, '咖啡']] : []), ...(n % 2 === 0 || n % 13 === 0 ? [['零食', 200, '零食']] : [])];
  });
  assert.ok(snapshot(files).findings.some(f => f.type === 'association'));
  const weekend = ledgers(start, end, d => {
    const day = new Date(`${d}T12:00:00`).getDay();
    return day === 0 || day === 6 ? [['饮品', 700, '咖啡'], ['零食', 200, '零食']] : [];
  });
  assert.ok(!snapshot(weekend).findings.some(f => f.type === 'association'));
});

test('one concentrated purchase week is not reported as a sustained trend or recurring pattern', () => {
  const files = ledgers('2026-05-04', '2026-09-28', d => d === '2026-09-24' ? Array.from({ length: 9 }, () => ['购物', 1000, '水果']) : []);
  const s = snapshot(files);
  assert.ok(s.findings.some(f => /新增|更多日子/.test(f.title)));
  assert.ok(!s.evidence.some(e => /^(repeat|trend|level|rhythm):/.test(e.id)));
});

test('stable totals can conceal opposite category changes, without claiming causal money transfer', () => {
  const files = ledgers('2026-08-04', '2026-09-28', d => {
    const current = d >= '2026-09-01';
    return [['购物', current ? 5000 : 1500, '日用品'], ['餐饮', current ? 1500 : 5000, '餐费']];
  });
  const s = snapshot(files), f = s.findings.find(f => f.subject === 'structure');
  assert.ok(f); assert.match(f.observation, /总额稳定/); assert.match(f.observation, /不能据此证明/);
  const e = s.evidence.find(e => f.evidenceIds.includes(e.id));
  assert.equal(e.facts.current_amount.value, e.facts.previous_amount.value);
});

test('an incomplete latest period cannot supply apparent complete weeks to temporal analysis', () => {
  const files = ledgers('2026-05-04', '2026-09-28', d => {
    const day = new Date(`${d}T12:00:00`).getDay();
    return [['饮品', day === 0 || day === 6 ? 3000 : 500, '咖啡']];
  }).filter(f => f.date !== '2026-09-02');
  const s = snapshot(files);
  assert.equal(s.comparable, false);
  assert.ok(!s.evidence.some(e => /^(repeat|trend|level|rhythm|association):/.test(e.id)));
});
test('fingerprints change on new day, backfill, note edit and rename but do not persist source notes', () => {
  const files = coffeeData(), s = snapshot(files), changed = structuredClone(files);
  changed.find(f => f.records.length).records[0].note = '改写';
  assert.notEqual(snapshot(changed).fingerprint, s.fingerprint);
  changed[0].path = '归档/新名字.md'; assert.notEqual(snapshot(changed).fingerprint, s.fingerprint);
  const salary = R.defaultReportPreferences(now);
  assert.notEqual(snapshot(files, salary, now).fingerprint, snapshot(files, salary, new Date(2026, 9, 1)).fingerprint);
  assert.notEqual(snapshot(files.filter(f => f.date !== '2026-09-02')).fingerprint, s.fingerprint);
});
test('AI input is bounded per finding, omits paths/raw rows and marks samples untrusted', () => {
  const s = snapshot(coffeeData()), input = JSON.parse(AI.reportAiInput(s));
  assert.ok(input.samples.every(g => g.untrusted_transaction_samples.length <= 5));
  assert.ok(!JSON.stringify(input).includes('账本/'));
  assert.ok(!JSON.stringify(input).includes('ledger-v2:'));
  assert.ok(!('records' in input));
  assert.equal(input.recorded_totals.current.recorded_amount_cents, 11200);
  assert.equal(input.recorded_totals.current.recorded_count, 14);
  assert.equal(input.recorded_totals.current.consumption_days, 14);
  assert.equal(input.recorded_totals.previous.recorded_amount_cents, 2700);
  assert.equal(input.recorded_totals.previous.recorded_count, 3);
});
test('AI content is retained despite unknown discovery IDs, evidence IDs, numeric claims and dates', () => {
  const s = snapshot(coffeeData()), response = goodResponse(s);
  response.paragraphs[0].finding_ids = ['invented']; response.paragraphs[0].evidence_ids = ['invented-evidence'];
  response.paragraphs[0].text += ' 已经花费99999块，在2027-01-01发生变化。';
  response.fact_claims = [{ metric_id: 'unknown', value: 99999 }];
  const report = AI.parseSpendingReport(JSON.stringify(response), s);
  assert.match(report.paragraphs[0].text, /99999块/);
  assert.deepEqual(report.paragraphs[0].findingIds, ['invented']);
  assert.deepEqual(report.paragraphs[0].evidenceIds, ['invented-evidence']);
  assert.equal(report.verificationWarnings, undefined);
});
test('cache cap, configuration changes and malformed old settings are handled safely', () => {
  const s = snapshot(coffeeData()), config = { endpoint: 'https://example.test/v1', model: 'mock', apiKey: '' };
  let caches = [];
  for (let i = 0; i < 8; i++) caches = AI.appendReportCache(caches, { fingerprint: `f${i}`, configuration: 'x', generatedAt: new Date().toISOString(), report: { title: '报告', summary: '摘要', paragraphs: [] } });
  assert.equal(caches.length, 6);
  const cache = { fingerprint: s.fingerprint, configuration: AI.reportConfiguration(config), generatedAt: new Date().toISOString(), report: AI.parseSpendingReport(JSON.stringify(goodResponse(s)), s) };
  assert.ok(AI.findReportCache([cache], s, config));
  assert.equal(AI.findReportCache([cache], s, { ...config, model: 'changed' }), undefined);
  assert.deepEqual(AI.normalizeReportCaches([null, {}, { report: {} }]), []);
  assert.equal(R.normalizeReportPreferences({ mode: 'invalid', offset: -1 }).mode, 'salary');
});

test('selected historical salary/month periods stay fixed when the current cycle changes', () => {
  const salary = { ...R.defaultReportPreferences(new Date(2026, 9, 3)), offset: 1, anchorDate: '2026-08-15' };
  assert.deepEqual(R.reportPeriods(salary, new Date(2026, 9, 3)).range, { start: '2026-08-15', end: '2026-09-14' });
  assert.deepEqual(R.reportPeriods(salary, new Date(2026, 9, 15)).range, R.reportPeriods(salary, new Date(2026, 9, 3)).range);
  const month = { ...salary, mode: 'month', anchorDate: '2026-09-01' };
  assert.deepEqual(R.reportPeriods(month, new Date(2026, 10, 1)).range, { start: '2026-09-01', end: '2026-09-30' });
  assert.equal(R.normalizeReportPreferences({ ...salary, mode: 'custom', customRange: { start: '2027-01-01', end: '2027-01-31' } }, new Date(2026, 9, 3)).customRange.start, '2026-10-03');
});

test('all currency wording, rounding and derived percentages render without numeric checks', () => {
  const s = snapshot(coffeeData()), response = goodResponse(s);
  response.paragraphs[0].text = '5元，5块，五块，约5.2元，第3个发现，推导增幅9876%，一万元，百分之三十。';
  delete response.fact_claims;
  const report = AI.parseSpendingReport(JSON.stringify(response), s);
  assert.equal(report.paragraphs[0].text, response.paragraphs[0].text);
  assert.equal(report.verificationWarnings, undefined);
});

test('plain text, incomplete JSON, nonstandard structures and long reports never block display', () => {
  const s = snapshot(coffeeData());
  for(const body of ['# 消费分析\n\n小额重复购买值得关注。', '{"title":"尚未完整的JSON', '{"unexpected":"保留原响应"}', '{"title":"标题","unexpected":"保留返回正文"}', 'null', '42', JSON.stringify('普通正文')]) {
    const report = AI.parseSpendingReport(body, s);
    assert.ok(report.paragraphs.length && report.paragraphs[0].text);
  }
  const text = '完整保留长正文。'.repeat(400);
  const report = AI.parseSpendingReport(JSON.stringify({ title:'标题'.repeat(80), summary:'摘要'.repeat(400), paragraphs:Array.from({length:12},()=>({text})) }), s);
  assert.equal(report.paragraphs.length, 12); assert.equal(report.paragraphs[0].text, text);
  const alias = AI.parseSpendingReport(JSON.stringify({sections:[{title:'标题',content:'非标准结构正文'}]}), s);
  assert.equal(alias.paragraphs[0].text, '非标准结构正文');
});

test('missing or unknown AI bindings retain prose and expose independently computed local evidence', () => {
  const s = snapshot(coffeeData()); const report = AI.parseSpendingReport('普通正文，无任何引用ID。', s);
  const root = new Element(); let ids;
  renderReportArticle(root, report, s, value => { ids = value; });
  assert.ok(root.all().some(e => e.textContent === '普通正文，无任何引用ID。'));
  assert.ok(root.all().some(e => e.textContent === '查看本地分析与证据'));
  assert.ok(!root.all().some(e => e.textContent === '正文数值核对提示'));
  root.all().find(e => e.tag === 'button').listeners.click();
  assert.deepEqual(ids, s.findings[0].evidenceIds);
  const config = { endpoint:'https://example.test/v1', model:'mock', apiKey:'' };
  const cache = {fingerprint:s.fingerprint, configuration:AI.reportConfiguration(config), generatedAt:new Date().toISOString(),report:AI.parseSpendingReport(JSON.stringify({paragraphs:[{text:'未知ID也保留',finding_ids:['unknown'],evidence_ids:['unknown']}]}),s)};
  assert.ok(AI.findReportCache(AI.normalizeReportCaches([cache]), s, config));
});

test('manual AI request shares transport gate, preserves timeout lock and permits no local findings', async () => {
  const s = snapshot(coffeeData()), config = { endpoint: 'https://example.test/v1', model: 'mock', apiKey: '' };
  global.__ledgerTestRequest = () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(goodResponse(s)) } }] } });
  try { assert.ok((await AI.requestSpendingReport(config, s, undefined, new RequestGate())).paragraphs.length); assert.ok((await AI.requestSpendingReport(config, { ...s, findings: [], evidence: [] }, undefined, new RequestGate())).paragraphs.length); }
  finally { delete global.__ledgerTestRequest; }
  const gate = new RequestGate(); let release;
  const p = gate.run(() => new Promise(resolve => { release = resolve; }), undefined, 10);
  await assert.rejects(p, /时限/); assert.equal(gate.busy, true);
  await assert.rejects(gate.run(() => Promise.resolve()), /上次请求/);
  release(); await new Promise(resolve => setImmediate(resolve)); assert.equal(gate.busy, false);
});

class Element {
  constructor(tag = 'div', o = {}) { this.tag = tag; this.textContent = o.text ?? ''; this.children = []; this.listeners = {}; this.classes = new Set((o.cls ?? '').split(' ')); this.attributes = {}; this.classList = { add: (...n) => n.forEach(v => this.classes.add(v)) }; }
  createEl(tag, o = {}) { const e = new Element(tag, o); this.children.push(e); return e; }
  createDiv(o) { return this.createEl('div', o); } createSpan(o) { return this.createEl('span', o); }
  addClass(c) { this.classes.add(c); } setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(k, f) { this.listeners[k] = f; } empty() { this.children = []; }
  all() { return [this, ...this.children.flatMap(e => e.all())]; }
}
test('article keeps narrative readable, evidence buttons use known IDs and text is inserted literally', () => {
  const s = snapshot(coffeeData()), report = R.localSpendingReport(s), root = new Element(); let clicked;
  report.paragraphs[0].text += '<script>not executable</script>';
  renderReportArticle(root, report, s, ids => { clicked = ids; });
  const buttons = root.all().filter(e => e.tag === 'button'); assert.equal(buttons.length, report.paragraphs.length);
  buttons[0].listeners.click(); assert.deepEqual(clicked, report.paragraphs[0].evidenceIds);
  assert.ok(root.all().some(e => e.textContent.includes('<script>')));
});
test('panel opens with local report and no request; cancelled or changed data cannot cache late AI response', async () => {
  const files = coffeeData(), config = { financeAiEndpoint: 'https://example.test/v1', financeAiModel: 'mock', financeAiApiKey: '', financeAiEnabled: true };
  const plugin = { settings: { ...config, reportPreferences: prefs, reportCaches: [], excludedCategories: [], starredRecordIds: [] }, repository: { files: new Map(files.map(f => [f.path, f])) }, app: { vault: { getName: () => 'report-test' }, workspace: {} }, saveSettings: async () => {} };
  const panel = new ReportPanel(plugin, () => {}, async () => {}); panel.snapshot = () => snapshot([...plugin.repository.files.values()]);
  const root = new Element(); panel.render(root);
  assert.equal(panel.loading, false); assert.ok(root.all().some(e => e.textContent === '生成报告'));
  let resolve; global.__ledgerTestRequest = () => new Promise(r => { resolve = r; });
  const before = panel.snapshot(); const task = panel.generate(before);
  await new Promise(r => setImmediate(r)); panel.cancel();
  resolve({ status: 200, json: { choices: [{ message: { content: JSON.stringify(goodResponse(before)) } }] } });
  await task; assert.equal(plugin.settings.reportCaches.length, 0);
  await new Promise(r => setImmediate(r));
  const task2 = panel.generate(before); await new Promise(r => setImmediate(r));
  plugin.repository.files.delete(files[0].path);
  resolve({ status: 200, json: { choices: [{ message: { content: JSON.stringify(goodResponse(before)) } }] } });
  await task2; assert.equal(plugin.settings.reportCaches.length, 0);
  panel.dispose(); delete global.__ledgerTestRequest;
});
test('evidence modal exposes facts, deduplicates records and opens source through callback', () => {
  const s = snapshot(coffeeData()); const modal = Object.create(ReportEvidenceModal.prototype);
  modal.snapshot = s; modal.evidenceIds = s.findings[0].evidenceIds; modal.contentEl = new Element(); modal.setTitle = t => { modal.title = t; };
  let opened; modal.openRecord = async r => { opened = r; }; modal.close = () => {};
  modal.onOpen(); assert.equal(modal.title, '报告证据');
  const button = modal.contentEl.all().find(e => e.classes.has('ledger-report-record')); button.listeners.click();
  assert.ok(opened && opened.path); assert.ok(modal.contentEl.all().some(e => e.tag === 'dl'));
});
