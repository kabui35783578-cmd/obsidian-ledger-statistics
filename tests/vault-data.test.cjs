const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../dist/vault-data.cjs');
const Plugin = require('../dist/main.cjs').default;
const assets = require('../dist/assets.cjs');
const salary = require('../dist/salary-history.cjs');
const DEFAULT_SETTINGS = new Plugin().settings;
const copy = value => structuredClone(value);
const defaults = () => V.sharedSettings(copy(DEFAULT_SETTINGS));

class FakeVault {
  constructor() { this.files = new Map(); this.dirs = new Set(); this.writes = 0; this.processes = 0; this.chain = Promise.resolve(); }
  configDir = '.obsidian';
  adapter = {
    exists: async path => this.files.has(path) || this.dirs.has(path),
    read: async path => { if (!this.files.has(path)) throw Error('missing'); return this.files.get(path); },
    write: async (path, text) => { if (this.failMirror && path.endsWith('sync-replica.json')) throw Error('disk'); this.files.set(path, text); },
  };
  getAbstractFileByPath(path) { return this.files.has(path) ? { path } : null; }
  async createFolder(path) { this.dirs.add(path); }
  async read(file) { return this.files.get(file.path); }
  async create(path, text) { if (this.files.has(path)) throw Error('exists'); this.files.set(path, text); this.writes++; return { path }; }
  process(file, fn) {
    const save = this.chain.then(() => {
      if (this.beforeProcess) { const hook = this.beforeProcess; this.beforeProcess = null; hook(); }
      const text = fn(this.files.get(file.path));
      this.files.set(file.path, text); this.writes++; this.processes++; return text;
    });
    this.chain = save.catch(() => {}); return save;
  }
  text() { return this.files.get(V.VAULT_DATA_PATH); }
}
function store(vault, device, clock = () => 200) {
  const notices = [];
  const data = new V.VaultDataStore(vault, `.obsidian/plugins/${device}`, device, defaults(), text => notices.push(text), clock);
  data.notices = notices; return data;
}
function legacy() {
  const d = defaults(); d.salaryCents = 600000; d.trendDateNotes = { '2026-10-01': '聚餐' };
  d.assets.accounts.push({ id: 'cash', name: '现金', kind: 'cash', balanceCents: 12345, baselineAt: '2026-10-01T00:00:00Z', includedEventIds: [], includedRecordIds: [] });
  d.assets.defaultCashId = 'cash';
  return d;
}
async function offlinePair() {
  const va = new FakeVault(), vb = new FakeVault(), a = store(va, 'A', () => 300), b = store(vb, 'B', () => 400);
  await a.initialize(legacy(), true, 100);
  vb.files.set(V.VAULT_DATA_PATH, va.text());
  await b.initialize(defaults(), true, 100);
  return { va, vb, a, b };
}

test('migration round-trips every shared field and keeps device secrets out of the sync file', async () => {
  const vault = new FakeVault(), s = store(vault, 'A'), input = { ...legacy(), financeAiApiKey: 'private-key', financeAiSecretId: 'local-ref', barkUrl: 'private-url' };
  const restored = await s.initialize(V.sharedSettings(input), true, 100);
  assert.deepEqual(restored, V.sharedSettings(input));
  assert.doesNotMatch(vault.text(), /private-key|private-url|local-ref|financeAiApiKey|barkUrl/);
  assert.ok(vault.files.has(s.replicaPath));
  const restarted = store(vault, 'A');
  assert.deepEqual(await restarted.initialize(defaults(), false, 0), restored);
});

test('a fresh second installation keeps the existing synced data instead of seeding defaults over it', async () => {
  const vault = new FakeVault(), a = store(vault, 'A'), b = store(vault, 'B');
  await a.initialize(legacy(), true, 100);
  const writes = vault.writes;
  assert.deepEqual(await b.initialize(defaults(), true, 200), legacy());
  assert.equal(vault.writes, writes);
});

test('unchanged saves and repeated identical receives neither write nor redraw', async () => {
  const vault = new FakeVault(), s = store(vault, 'A');
  await s.initialize(legacy(), true, 100); const writes = vault.writes;
  for (let i = 0; i < 10; i++) { await s.save(s.data, copy(s.data)); assert.equal(await s.receive(), false); }
  assert.equal(vault.writes, writes);
});

test('two stale writers editing different records merge their changes under the file lock', async () => {
  const vault = new FakeVault(), a = store(vault, 'A', () => 300), b = store(vault, 'B', () => 400);
  await a.initialize(legacy(), true, 100); await b.initialize(defaults(), true, 100);
  const beforeB = b.data, nextA = a.data; nextA.trendDateNotes['2026-10-02'] = '交通';
  await a.save(a.data, nextA);
  const nextB = copy(beforeB); nextB.assets.accounts[0].balanceCents = 99999;
  await b.save(beforeB, nextB); await a.receive();
  assert.equal(a.data.assets.accounts[0].balanceCents, 99999);
  assert.equal(a.data.trendDateNotes['2026-10-02'], '交通');
  assert.deepEqual(a.data, b.data);
  assert.equal(b.notices.length, 0);
});

test('offline edits on separate dates survive file replacement and converge without a feedback loop', async () => {
  const { va, vb, a, b } = await offlinePair();
  const aa = a.data; aa.trendDateNotes['2026-10-02'] = 'A修改'; await a.save(a.data, aa);
  const bb = b.data; bb.trendDateNotes['2026-10-03'] = 'B修改'; await b.save(b.data, bb);
  const staleA = va.text(), staleB = vb.text();
  va.files.set(V.VAULT_DATA_PATH, staleB); assert.equal(await a.receive(), true);
  vb.files.set(V.VAULT_DATA_PATH, va.text()); await b.receive();
  assert.deepEqual(a.data.trendDateNotes, { '2026-10-01': '聚餐', '2026-10-02': 'A修改', '2026-10-03': 'B修改' });
  assert.deepEqual(a.data, b.data);
  vb.files.set(V.VAULT_DATA_PATH, staleA); await b.receive();
  assert.deepEqual(a.data, b.data);
  const writes = vb.writes;
  for (let i = 0; i < 5; i++) assert.equal(await b.receive(), false);
  assert.equal(vb.writes, writes);
});

test('deletion tombstones stop old synced notes and removed accounts from reappearing', async () => {
  const vault = new FakeVault(), s = store(vault, 'A'); await s.initialize(legacy(), true, 100);
  const stale = vault.text(), next = s.data; delete next.trendDateNotes['2026-10-01']; next.assets.accounts = [];
  await s.save(s.data, next);
  vault.files.set(V.VAULT_DATA_PATH, stale); await s.receive();
  assert.deepEqual(s.data.trendDateNotes, {}); assert.deepEqual(s.data.assets.accounts, []);
});

test('concurrent changes to the same item keep both documents in a conflict backup and choose deterministically', async () => {
  const { va, vb, a, b } = await offlinePair();
  const aa = a.data; aa.trendDateNotes['2026-10-01'] = '电脑修改'; await a.save(a.data, aa);
  const bb = b.data; bb.trendDateNotes['2026-10-01'] = '手机修改'; await b.save(b.data, bb);
  va.files.set(V.VAULT_DATA_PATH, vb.text()); await a.receive();
  assert.equal(a.data.trendDateNotes['2026-10-01'], '手机修改');
  const backups = [...va.files].filter(([path]) => path.includes('/conflict-'));
  assert.equal(backups.length, 1); assert.match(backups[0][1], /电脑修改/); assert.match(backups[0][1], /手机修改/);
  assert.match(a.notices[0], /同步冲突/);
  await a.receive(); assert.equal(a.notices.length, 1);
});

test('unrelated concurrent account additions retain both accounts without order-only conflict warnings', async () => {
  const { va, vb, a, b } = await offlinePair();
  const aa = a.data; aa.assets.accounts.push({ ...aa.assets.accounts[0], id: 'a' }); await a.save(a.data, aa);
  const bb = b.data; bb.assets.accounts.push({ ...bb.assets.accounts[0], id: 'b' }); await b.save(b.data, bb);
  va.files.set(V.VAULT_DATA_PATH, vb.text()); await a.receive();
  assert.deepEqual(a.data.assets.accounts.map(x => x.id).sort(), ['a', 'b', 'cash']); assert.equal(a.notices.length, 0);
});

test('an incoming write between read and process is still merged rather than erased', async () => {
  const { va, vb, a, b } = await offlinePair();
  const bb = b.data; bb.trendDateNotes['2026-10-03'] = '刚收到'; await b.save(b.data, bb);
  va.beforeProcess = () => va.files.set(V.VAULT_DATA_PATH, vb.text());
  const aa = a.data; aa.trendDateNotes['2026-10-02'] = '正在保存'; await a.save(a.data, aa);
  assert.equal(a.data.trendDateNotes['2026-10-03'], '刚收到'); assert.equal(a.data.trendDateNotes['2026-10-02'], '正在保存');
});

test('invalid JSON, unsupported versions and forbidden credentials never overwrite the last good replica', async () => {
  const vault = new FakeVault(), s = store(vault, 'A'); await s.initialize(legacy(), true, 100);
  const before = copy(s.data), mirror = vault.files.get(s.replicaPath);
  for (const text of ['{broken', JSON.stringify({ format: 'ledger-statistics', version: 2, seen: {}, entries: {} }), JSON.stringify({ format: 'ledger-statistics', version: 1, seen: { x: 1 }, entries: { '["financeAiApiKey"]': { clock: 1, device: 'x', value: 'secret' } } })]) {
    vault.files.set(V.VAULT_DATA_PATH, text); await assert.rejects(s.receive(), /同步/);
    assert.equal(vault.text(), text); assert.equal(vault.files.get(s.replicaPath), mirror); assert.deepEqual(s.data, before);
  }
});

test('a deleted data file blocks writes and is restored only by the explicit recovery action', async () => {
  const vault = new FakeVault(), s = store(vault, 'A'); await s.initialize(legacy(), true, 100);
  vault.files.delete(V.VAULT_DATA_PATH);
  const changed = s.data; changed.salaryCents++;
  await assert.rejects(s.save(s.data, changed), /删除/); assert.equal(vault.text(), undefined);
  await s.receive(); await s.restoreData(); assert.ok(vault.text()); assert.equal(s.data.salaryCents, 600000);
  await assert.rejects(s.restoreData(), /仍存在/);
});

test('a restarted migrated device retains its replica when the sync file is missing', async () => {
  const vault = new FakeVault(), first = store(vault, 'A'); await first.initialize(legacy(), true, 100);
  vault.files.delete(V.VAULT_DATA_PATH);
  const next = store(vault, 'A'); assert.deepEqual(await next.initialize(defaults(), false, 0), legacy());
  assert.equal(vault.text(), undefined); await assert.rejects(next.save(next.data, next.data), /不可写/);
});

test('startup reads an unindexed disk file without a missing warning or writes, then resumes after indexing', async () => {
  const vault = new FakeVault(), first = store(vault, 'A');
  await first.initialize(legacy(), true, 100);
  const staleReplica = vault.files.get(first.replicaPath);
  const next = first.data; next.salaryCents = 700000;
  await first.save(first.data, next);
  vault.files.set(first.replicaPath, staleReplica);
  const canonical = vault.text(), writes = vault.writes;
  const lookup = vault.getAbstractFileByPath.bind(vault);
  let indexed = false;
  vault.getAbstractFileByPath = path => path === V.VAULT_DATA_PATH && !indexed ? null : lookup(path);
  const restarted = store(vault, 'A');
  assert.equal((await restarted.initialize(defaults(), false, 0)).salaryCents, 700000);
  assert.equal(restarted.writable, false); assert.deepEqual(restarted.notices, []);
  assert.equal(await restarted.receive(), false);
  await assert.rejects(restarted.restoreData(), /正在加载/);
  await assert.rejects(restarted.save(restarted.data, restarted.data), /不可写/);
  assert.equal(vault.text(), canonical); assert.equal(vault.writes, writes);
  assert.equal(vault.files.get(first.replicaPath), staleReplica);
  indexed = true; await restarted.receive();
  assert.equal(restarted.writable, true); assert.deepEqual(restarted.notices, []);
  assert.equal(vault.text(), canonical); assert.equal(vault.writes, writes);
  assert.deepEqual(V.parseVaultData(vault.files.get(first.replicaPath)), V.parseVaultData(canonical));
});

test('a local recovery-cache failure does not roll back an already committed financial edit', async () => {
  const vault = new FakeVault(), s = store(vault, 'A'); await s.initialize(legacy(), true, 100);
  vault.failMirror = true; const next = s.data; next.salaryCents = 700000;
  await s.save(s.data, next); assert.equal(s.data.salaryCents, 700000); assert.match(s.notices[0], /副本写入失败/);
});

test('rebasing a completed write preserves newer unsaved edits while applying remote changes', () => {
  const before = legacy(), current = copy(before), committed = copy(before);
  current.trendDateNotes['2026-10-01'] = '仍在输入'; committed.trendDateNotes['2026-10-02'] = '同步收到'; committed.salaryCents = 700000;
  const result = V.rebaseShared(current, before, committed, defaults());
  assert.equal(result.trendDateNotes['2026-10-01'], '仍在输入'); assert.equal(result.trendDateNotes['2026-10-02'], '同步收到'); assert.equal(result.salaryCents, 700000);
});

test('production saveSettings separates credentials from shared data and external receive never calls AI', async () => {
  const vault = new FakeVault(), data = store(vault, 'A'); await data.initialize(legacy(), true, 100);
  const p = new Plugin(); p.settings = { ...copy(DEFAULT_SETTINGS), ...data.data, financeAiEndpoint: 'https://private.example', barkUrl: 'private-notification' };
  p.vaultData = data; p.vaultSyncMeta = { version: 1, device: 'A' }; p.sharedDefaults = defaults(); p.assetsStopped = false;
  p.app = { workspace: { getLeavesOfType: () => [] } }; p.refreshViews = () => {}; p.checkBudget = () => {};
  let saved; p.saveData = async d => { saved = copy(d); };
  p.settings.trendDateNotes['2026-10-04'] = '新备注'; await p.saveSettings(false, false);
  assert.equal(data.data.trendDateNotes['2026-10-04'], '新备注'); assert.equal(saved.financeAiEndpoint, 'https://private.example'); assert.equal(saved.barkUrl, 'private-notification'); assert.equal(saved.assets, undefined); assert.equal(saved.trendDateNotes, undefined);
  assert.doesNotMatch(vault.text(), /private\.example|private-notification/);
  const before = data.data; const remote = V.editVaultData(V.parseVaultData(vault.text()), before, { ...before, salaryCents: 800000 }, 'B', 500);
  vault.files.set(V.VAULT_DATA_PATH, JSON.stringify(remote)); p.queueVaultDataReceive(); await p.saveQueue;
  assert.equal(p.settings.salaryCents, 800000); assert.equal(p.settings.financeAiEndpoint, 'https://private.example');
  const writes = vault.writes; p.queueVaultDataReceive(); await p.saveQueue; assert.equal(vault.writes, writes);
});

test('unloaded stores cannot write after reload', async () => {
  const vault = new FakeVault(), s = store(vault, 'A'); await s.initialize(legacy(), true, 100); const text = vault.text(); s.stop();
  const next = s.data; next.salaryCents++;
  await assert.rejects(s.save(s.data, next), /关闭/); assert.equal(vault.text(), text);
});

test('malformed entry types and mismatched record identities are rejected before use', () => {
  for (const [key, value] of [
    ['["salaryCents"]', '不是金额'], ['["assets","accounts","cash"]', { id: 'different' }],
    ['["$order","assets","accounts"]', {}], ['["trendDateNotes","2026-10-01"]', 42]
  ]) assert.throws(() => V.parseVaultData(JSON.stringify({ format: 'ledger-statistics', version: 1, seen: { A: 1 }, entries: { [key]: { clock: 1, device: 'A', value } } })), /损坏/);
});

test('set membership and unusual note keys survive serialization without changing object prototypes', async () => {
  const vault = new FakeVault(), s = store(vault, 'A'), input = legacy(); input.starredRecordIds = ['z', 'a'];
  input.assets.recordAssignments = JSON.parse('{"__proto__":"cash","constructor":"exclude"}');
  const result = await s.initialize(input, true, 100);
  assert.deepEqual([...result.starredRecordIds].sort(), ['a', 'z']);
  assert.equal(Object.getPrototypeOf(result.assets.recordAssignments), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(result.assets.recordAssignments, '__proto__').value, 'cash');
});

test('a conflict arriving inside the locked write is backed up before the final merge is saved', async () => {
  const { va, vb, a, b } = await offlinePair();
  const bb = b.data; bb.trendDateNotes['2026-10-01'] = '晚到的手机修改'; await b.save(b.data, bb);
  va.beforeProcess = () => va.files.set(V.VAULT_DATA_PATH, vb.text());
  const aa = a.data; aa.trendDateNotes['2026-10-01'] = '电脑修改'; await a.save(a.data, aa);
  assert.ok([...va.files].some(([p, text]) => p.includes('/conflict-') && text.includes('晚到的手机修改') && text.includes('电脑修改')));
});

test('real 30-second foreground ticks after a sync round trip do not save snapshots or rewrite the vault file', async () => {
  const vault = new FakeVault(), initial = legacy();
  Object.assign(initial, salary.reconcileSalaryCycles(initial));
  assets.storeAssetSnapshot(initial.assets, assets.buildAssetSnapshot(initial.assets, []));
  const data = store(vault, 'A'); await data.initialize(initial, true, 100);
  const p = new Plugin(); p.settings = { ...copy(DEFAULT_SETTINGS), ...data.data };
  p.vaultData = data; p.vaultSyncMeta = { version: 1, device: 'A' }; p.sharedDefaults = defaults(); p.assetsStopped = false;
  p.app = { workspace: { getLeavesOfType: () => [] } }; p.repository = { loaded: true, files: new Map() };
  p.checkBudget = () => {}; p.refreshViews = () => {}; p.refreshAssetQuotes = async () => {};
  let settingsSaves = 0; const save = p.saveSettings.bind(p);
  p.saveSettings = async (...args) => { settingsSaves++; await save(...args); };
  p.saveData = async () => {};
  const previousDocument = vault.text(), previousTime = p.settings.assets.snapshots[0].savedAt;
  const oldDocument = global.document; global.document = { hidden: false };
  try {
    for (let i = 0; i < 8; i++) {
      p.tick(); await p.assetQueue; await p.saveQueue;
      assert.equal(await data.receive(), false);
    }
  } finally { global.document = oldDocument; }
  assert.equal(settingsSaves, 0, 'No foreground tick should invent a salary or asset change');
  assert.equal(p.salaryHistoryDirty, false);
  assert.equal(vault.text(), previousDocument);
  assert.equal(p.settings.assets.snapshots[0].savedAt, previousTime);
  const baseline = vault.writes;
  await p.updateAssets(state => { state.accounts[0].balanceCents++; });
  assert.equal(vault.writes, baseline + 1, 'A real balance edit must still write and sync');
  assert.equal(data.data.assets.accounts[0].balanceCents, initial.assets.accounts[0].balanceCents + 1);
});

test('two devices receiving each others reordered snapshots converge and remain idle across foreground checks', async () => {
  const { va, vb, a, b } = await offlinePair();
  const initial = a.data;
  assets.storeAssetSnapshot(initial.assets, assets.buildAssetSnapshot(initial.assets, [], new Date('2026-10-17T03:00:00Z')));
  await a.save(a.data, initial); vb.files.set(V.VAULT_DATA_PATH, va.text()); await b.receive();
  const writesA = va.writes, writesB = vb.writes;
  for (let i = 0; i < 6; i++) {
    for (const data of [a, b]) {
      const state = data.data.assets, snapshot = assets.buildAssetSnapshot(state, [], new Date(`2026-10-17T03:0${i}:30Z`));
      const savedAt = state.snapshots[state.snapshots.length - 1].savedAt;
      assert.equal(assets.storeAssetSnapshot(state, snapshot), false);
      assert.equal(state.snapshots[state.snapshots.length - 1].savedAt, savedAt);
    }
    va.files.set(V.VAULT_DATA_PATH, vb.text()); await a.receive();
    vb.files.set(V.VAULT_DATA_PATH, va.text()); await b.receive();
  }
  assert.equal(va.writes, writesA); assert.equal(vb.writes, writesB);
});


test('corrupt canonical data starts read-only from the replica and recovery backs up exact broken bytes', async () => {
  const vault = new FakeVault(), first = store(vault, 'A'); await first.initialize(legacy(), true, 100);
  const mirror = vault.files.get(first.replicaPath), broken = '{"format":"ledger-statistics",';
  vault.files.set(V.VAULT_DATA_PATH, broken);
  const next = store(vault, 'A'); assert.deepEqual(await next.initialize(defaults(), false, 0), legacy());
  assert.equal(next.writable, false); assert.equal(vault.text(), broken); assert.equal(vault.files.get(first.replicaPath), mirror);
  await assert.rejects(next.save(next.data, { ...next.data, salaryCents: 1 }), /不可写/);
  await next.restoreData();
  assert.ok([...vault.files].some(([p, text]) => p.includes('/corrupt-data-') && text === broken));
  V.parseVaultData(vault.text()); assert.deepEqual(next.data, legacy());
  assert.deepEqual(await store(vault, 'A').initialize(defaults(), false, 0), legacy());
  assert.equal(next.writable, true);
});

test('a corrupt replica cannot prevent reading healthy canonical data and is preserved before repair', async () => {
  const vault = new FakeVault(), first = store(vault, 'A'); await first.initialize(legacy(), true, 100);
  const canonical = vault.text(); vault.files.set(first.replicaPath, '{broken-replica');
  const next = store(vault, 'A'); assert.deepEqual(await next.initialize(defaults(), false, 0), legacy());
  assert.equal(next.writable, false); assert.equal(vault.text(), canonical);
  await next.restoreData(); assert.equal(next.writable, true); assert.equal(vault.text(), canonical);
  assert.ok([...vault.files].some(([p, text]) => p.includes('/before-restore-replica-') && text === '{broken-replica'));
});

test('both broken sources keep the settings accessible but cannot restore defaults over user data', async () => {
  const vault = new FakeVault(), s = store(vault, 'A');
  vault.files.set(V.VAULT_DATA_PATH, '{broken'); vault.files.set(s.replicaPath, 'broken-replica');
  assert.deepEqual(await s.initialize(defaults(), false, 0), defaults());
  assert.equal(s.writable, false);
  await assert.rejects(s.restoreData(), /没有.*有效/);
  assert.equal(vault.text(), '{broken'); assert.equal(vault.files.get(s.replicaPath), 'broken-replica');
});

test('recovery refuses unsupported future formats and preserves them unchanged', async () => {
  const vault = new FakeVault(), first = store(vault, 'A'); await first.initialize(legacy(), true, 100);
  const future = JSON.stringify({format:'ledger-statistics', version:2, seen:{}, entries:{}});
  vault.files.set(V.VAULT_DATA_PATH, future);
  const next = store(vault, 'A'); await next.initialize(defaults(), false, 0);
  await assert.rejects(next.restoreData(), /不支持/); assert.equal(vault.text(), future);
});

test('failed backup and a simultaneous sync replacement both prevent corrupt recovery overwrites', async () => {
  const vault = new FakeVault(), s = store(vault, 'A'); await s.initialize(legacy(), true, 100);
  const good = vault.text(); vault.files.set(V.VAULT_DATA_PATH, '{broken');
  await assert.rejects(s.receive(), /同步/);
  const write = vault.adapter.write;
  vault.adapter.write = async path => { if (path.includes('sync-backups')) throw Error('disk full'); };
  await assert.rejects(s.restoreData(), /disk full/); assert.equal(vault.text(), '{broken'); assert.equal(s.writable, false);
  vault.adapter.write = write;
  vault.beforeProcess = () => vault.files.set(V.VAULT_DATA_PATH, good);
  await assert.rejects(s.restoreData(), /变化/); assert.equal(vault.text(), good);
  await s.receive(); assert.equal(s.writable, true);
});


async function loadPluginFixture(vault, stored) {
  const p = new Plugin(), device = 'device-' + 'a'.repeat(32), registrations = [];
  vault.files.set('.obsidian/plugins/ledger-statistics/sync-device.json', JSON.stringify({device}));
  vault.adapter.stat = async () => null;
  vault.getMarkdownFiles = () => []; vault.on = () => ({}); vault.offref = () => {}; vault.getName = () => 'test';
  p.app = { vault, secretStorage: { getSecret: () => null }, workspace: { getLeavesOfType: () => [], onLayoutReady: callback => { p.layoutReady = callback; } } };
  p.manifest = { id: 'ledger-statistics' }; p.loadData = async () => stored;
  p.saveData = async () => { registrations.push('saved local settings'); };
  for (const method of ['registerEvent','registerInterval','registerDomEvent','registerView','addRibbonIcon','addCommand','addSettingTab']) {
    p[method] = (...args) => registrations.push([method, ...args]);
  }
  const oldWindow = global.window, oldDocument = global.document;
  global.window = { setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {} }; global.document = { hidden: false };
  try { await p.onload(); } finally { global.window = oldWindow; global.document = oldDocument; }
  p.settingTab.display = () => {};
  return {p, registrations};
}

test('production onload finishes and registers settings/view even with damaged state and a new salary cycle', async () => {
  const vault = new FakeVault(), first = new V.VaultDataStore(vault, '.obsidian/plugins/ledger-statistics', 'A', defaults(), () => {}, () => 200);
  const input = legacy(); input.salaryCycleStart = '2026-01-01';
  await first.initialize(input, true, 100); const mirror = vault.files.get(first.replicaPath);
  vault.files.set(V.VAULT_DATA_PATH, '{broken');
  const {p, registrations} = await loadPluginFixture(vault, {vaultDataSync:{version:1}});
  assert.ok(registrations.some(x => x[0] === 'addSettingTab')); assert.ok(registrations.some(x => x[0] === 'registerView'));
  assert.equal(p.settings.salaryCents, 600000); assert.equal(p.vaultDataReadOnly, true);
  assert.equal(vault.text(), '{broken'); assert.equal(vault.files.get(first.replicaPath), mirror);
  assert.ok(!registrations.includes('saved local settings'));
  await assert.rejects(p.saveSettings(false), /不可写/);
  const oldDocument = global.document; global.document = { hidden: false };
  try { p.tick(); await p.saveQueue; await p.assetQueue; } finally { global.document = oldDocument; }
  assert.equal(vault.text(), '{broken');
  await p.restoreVaultData(); assert.equal(p.vaultDataReadOnly, false);
});

test('production onload registers recovery settings when both sources are corrupt', async () => {
  const vault = new FakeVault(); vault.files.set(V.VAULT_DATA_PATH, '{broken');
  vault.files.set('.obsidian/plugins/ledger-statistics/sync-replica.json', '{broken-replica');
  const {p, registrations} = await loadPluginFixture(vault, {vaultDataSync:{version:1}});
  assert.ok(registrations.some(x => x[0] === 'addSettingTab')); assert.equal(p.vaultDataReadOnly, true);
  await assert.rejects(p.restoreVaultData(), /没有.*有效/); assert.equal(vault.text(), '{broken');
});

test('production onload finishes with a missing file and a stale salary cycle instead of skipping host CSS loading', async () => {
  const vault = new FakeVault(), first = new V.VaultDataStore(vault, '.obsidian/plugins/ledger-statistics', 'A', defaults(), () => {});
  const input = legacy(); input.salaryCycleStart = '2026-01-01';
  await first.initialize(input, true, 100); vault.files.delete(V.VAULT_DATA_PATH);
  const {p, registrations} = await loadPluginFixture(vault, {vaultDataSync:{version:1}});
  assert.equal(p.vaultDataReadOnly, true);
  assert.ok(registrations.some(x => x[0] === 'registerView'));
  assert.ok(registrations.some(x => x[0] === 'addSettingTab'));
  assert.equal(vault.text(), undefined);
  assert.ok(!registrations.includes('saved local settings'));
});

test('production startup rechecks the index after layout readiness even without a create event', async () => {
  const vault = new FakeVault(), first = new V.VaultDataStore(vault, '.obsidian/plugins/ledger-statistics', 'A', defaults(), () => {});
  await first.initialize(legacy(), true, 100);
  const lookup = vault.getAbstractFileByPath.bind(vault);
  let indexed = false;
  vault.getAbstractFileByPath = path => path === V.VAULT_DATA_PATH && !indexed ? null : lookup(path);
  const {p} = await loadPluginFixture(vault, {vaultDataSync:{version:1}});
  assert.equal(p.vaultDataReadOnly, true);
  indexed = true; p.layoutReady(); await p.saveQueue;
  assert.equal(p.vaultDataReadOnly, false);
  assert.equal(p.settings.salaryCents, 600000);
});

test('migration keeps its legacy business data until corrupt sync data is explicitly recovered', async () => {
  const vault = new FakeVault(); vault.files.set(V.VAULT_DATA_PATH, '{broken');
  const {p, registrations} = await loadPluginFixture(vault, legacy());
  assert.ok(!registrations.includes('saved local settings')); assert.equal(p.settings.salaryCents, 600000);
  await p.restoreVaultData(); assert.equal(p.vaultDataReadOnly, false);
  assert.ok(registrations.includes('saved local settings'));
});
