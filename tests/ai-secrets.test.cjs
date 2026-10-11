const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateAiSecret, withoutLegacyAiSecret, financeAiConfig, normalizeAiSecretId } = require('../dist/ai-secrets.cjs');
const { testFinanceConnection } = require('../dist/ai.cjs');
const Plugin = require('../dist/main.cjs').default;

function keychain(initial = []) {
  const values = new Map(initial);
  return { values, getSecret: id => values.get(id) ?? null, setSecret: (id, value) => values.set(id, value) };
}

test('migration preserves ledger data, verifies the keychain and removes the plaintext field', () => {
  const storage = keychain(), original = { financeAiApiKey: ' fake-test-credential ', assets: { accounts: [{ id: 'cash' }] }, reportCaches: [{ report: 'saved' }] };
  const migrated = migrateAiSecret(original, storage, () => 'ledger-test-ai');
  assert.equal(migrated.changed, true);
  assert.equal(storage.getSecret(migrated.data.financeAiSecretId), 'fake-test-credential');
  assert.equal(Object.hasOwn(migrated.data, 'financeAiApiKey'), false);
  assert.deepEqual(migrated.data.assets, original.assets);
  assert.deepEqual(migrated.data.reportCaches, original.reportCaches);
  assert.doesNotMatch(JSON.stringify(migrated.data), /fake-test-credential/);
  assert.equal(original.financeAiApiKey, ' fake-test-credential ');
  assert.equal(migrateAiSecret(migrated.data, storage).changed, false);
});

test('a stale legacy credential never overwrites an existing device credential', () => {
  const storage = keychain([['existing-key', 'device-key']]);
  const migrated = migrateAiSecret({ financeAiApiKey: 'legacy-key', financeAiSecretId: 'existing-key' }, storage, () => 'imported-key');
  assert.equal(storage.getSecret('existing-key'), 'device-key');
  assert.equal(storage.getSecret('imported-key'), 'legacy-key');
  assert.equal(migrated.data.financeAiSecretId, 'imported-key');
});

test('retry after a disk save failure reuses the verified credential reference', () => {
  const storage = keychain([['existing-key', 'legacy-key']]);
  const migrated = migrateAiSecret({ financeAiApiKey: 'legacy-key', financeAiSecretId: 'existing-key' }, storage, () => { throw new Error('must not create a duplicate'); });
  assert.equal(migrated.data.financeAiSecretId, 'existing-key');
});

test('failed keychain writes or verification preserve the original and redact underlying errors', () => {
  const original = { financeAiApiKey: 'fake-secret-must-not-leak' };
  for (const storage of [undefined, { getSecret: () => null, setSecret: () => {} }, { getSecret: () => null, setSecret: () => { throw new Error(original.financeAiApiKey); } }]) {
    assert.throws(() => migrateAiSecret(original, storage, () => 'test-key'), error => /原数据文件已保留/.test(error.message) && !error.message.includes(original.financeAiApiKey));
    assert.equal(original.financeAiApiKey, 'fake-secret-must-not-leak');
  }
});

test('empty legacy fields are removed without creating secrets', () => {
  const migrated = migrateAiSecret({ financeAiApiKey: '', salaryCents: 500000 }, undefined);
  assert.deepEqual(migrated.data, { salaryCents: 500000, financeAiSecretId: '' });
  assert.equal(migrated.changed, true);
});

test('credentials are resolved per device and changes in keychain values are read on the next request', () => {
  const settings = { financeAiEndpoint: 'https://example.test/v1', financeAiModel: 'test', financeAiSecretId: 'shared-name' };
  const first = keychain([['shared-name', 'device-a']]), second = keychain([['shared-name', 'device-b']]);
  assert.equal(financeAiConfig(settings, { secretStorage: first }).apiKey, 'device-a');
  assert.equal(financeAiConfig(settings, { secretStorage: second }).apiKey, 'device-b');
  first.setSecret('shared-name', 'updated-device-a');
  assert.equal(financeAiConfig(settings, { secretStorage: first }).apiKey, 'updated-device-a');
  assert.doesNotMatch(JSON.stringify(settings), /device-a|device-b/);
});

test('missing or unreadable selected secrets block network requests with actionable errors', async () => {
  let calls = 0;
  global.__ledgerTestRequest = () => { calls++; throw new Error('unexpected network call'); };
  try {
    for (const storage of [undefined, keychain(), { getSecret() { throw new Error('fake-secret-must-not-leak'); } }]) {
      const config = financeAiConfig({ financeAiEndpoint: 'https://example.test/v1', financeAiModel: 'test', financeAiSecretId: 'missing-key' }, { secretStorage: storage });
      assert.doesNotMatch(config.credentialError, /fake-secret-must-not-leak/);
      await assert.rejects(testFinanceConnection(config), /钥匙串/);
    }
    assert.equal(calls, 0);
  } finally { delete global.__ledgerTestRequest; }
});

test('unselected secrets retain support for intentionally unauthenticated endpoints', () => {
  assert.deepEqual(financeAiConfig({ financeAiEndpoint: 'http://localhost/v1', financeAiModel: 'local', financeAiSecretId: '' }), { endpoint: 'http://localhost/v1', model: 'local', apiKey: '' });
});

test('cleared native selections and malformed synced names normalize safely before saving or resolving', () => {
  for (const selection of [null, undefined, 42, {}]) {
    const settings = { financeAiEndpoint: 'http://localhost/v1', financeAiModel: 'local', financeAiSecretId: selection };
    assert.equal(normalizeAiSecretId(selection), '');
    assert.deepEqual(financeAiConfig(settings), { endpoint: 'http://localhost/v1', model: 'local', apiKey: '' });
    const migrated = migrateAiSecret(settings, undefined);
    assert.equal(migrated.data.financeAiSecretId, '');
    assert.equal(Object.hasOwn(migrated.data, 'financeAiApiKey'), false);
  }
});

test('all saves strip legacy fields while preserving data and the secret reference', async () => {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = { financeAiApiKey: 'must-not-persist', financeAiSecretId: 'local-key', assets: { accounts: [{ id: 'cash' }] } };
  plugin.saveQueue = Promise.resolve();
  const saved = [];
  plugin.saveData = async data => saved.push(data);
  plugin.refreshViews = () => {};
  plugin.checkBudget = () => {};
  await plugin.saveSettings(false);
  assert.deepEqual(saved, [{ financeAiSecretId: 'local-key', assets: { accounts: [{ id: 'cash' }] } }]);
  assert.equal(plugin.settings.financeAiApiKey, 'must-not-persist');
  assert.doesNotMatch(JSON.stringify(withoutLegacyAiSecret(plugin.settings)), /must-not-persist/);
});

test('AI calls authenticate with a keychain value without persisting it', async () => {
  const settings = { financeAiEndpoint: 'https://example.test/v1', financeAiModel: 'test', financeAiSecretId: 'test-key' };
  let authorization;
  global.__ledgerTestRequest = async request => { authorization = request.headers.Authorization; return { status: 200, json: { choices: [{ message: { content: 'ok' } }] } }; };
  try {
    await testFinanceConnection(financeAiConfig(settings, { secretStorage: keychain([['test-key', 'fake-keychain-value']]) }));
    assert.equal(authorization, 'Bearer fake-keychain-value');
    assert.doesNotMatch(JSON.stringify(settings), /fake-keychain-value/);
  } finally { delete global.__ledgerTestRequest; }
});
