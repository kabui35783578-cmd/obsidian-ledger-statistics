const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../dist/assets.cjs');
const q = require('../dist/asset-quotes.cjs');
const core = require('../dist/core.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const at = hour => new Date(2026, 9, 8, hour, 0);
function account(id, kind = 'cash', cents = 100000) {
  return { id, name: id, kind, balanceCents: cents, baselineAt: at(9).toISOString(), includedEventIds: [], includedRecordIds: [] };
}
function fixture() {
  const state = a.emptyAssets();
  state.accounts = [account('cash'), account('other', 'cash', 0), account('funds', 'investment', 0), account('loan', 'liability', 50000)];
  state.holdings = [{ id: 'h', accountId: 'funds', name: '基金', kind: 'fund', code: '000001', quantity: '100', costCents: 10000, acquiredOn: '2026-10-07' }];
  state.quotes['fund:000001'] = { key: 'fund:000001', name: '基金', price: '1', asOf: '2026-10-07', fetchedAt: at(10).toISOString() };
  a.setDefaultCash(state, 'cash', [], at(9)); return state;
}
function records(lines, path = '记账/2026-10-08.md', date = '2026-10-08') {
  return core.parseLedgerFile(path, `---\ndate: ${date}\ntotal: 0\n---\n# 今日消费记录\n${lines}`).records;
}
const balances = (s, rs = [], now = at(18)) => Object.fromEntries(a.buildAssetSnapshot(s, rs, now).accounts.map(a => [a.id, a.cents]));
let eventIndex = 0;
function event(kind, extra = {}) { return { id: `e${++eventIndex}`, kind, date: '2026-10-08', createdAt: at(11).toISOString(), accountId: 'funds', cashAccountId: 'cash', holdingId: 'h', amountCents: 10000, feeCents: 0, note: '', ...extra }; }

test('decimal arithmetic computes cents and amount-to-quantity without floating drift', () => {
  assert.equal(a.moneyCents('0.29'), 29);
  assert.equal(a.valueCents('1000.12', '1.2345'), 123465);
  assert.equal(a.quantityFromAmount(100100, 100, '1.25', 'fund'), '800');
  assert.equal(a.quantityFromAmount(99999, 0, '3.053', 'etf'), '327');
  assert.throws(() => a.validateQuantity('12.5', 'stock'), /整数/);
  assert.throws(() => a.moneyCents('1.001'), /两位/);
  assert.throws(() => a.quantityFromAmount(100, 100, '1', 'fund'));
  assert.throws(() => a.valueCents('99999999999999', '999999'));
});
test('initial holdings do not debit cash; unknown valuations never masquerade as zero-priced holdings', () => {
  const state = fixture(); assert.equal(balances(state).cash, 100000);
  delete state.quotes['fund:000001']; const snap = a.buildAssetSnapshot(state, [], at(18));
  assert.equal(snap.accounts.find(a => a.id === 'funds').holdings[0].valueCents, null);
  assert.equal(a.assetTotals(snap).missing, true);
});
test('confirmed purchases, partial sales and transaction fees update cash and remaining cost', () => {
  const state = fixture();
  a.addAssetEvent(state, event('buy', { amountCents: 10100, feeCents: 100, quantity: '100', price: '1' }));
  assert.equal(state.holdings[0].quantity, '200'); assert.equal(state.holdings[0].costCents, 20100);
  assert.equal(balances(state).cash, 89900);
  a.addAssetEvent(state, event('sell', { amountCents: 4900, feeCents: 100, quantity: '50', price: '1' }));
  assert.equal(state.holdings[0].quantity, '150'); assert.equal(state.holdings[0].costCents, 15075);
  assert.equal(balances(state).cash, 94800);
  assert.throws(() => a.addAssetEvent(state, event('sell', { quantity: '151' })), /超过/);
  assert.throws(() => a.addAssetEvent(state, event('buy', { quantity: '100', amountCents: 0 })), /成交金额/);
});
test('transfers preserve net wealth except fees; income and repayments affect correct accounts', () => {
  const state = fixture(), before = a.assetTotals(a.buildAssetSnapshot(state, [], at(18))).netCents;
  a.addAssetEvent(state, event('transfer', { accountId: 'cash', cashAccountId: 'other', amountCents: 20000, feeCents: 100 }));
  assert.equal(balances(state).cash, 79900); assert.equal(balances(state).other, 20000);
  assert.equal(a.assetTotals(a.buildAssetSnapshot(state, [], at(18))).netCents, before - 100);
  a.addAssetEvent(state, event('income', { accountId: 'cash', cashAccountId: undefined, amountCents: 5000 }));
  a.addAssetEvent(state, event('repay', { accountId: 'loan', amountCents: 10000 }));
  assert.equal(balances(state).loan, 40000); assert.equal(balances(state).cash, 74900);
  assert.throws(() => a.addAssetEvent(state, event('repay', { accountId: 'loan', amountCents: 40001 })), /尚欠/);
});
test('cash dividends, reinvestment and split adjustments do not invent cash movements', () => {
  const state = fixture();
  a.addAssetEvent(state, event('dividend', { amountCents: 500 }));
  a.addAssetEvent(state, event('reinvest', { amountCents: 0, quantity: '5' }));
  a.addAssetEvent(state, event('quantity', { amountCents: 0, quantity: '210' }));
  assert.equal(balances(state).cash, 100500); assert.equal(state.holdings[0].quantity, '210');
  assert.equal(state.holdings[0].costCents, 10000);
});
test('consumption is recomputed rather than accumulated, including edits, deletion and duplicate entries', () => {
  const state = fixture(), rs = records('- 10:00 | 餐饮 | Y10.00 (早餐)\n- 11:00 | 债务/还款 | Y20.00 (还款)');
  assert.equal(balances(state, rs).cash, 97000); assert.equal(balances(state, rs).cash, 97000);
  const edited = records('- 10:00 | 餐饮 | Y15.00 (早餐)\n- 11:00 | 债务/还款 | Y20.00 (还款)');
  assert.equal(balances(state, edited).cash, 96500); assert.equal(balances(state, []).cash, 100000);
  const duplicate = records('- 10:00 | 餐饮 | Y10.00 (早餐)\n- 10:00 | 餐饮 | Y10.00 (早餐)');
  assert.equal(balances(state, duplicate).cash, 98000);
  assert.deepEqual(balances(a.normalizeAssets(clone(state)), rs), balances(state, rs));
});
test('baseline excludes existing expenses, past backfills and ambiguous same-minute records until reviewed', () => {
  const state = fixture(), existing = records('- 09:00 | 餐饮 | Y10.00 (已包含)');
  a.calibrateAccount(state, 'cash', 95000, existing, at(9));
  const later = records('- 09:00 | 餐饮 | Y10.00 (已包含)\n- 09:00 | 餐饮 | Y5.00 (新补)\n- 10:00 | 餐饮 | Y20.00 (午饭)\n- 补记 | 餐饮 | Y3.00 (未知)');
  const old = records('- 补记 | 餐饮 | Y30.00 (旧账)', '记账/2026-10-07.md', '2026-10-07');
  assert.equal(balances(state, [...later, ...old]).cash, 93000);
  assert.equal(a.buildAssetSnapshot(state, [...later, ...old], at(18)).pending.length, 2);
  state.recordAssignments[later[1].id] = 'cash'; state.recordAssignments[later[3].id] = 'exclude';
  assert.equal(balances(state, [...later, ...old]).cash, 92500);
  assert.equal(a.buildAssetSnapshot(state, [...later, ...old], at(18)).pending.length, 0);
});
test('switching default cash preserves historical attribution and uses a new epoch', () => {
  const state = fixture(), before = records('- 10:00 | 餐饮 | Y10.00');
  a.setDefaultCash(state, 'other', before, at(12));
  const after = records('- 10:00 | 餐饮 | Y10.00\n- 13:00 | 餐饮 | Y20.00');
  assert.deepEqual(balances(state, after), { cash: 99000, other: -2000, funds: 10000, loan: 50000 });
  assert.equal(a.assetTotals(a.buildAssetSnapshot(state, after, at(18))).assetsCents, 107000);
});
test('same-minute switching never silently chooses an account', () => {
  const state = fixture(); a.setDefaultCash(state, 'other', [], at(12));
  const rs = records('- 12:00 | 餐饮 | Y10.00');
  assert.ok(a.buildAssetSnapshot(state, rs, at(18)).pending.length > 0);
  assert.equal(balances(state, rs).cash, 100000); assert.equal(balances(state, rs).other, 0);
});
test('linked purchase or repayment does not debit both the ledger and the asset event', () => {
  const state = fixture(), rs = records('- 10:00 | 债务/还款 | Y10.00 (还款)');
  a.addAssetEvent(state, event('repay', { accountId: 'loan', amountCents: 1000, link: a.linkRecord(rs[0]) }));
  assert.equal(balances(state, rs).cash, 99000); assert.equal(balances(state, rs).loan, 49000);
  const changed = records('- 10:00 | 债务/还款 | Y15.00 (还款)');
  assert.equal(balances(state, changed).cash, 99000);
  assert.equal(a.buildAssetSnapshot(state, changed, at(18)).pending.length, 1);
  assert.throws(() => a.addAssetEvent(state, event('repay', { accountId: 'loan', link: a.linkRecord(rs[0]) })), /已关联/);
});
test('duplicate counts and file/folder rename retain links while new duplicate expenses still debit', () => {
  const state = fixture(), rs = records('- 10:00 | 餐饮 | Y10.00 (一样)');
  a.addAssetEvent(state, event('buy', { amountCents: 1000, quantity: '10', link: a.linkRecord(rs[0]) }));
  const dup = records('- 10:00 | 餐饮 | Y10.00 (一样)\n- 10:00 | 餐饮 | Y10.00 (一样)');
  assert.equal(balances(state, dup).cash, 98000);
  a.renameAssetLinks(state, '记账', '账目');
  const moved = records('- 10:00 | 餐饮 | Y10.00 (一样)\n- 10:00 | 餐饮 | Y10.00 (一样)', '账目/2026-10-08.md');
  assert.equal(balances(state, moved).cash, 98000); assert.equal(a.buildAssetSnapshot(state, moved, at(18)).pending.length, 0);
});
test('recalibration absorbs already recorded events and expenses once, new spending continues after restart', () => {
  const state = fixture(), rs = records('- 10:00 | 餐饮 | Y10.00');
  a.addAssetEvent(state, event('income', { accountId: 'cash', amountCents: 2000 }));
  a.calibrateAccount(state, 'cash', 105000, rs, at(12));
  const after = records('- 10:00 | 餐饮 | Y10.00\n- 13:00 | 餐饮 | Y5.00');
  assert.equal(balances(state, after).cash, 104500);
  assert.equal(balances(a.normalizeAssets(clone(state)), after).cash, 104500);
});
test('daily snapshots are immutable, month comparison uses actual saved dates and excludes fixed assets consistently', () => {
  const state = fixture(); state.accounts.push(account('house', 'fixed', 10000000));
  const old = a.buildAssetSnapshot(state, [], new Date(2026, 8, 25, 18));
  a.storeAssetSnapshot(state, old); const preserved = clone(state.snapshots[0]);
  state.holdings[0].quantity = '500'; const today = a.buildAssetSnapshot(state, [], at(18)); a.storeAssetSnapshot(state, today);
  assert.deepEqual(state.snapshots[0], preserved);
  assert.equal(a.previousMonthSnapshot(state, today.date).date, '2026-09-25');
  assert.equal(a.assetTotals(old).assetsCents - a.assetTotals(old, true).assetsCents, 10000000);
  assert.equal(a.assetTotals(today).assetsCents - a.assetTotals(today, true).assetsCents, 10000000);
  assert.equal(a.storeAssetSnapshot(state, a.buildAssetSnapshot(state, [], at(19))), false);
  assert.equal(a.previousMonthSnapshot(state, '2026-12-01'), undefined);
});
test('fund parser reads literal JSON only, preserves provider day and refuses money-market funds', () => {
  const body = name => `var fS_name="${name}"; var fS_code="000001"; var Data_netWorthTrend=[{"x":1790697600000,"y":1.222}];`;
  const quote = q.parseFundQuote('000001', body('普通基金'), at(18));
  assert.equal(quote.price, '1.222'); assert.equal(quote.asOf, '2026-09-30');
  assert.throws(() => q.parseFundQuote('000001', body('货币基金'), at(18)), /货币基金/);
  assert.throws(() => q.parseFundQuote('000002', body('普通基金'), at(18)), /代码/);
  assert.throws(() => q.parseFundQuote('000001', 'var Data_netWorthTrend=(()=>{throw 1})();', at(18)));
});
function stockText(code, price = '9.70', time = '20261008150000') {
  const fields = new Array(35).fill(''); fields[1] = '测试股票'; fields[2] = code.slice(2); fields[3] = price; fields[30] = time;
  return `v_${code}="${fields.join('~')}";`;
}
test('A-share and ETF quote parser requires matching codes, positive price and actual valid time', () => {
  assert.equal(q.parseStockQuote({ code: 'sh600000', kind: 'stock' }, stockText('sh600000'), at(18)).asOf, '2026-10-08T15:00:00+08:00');
  assert.equal(q.parseStockQuote({ code: 'sz159915', kind: 'etf' }, stockText('sz159915', '3.053'), at(18)).price, '3.053');
  assert.throws(() => q.parseStockQuote({ code: 'sh600000', kind: 'stock' }, stockText('sh600000', '0'), at(18)));
  assert.throws(() => q.parseStockQuote({ code: 'sh600000', kind: 'stock' }, stockText('sh600000', '1', '20260230150000'), at(18)));
});
test('quote caching and failed retries honor market-specific intervals', () => {
  const state = fixture(), h = state.holdings[0], quote = state.quotes['fund:000001'];
  assert.equal(q.quoteDue(h, quote, at(15)), false); assert.equal(q.quoteDue(h, quote, at(16)), true);
  quote.error = '断网'; quote.attemptedAt = at(16).toISOString();
  assert.equal(q.quoteDue(h, quote, new Date(at(16).getTime() + 14 * 60000), true), false);
  assert.equal(q.quoteDue(h, quote, new Date(at(16).getTime() + 15 * 60000)), true);
});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
test('monitor deduplicates symbols, limits concurrency to two and discards results after stop', async () => {
  const state = fixture(); state.holdings = ['sh600000', 'sz000001', 'sh510300', 'sh600000'].map((code, i) => ({ ...state.holdings[0], id: `h${i}`, kind: 'stock', code }));
  state.quotes = {}; const calls = [], committed = [];
  const monitor = new q.AssetQuoteMonitor(() => state, url => { const d = deferred(); calls.push({ ...d, url }); return d.promise; }, async updates => committed.push(...updates), () => at(18));
  const run = monitor.refresh(); await Promise.resolve(); assert.equal(calls.length, 2); assert.equal(monitor.refresh(), run);
  calls[0].resolve({ text: stockText('sh600000') }); await new Promise(r => setImmediate(r)); assert.equal(calls.length, 3);
  monitor.stop(); calls[1].resolve({ text: stockText('sz000001') }); calls[2].resolve({ text: stockText('sh510300') }); await run;
  assert.equal(committed.length, 0);
});
test('partial failures preserve last price; newer successful prices commit independently', async () => {
  const state = fixture(); state.holdings.push({ ...state.holdings[0], id: 's', kind: 'stock', code: 'sh600000' });
  const monitor = new q.AssetQuoteMonitor(() => state, async url => {
    if (url.includes('eastmoney')) throw new Error('断网'); return { text: stockText('sh600000', '10') };
  }, async updates => { for (const quote of updates) state.quotes[quote.key] = quote; }, () => at(18));
  await monitor.refresh(true); assert.equal(state.quotes['fund:000001'].price, '1'); assert.equal(state.quotes['fund:000001'].error, '断网');
  assert.equal(state.quotes['stock:sh600000'].price, '10'); monitor.stop();
});
test('negative cash and negative net assets are retained in numeric totals', () => {
  const state = fixture(); state.accounts[0].balanceCents = -10000;
  const totals = a.assetTotals(a.buildAssetSnapshot(state, [], at(18)));
  assert.equal(totals.assetsCents, 0); assert.equal(totals.netCents, -50000);
});
test('older settings migrate to an empty asset state and malformed saved entries are rejected', () => {
  assert.deepEqual(a.normalizeAssets(undefined), a.emptyAssets());
  const state = fixture(); state.accounts.push({ ...account('bad'), balanceCents: NaN });
  state.holdings.push({ ...state.holdings[0], code: 'url://invalid' });
  const normalized = a.normalizeAssets(state); assert.equal(normalized.accounts.length, 4); assert.equal(normalized.holdings.length, 1);
});

test('initial failed quotes retain retry metadata but never invent a market date', async () => {
  const state = fixture(); state.quotes = {};
  const monitor = new q.AssetQuoteMonitor(() => state, async () => { throw new Error('离线'); }, async updates => updates.forEach(quote => state.quotes[quote.key] = quote), () => at(18));
  await monitor.refresh(); monitor.stop();
  const quote = state.quotes['fund:000001'];
  assert.equal(quote.asOf, ''); assert.equal(quote.price, '0');
  const restored = a.normalizeAssets(clone(state));
  assert.equal(restored.quotes[quote.key].error, '离线');
  assert.equal(q.quoteDue(restored.holdings[0], restored.quotes[quote.key], at(18)), false);
  assert.equal(a.buildAssetSnapshot(restored, [], at(18)).accounts.find(a => a.id === 'funds').holdings[0].valueCents, null);
});

test('timed-out native transports keep their slots and late results cannot overwrite the timeout', async () => {
  const state = fixture(); state.quotes = {};
  state.holdings = ['sh600000', 'sz000001', 'sh510300'].map((code, i) => ({ ...state.holdings[0], id: `h${i}`, kind: 'stock', code }));
  const calls = [], commits = [];
  const monitor = new q.AssetQuoteMonitor(() => state, () => { const d = deferred(); calls.push(d); return d.promise; }, async updates => { commits.push(...updates); updates.forEach(quote => state.quotes[quote.key] = quote); }, () => at(18), 5);
  await monitor.refresh(); assert.equal(calls.length, 2); assert.equal(commits.length, 2);
  await monitor.refresh(true); assert.equal(calls.length, 2, 'native transport remains bounded after UI timeout');
  calls[0].resolve({ text: stockText('sh600000', '99') }); calls[1].resolve({ text: stockText('sz000001') });
  await new Promise(r => setImmediate(r));
  assert.equal(state.quotes['stock:sh600000'].price, '0');
  const next = monitor.refresh(); await Promise.resolve(); assert.equal(calls.length, 3);
  calls[2].resolve({ text: stockText('sh510300') }); await next; monitor.stop();
  assert.equal(state.quotes['stock:sh510300'].price, '9.7');
});

test('edited manually attributed spending requires review and is never charged to a different account', () => {
  const state = fixture(), original = records('- 10:00 | 餐饮 | Y10.00 (早餐)');
  state.recordAssignments[original[0].id] = 'other';
  assert.equal(balances(state, original).other, -1000);
  const changed = records('- 10:00 | 餐饮 | Y15.00 (早餐)');
  const snapshot = a.buildAssetSnapshot(state, changed, at(18));
  assert.equal(snapshot.pending.length, 1); assert.equal(balances(state, changed).cash, 100000);
  assert.equal(balances(state, []).other, 0);
});

test('repayment charges principal and fees, while only principal reduces debt', () => {
  const state = fixture();
  a.addAssetEvent(state, event('repay', { accountId: 'loan', amountCents: 10000, feeCents: 100 }));
  assert.equal(balances(state).cash, 89900); assert.equal(balances(state).loan, 40000);
});

test('asset changes serialize, roll back failed persistence and preserve the next successful operation', async () => {
  const Plugin = require('../dist/main.cjs').default;
  const plugin = Object.create(Plugin.prototype), blocked = deferred(); let saves = 0, redraws = 0;
  plugin.settings = { assets: fixture() }; plugin.repository = { files: new Map() }; plugin.assetQueue = Promise.resolve(); plugin.assetsStopped = false;
  plugin.saveSettings = async () => { if (++saves === 1) { await blocked.promise; throw new Error('磁盘错误'); } };
  plugin.refreshViews = () => redraws++;
  const first = plugin.updateAssets(s => s.accounts[0].name = '不能保存');
  const second = plugin.updateAssets(s => { assert.equal(s.accounts[0].name, 'cash'); s.accounts[0].name = '已保存'; });
  const failure = assert.rejects(first, /磁盘错误/); blocked.resolve(); await failure; await second;
  assert.equal(plugin.settings.assets.accounts[0].name, '已保存'); assert.equal(saves, 2); assert.equal(redraws, 1);
});

test('investment amounts display immediately and allocation to holdings never counts the same money twice', () => {
  const state = fixture(); state.holdings = []; state.accounts.find(a => a.id === 'funds').balanceCents = 100000;
  assert.equal(balances(state).funds, 100000);
  a.addEstimatedHolding(state, 'funds', 'fund', '000001', 60000, state.quotes['fund:000001'], at(18));
  assert.equal(balances(state).funds, 100000); assert.equal(state.accounts.find(a => a.id === 'funds').balanceCents, 40000);
  a.addEstimatedHolding(state, 'funds', 'fund', '000001', 50000, state.quotes['fund:000001'], at(18));
  assert.equal(balances(state).funds, 110000); assert.equal(state.accounts.find(a => a.id === 'funds').balanceCents, 0);
  state.quotes['fund:000001'].price = '2'; assert.equal(balances(state).funds, 220000);
});

test('current amounts establish an estimated tracking position with provider name and today date, not a claimed purchase cost', () => {
  const state = fixture(), quote = q.parseStockQuote({ kind: 'stock', code: 'sh600000' }, stockText('sh600000'), at(18));
  const h = a.addEstimatedHolding(state, 'funds', 'stock', '600000', 99999, quote, at(18));
  assert.equal(h.name, '测试股票'); assert.equal(h.acquiredOn, '2026-10-08'); assert.equal(h.estimated, true); assert.equal(h.costBasisKnown, false);
  assert.equal(a.valueCents(h.quantity, quote.price), 99999); assert.equal(balances(state).cash, 100000);
  assert.ok(!Number.isInteger(Number(h.quantity)), 'estimated exposure is explicitly marked, not passed off as actual fractional shares');
  const before = clone(state);
  assert.throws(() => a.addEstimatedHolding(state, 'funds', 'fund', '000001', 10000, quote), /行情/);
  assert.deepEqual(state, before);
});

test('deleting accounts preserves counterpart cash flows and ledger links across restart while removing current assets', () => {
  const state = fixture(), rs = records('- 10:00 | 餐饮 | Y10.00');
  a.addAssetEvent(state, event('transfer', { accountId: 'cash', cashAccountId: 'other', amountCents: 10000, link: a.linkRecord(rs[0]) }));
  const snapshot = a.buildAssetSnapshot(state, rs, at(11)); a.storeAssetSnapshot(state, snapshot);
  a.removeAssetAccount(state, 'cash', at(12));
  assert.equal(state.defaultCashId, ''); assert.equal(state.epochs[0].to, at(12).toISOString());
  assert.equal(balances(state, rs).other, 10000); assert.equal(balances(state, rs).cash, undefined);
  assert.deepEqual(balances(a.normalizeAssets(clone(state)), rs), balances(state, rs));
  assert.equal(state.snapshots[0].accounts.some(a => a.id === 'cash'), true);
  assert.throws(() => a.addAssetEvent(state, event('income', { accountId: 'cash' })), /删除/);
});

test('deleting holdings removes current valuation but does not reverse confirmed cash transactions or rewrite history', () => {
  const state = fixture(); a.addAssetEvent(state, event('buy', { quantity: '100' }));
  a.storeAssetSnapshot(state, a.buildAssetSnapshot(state, [], at(18))); const history = clone(state.snapshots[0]);
  a.removeAssetHolding(state, 'h'); assert.equal(balances(state).cash, 90000); assert.equal(balances(state).funds, 0);
  assert.deepEqual(state.snapshots[0], history); assert.equal(state.events.length, 1);
});

test('removed investment accounts no longer request automatic quotes', async () => {
  const state = fixture(); a.removeAssetAccount(state, 'funds'); let calls = 0;
  const monitor = new q.AssetQuoteMonitor(() => state, async () => { calls++; throw new Error('should not fetch'); }, async () => {}, () => at(18));
  await monitor.refresh(true); monitor.stop(); assert.equal(calls, 0);
});

test('quick entry quotes share deduplication and two-connection limit with the background monitor', async () => {
  const state = fixture(); state.quotes = {}; const calls = [];
  const monitor = new q.AssetQuoteMonitor(() => state, url => { const d = deferred(); calls.push({ ...d, url }); return d.promise; }, async () => {}, () => at(18));
  const first = monitor.lookup('stock', '600000'), duplicate = monitor.lookup('stock', 'sh600000'), second = monitor.lookup('stock', 'sz000001');
  await assert.rejects(monitor.lookup('etf', 'sh510300'), /正在更新/); await Promise.resolve(); assert.equal(calls.length, 2);
  calls[0].resolve({ text: stockText('sh600000') }); calls[1].resolve({ text: stockText('sz000001') });
  const results = await Promise.all([first, duplicate, second]); assert.equal(results[0].key, results[1].key);
  state.quotes[results[0].key] = results[0]; await monitor.lookup('stock', '600000'); assert.equal(calls.length, 2); monitor.stop();
});

test('quick entry failures expose the error, enforce retry cooldown and reject responses after plugin shutdown', async () => {
  const state = fixture(); state.quotes = {}; let calls = 0;
  const offline = new q.AssetQuoteMonitor(() => state, async () => { calls++; throw new Error('离线'); }, async () => {}, () => at(18));
  await assert.rejects(offline.lookup('fund', '000001'), /离线/); await assert.rejects(offline.lookup('fund', '000001'), /稍后重试/); assert.equal(calls, 1); offline.stop();
  const pending = deferred(), monitor = new q.AssetQuoteMonitor(() => state, () => pending.promise, async () => {}, () => at(18));
  const result = monitor.lookup('stock', 'sh600000'); monitor.stop(); pending.resolve({ text: stockText('sh600000') }); await assert.rejects(result, /关闭/);
});



test('investment cash is included and can be recalibrated without removing holdings', () => {
  const state = fixture(); state.accounts.find(a => a.id === 'funds').balanceCents = 50000;
  assert.equal(balances(state).funds, 60000);
  a.calibrateAccount(state, 'funds', 75000, [], at(12));
  assert.equal(balances(state).funds, 85000);
  assert.equal(state.holdings[0].quantity, '100');
});
test('current amount entries save immediately, survive reload and establish quantity only once', () => {
  let state = fixture();
  const h = a.addAmountHolding(state, 'funds', 'fund', '000002', '1234.56', at(12));
  assert.equal(h.acquiredOn, core.isoFromDate(at(12)));
  assert.equal(h.quantity, '0'); assert.equal(balances(state).funds, 133456);
  state = a.normalizeAssets(clone(state));
  const holding = state.holdings.find(v => v.id === h.id);
  assert.equal(holding.amountBasisCents, 123456);
  assert.equal(q.quoteDue(holding, undefined, at(12)), true);
  a.applyAssetQuote(state, { key: 'fund:000002', name: '测试基金', price: '0', asOf: '', fetchedAt: at(12).toISOString(), attemptedAt: at(12).toISOString(), error: '请求失败' });
  assert.equal(balances(state).funds, 133456); assert.equal(holding.quantity, '0');
  const quote = { key: 'fund:000002', name: '测试基金', price: '1.23456', asOf: '2026-10-08', fetchedAt: at(12).toISOString() };
  a.applyAssetQuote(state, quote);
  assert.equal(holding.name, '测试基金'); assert.equal(holding.quantity, '1000');
  assert.equal(balances(state).funds, 133456);
  a.applyAssetQuote(state, { ...quote, price: '1.5' });
  assert.equal(holding.quantity, '1000'); assert.equal(balances(state).funds, 160000);
  assert.equal(balances(state).cash, 100000);
  assert.throws(() => a.addAmountHolding(state, 'cash', 'fund', '000002', '100'), /投资账户/);
  assert.throws(() => a.addAmountHolding(state, 'funds', 'fund', '000002', '0'), /大于零/);
  assert.throws(() => a.addAssetEvent(state, event('buy', { holdingId: h.id, quantity: '100' })), /核对平台/);
});
test('stock amount estimates retain fractional exposure without rounding away entered value', () => {
  const state = fixture();
  const h = a.addAmountHolding(state, 'funds', 'stock', '600000', '100.01', at(12));
  a.applyAssetQuote(state, { key: 'stock:sh600000', name: '股票', price: '13.17', asOf: '2026-10-08', fetchedAt: at(12).toISOString() });
  assert.equal(a.valueCents(h.quantity, '13.17'), 10001);
  assert.ok(a.decimal(h.quantity).gt(0));
  assert.equal(a.normalizeAssets(clone(state)).holdings.length, 2);
});


test('v2.10.1 pending amount holdings retain value and disclose incomplete quote after upgrade', () => {
  const now = at(18);
  const state = fixture(); state.holdings = [];
  const h = a.addAmountHolding(state, 'funds', 'fund', '000001', '123.45', now);
  delete h.estimated; delete h.costBasisKnown;
  const upgraded = a.normalizeAssets(clone(state));
  assert.equal(upgraded.holdings[0].estimated, true);
  assert.equal(upgraded.holdings[0].costBasisKnown, false);
  assert.equal(a.assetTotals(a.buildAssetSnapshot(upgraded, [], now)).missing, true);
  const q = {key:'fund:000001',name:'基金',price:'1.25',asOf:now.toISOString(),fetchedAt:now.toISOString()};
  a.applyAssetQuote(upgraded,q);
  assert.equal(upgraded.holdings[0].quantity,'98.76');
  assert.equal(a.buildAssetSnapshot(upgraded,[],now).accounts.find(x=>x.id==='funds').holdings[0].valueCents,12345);
});

test('late quotes do not initialize legacy holdings on deleted accounts', () => {
  const now = at(18);
  const state = fixture(); state.holdings = [];
  const h = a.addAmountHolding(state,'funds','fund','000001','100',now);
  a.removeAssetAccount(state,'funds',now);
  a.applyAssetQuote(state,{key:'fund:000001',name:'基金',price:'1',asOf:now.toISOString(),fetchedAt:now.toISOString()});
  assert.equal(h.quantity,'0');
});


test('quick repayments use the current default cash account and persist their original cash leg', () => {
  const state=fixture();
  a.repayAssetLiability(state,'loan',10000,{now:at(12),feeCents:100});
  assert.equal(balances(state).cash,89900);assert.equal(balances(state).loan,40000);
  a.setDefaultCash(state,'other',[],at(13));
  a.repayAssetLiability(state,'loan',5000,{now:at(14)});
  const restored=a.normalizeAssets(clone(state));
  assert.equal(balances(restored).cash,89900);assert.equal(balances(restored).other,-5000);assert.equal(balances(restored).loan,35000);
  assert.throws(()=>a.repayAssetLiability(state,'loan',35001),/尚欠/);
  assert.equal(state.events.length,2);
});

test('quick repayment links a recorded payment once and requires a valid cash account', () => {
  const state=fixture(),rs=records('- 10:00 | 债务/还款 | Y10.00 (还款)');
  a.repayAssetLiability(state,'loan',1000,{now:at(12),link:a.linkRecord(rs[0])});
  assert.equal(balances(state,rs).cash,99000);assert.equal(balances(state,rs).loan,49000);
  assert.throws(()=>a.repayAssetLiability(state,'loan',1000,{link:a.linkRecord(rs[0])}),/已关联/);
  state.defaultCashId='';assert.throws(()=>a.repayAssetLiability(state,'loan',1000),/现金账户/);
  assert.throws(()=>a.repayAssetLiability(state,'loan',0),/大于零/);
});
