const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerRepository } = require('../dist/repository.cjs');
const Plugin = require('../dist/main.cjs').default;
const assets = require('../dist/assets.cjs');

function fixture() {
  const file = new global.__ledgerTestTFile('记账/day.md');
  const files = new Map([[file.path, file]]), tasks = new Map();
  let sequence = 0, reads = 0, notifications = 0;
  const originalWindow = global.window;
  global.window = { setTimeout(fn) { const id = ++sequence; tasks.set(id, fn); return id; }, clearTimeout(id) { tasks.delete(id); } };
  let text = '---\ndate: 2026-10-14\ntotal: 10\n---\n# 今日消费记录\n- 12:00｜餐饮｜￥10.00\n';
  const repo = new LedgerRepository({ vault: {
    getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: path => files.get(path),
    read: async () => { reads++; return text; }, on: () => ({}), offref() {}
  } }, '记账', () => { notifications++; });
  return { repo, file, files, tasks, get reads() { return reads; }, get notifications() { return notifications; },
    set text(value) { text = value; }, get text() { return text; },
    flush() { for (const [id, fn] of [...tasks]) { tasks.delete(id); fn(); } },
    dispose() { repo.dispose(); global.window = originalWindow; } };
}

test('sync deletes and renames outside the ledger never redraw or rescan the overview', async () => {
  const f = fixture();
  try {
    await f.repo.start(); f.flush();
    const revision = f.repo.contentRevision;
    for (let i = 0; i < 10; i++) {
      f.repo.handleDelete({ path: '.obsidian/plugins/ledger-statistics/data.json.tmp' });
      f.repo.handleDelete({ path: '其他笔记/old.md' });
      await f.repo.handleRename({ path: '其他笔记/new-folder' }, '其他笔记/old-folder');
      f.flush();
    }
    assert.equal(f.reads, 1, 'Unrelated folder renames must not reread ledger files');
    assert.equal(f.notifications, 1, 'Sync chatter must not repeatedly redraw the page');
    assert.equal(f.repo.contentRevision, revision);
  } finally { f.dispose(); }
});

test('identical sync writes preserve cached records, but real edits still notify', async () => {
  const f = fixture();
  try {
    await f.repo.start(); f.flush();
    const revision = f.repo.contentRevision, parsed = f.repo.files.get(f.file.path);
    for (let i = 0; i < 10; i++) { await f.repo.handleCreateOrModify(f.file); f.flush(); }
    assert.equal(f.notifications, 1);
    assert.equal(f.repo.contentRevision, revision);
    assert.equal(f.repo.files.get(f.file.path), parsed);
    f.text = f.text.replace('total: 10', 'total: 20').replace('￥10.00', '￥20.00');
    await f.repo.handleCreateOrModify(f.file); f.flush();
    assert.equal(f.notifications, 2);
    assert.equal(f.repo.files.get(f.file.path).records[0].cents, 2000);
  } finally { f.dispose(); }
});

test('settings sync rename feedback stops after the original AI cache save', async () => {
  const f = fixture();
  try {
    await f.repo.start(); f.flush();
    const p = new Plugin();
    p.repository = f.repo;
    p.settings = { ...p.settings, assets: assets.emptyAssets() };
    p.settings.assets.accounts.push({ id: 'cash', name: '现金', kind: 'cash', balanceCents: 10000,
      baselineAt: new Date().toISOString(), includedRecordIds: [], includedEventIds: [] });
    assets.storeAssetSnapshot(p.settings.assets, assets.buildAssetSnapshot(p.settings.assets, [...f.repo.files.values()].flatMap(f => f.records)));
    let saves = 0, renders = 0;
    p.refreshViews = () => { renders++; };
    p.checkBudget = () => {};
    // Mobile sync can rename files after receiving a settings write. Bound the
    // old implementation's feedback so this regression test cannot run forever.
    p.saveData = async () => {
      saves++;
      f.repo.handleDelete({ path: '同步缓存/data.json.tmp' });
      await f.repo.handleRename({ path: '同步缓存/new' }, '同步缓存/old');
      if (saves < 5) void p.updateAssets(s => assets.renameAssetLinks(s, '同步缓存/old', '同步缓存/new'));
    };
    p.settings.financeAdviceCache = { advice: { headline: '已更新的洞察' } };
    await p.saveSettings(false, false);
    // Each queued save may enqueue another asset update; drain the bounded chain.
    for (let i = 0; i < 6; i++) { await p.assetQueue; await p.saveQueue; }
    f.flush();
    assert.equal(saves, 1, 'One AI save must not feed further saves through unrelated rename events');
    assert.equal(renders, 0);
    assert.equal(f.notifications, 1);
    assert.equal(p.settings.financeAdviceCache.advice.headline, '已更新的洞察');
    // A meaningful asset edit must still save and refresh once.
    await p.updateAssets(s => { s.accounts[0].balanceCents = 12000; });
    assert.equal(saves, 2);
    assert.equal(renders, 1);
  } finally { f.dispose(); }
});
