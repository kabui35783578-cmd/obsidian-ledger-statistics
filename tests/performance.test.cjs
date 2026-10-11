const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerRepository } = require('../dist/repository.cjs');
const { LedgerStatisticsView } = require('../dist/view.cjs');
const core = require('../dist/core.cjs');
global.window = global;
const note = amount => `---\ndate: 2026-09-21\ntotal: ${amount}\n---\n# 今日消费记录\n- 12:00｜餐饮｜￥${amount}\n`;

test('view record cache refreshes on edit, rename, deletion and folder changes', async () => {
  const file = new global.__ledgerTestTFile('记账/day.md'), files = new Map([[file.path, file]]);
  let text = note('10.00');
  const vault = { getMarkdownFiles: () => [...files.values()], getAbstractFileByPath: path => files.get(path), read: async () => text, on: () => ({}), offref() {} };
  const repo = new LedgerRepository({ vault }, '记账', () => {});
  const view = new LedgerStatisticsView({}, { repository: repo, settings: {defaultView:'overview',defaultDatePreset:'month',excludedCategories:[]} });
  const filter = { range:{start:'2026-09-01',end:'2026-09-30'},scope:'all',excludedCategories:[],categories:[],keyword:'' };
  try {
    await repo.start();
    const first = view.allRecords();
    assert.equal(view.allRecords(), first, 'Unchanged data reuses one sorted array');
    const selected = view.matchingRecords(filter); selected.length = 0;
    assert.equal(view.matchingRecords(filter).length, 1, 'Filtering returns an independent array');
    text = note('20.00'); await repo.handleCreateOrModify(file);
    assert.notEqual(view.allRecords(), first); assert.equal(view.allRecords()[0].cents, 2000);
    const oldPath = file.path; files.clear(); file.path = '记账/renamed.md'; files.set(file.path, file);
    await repo.handleRename(file, oldPath);
    assert.equal(view.allRecords()[0].path, file.path);
    assert.deepEqual(view.matchingRecords(filter), core.filteredRecords(repo.files.values(), filter));
    await repo.setFolder('另一目录'); assert.equal(view.allRecords().length, 0);
    await repo.setFolder('记账'); assert.equal(view.allRecords().length, 1);
    files.clear(); repo.handleDelete(file); assert.equal(view.allRecords().length, 0);
  } finally { repo.dispose(); }
});
