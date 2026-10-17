import { Notice, Plugin, TAbstractFile, requestUrl } from "obsidian";
import { BudgetMonitor } from "./budget-monitor";
import { sharedRequestGate } from "./request-gate";
import { flattenRecords, isValidIsoDate, migrateStarredIds, normalizeTrendDateNotes, renameStarredIds } from "./core";
import { LedgerRepository } from "./repository";
import { createBalanceCalibration, isBalanceCalibration } from "./balance";
import { reconcileSalaryCycles, SalaryCycleState } from "./salary-history";
import { DEFAULT_SETTINGS, LedgerSettingTab, LedgerSettings, normalizeLedgerView } from "./settings";
import { LedgerStatisticsView, LEDGER_VIEW_TYPE } from "./view";
import { normalizeReportPreferences } from "./report";
import { normalizeReportCaches } from "./report-ai";
import { AssetSnapshot, AssetState, SecurityKind, applyAssetQuote, assetId, buildAssetSnapshot, calibrateAccount, normalizeAssets, quoteKey, renameAssetLinks, setDefaultCash, storeAssetSnapshot } from "./assets";
import { AssetQuoteMonitor } from "./asset-quotes";
import { disposeAssetGestures } from "./asset-gestures";
import { migrateAiSecret, withoutLegacyAiSecret } from "./ai-secrets";
import { VAULT_DATA_PATH, VaultDataStore, rebaseShared, sharedSettings } from "./vault-data";
import { jsonDataEqual } from "./json-data";

export default class LedgerStatisticsPlugin extends Plugin {
  settings: LedgerSettings = DEFAULT_SETTINGS;
  repository!: LedgerRepository;
  private budgetMonitor!: BudgetMonitor;
  private settingTab?: LedgerSettingTab;
  private saveQueue: Promise<void> = Promise.resolve();
  private assetQueue: Promise<void> = Promise.resolve();
  private trendNoteQueue: Promise<void> = Promise.resolve();
  private assetQuotes!: AssetQuoteMonitor;
  private assetsStopped = false;
  private salaryHistoryDirty = false;
  private vaultData?: VaultDataStore;
  private vaultSyncMeta?: { version: 1; device: string };
  private sharedDefaults = sharedSettings(DEFAULT_SETTINGS);
  private syncError = "";
  private localSettingsText = "";

  openAiSettings(): void {
    this.settingTab?.selectAiSection();
    const settings = (this.app as typeof this.app & { setting: { open(): void; openTabById(id: string): void } }).setting;
    settings.open();
    settings.openTabById(this.manifest.id);
  }

  async onload(): Promise<void> {
    const stored = await this.loadData();
    const migratedSecrets = migrateAiSecret(stored ?? {}, this.app.secretStorage);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, migratedSecrets.data);
    this.normalizeSettings();
    const meta = stored?.vaultDataSync;
    const migrate = meta?.version !== 1;
    const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    const devicePath = `${pluginDir}/sync-device.json`;
    let device = "";
    if (await this.app.vault.adapter.exists(devicePath)) {
      const identity: unknown = JSON.parse(await this.app.vault.adapter.read(devicePath));
      if (identity && typeof identity === "object" && "device" in identity && typeof identity.device === "string" && /^device-[a-f0-9]{32}$/.test(identity.device)) device = identity.device;
      else throw new Error("本机同步标识损坏，请保留 sync-device.json 后检查，未写入业务数据");
    }
    if (!device) {
      device = `device-${Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("")}`;
      await this.app.vault.adapter.write(devicePath, JSON.stringify({ device }));
    }
    this.vaultSyncMeta = { version: 1, device };
    this.vaultData = new VaultDataStore(this.app.vault, pluginDir, device, this.sharedDefaults, message => new Notice(message, 10000));
    const legacyPath = `${pluginDir}/data.json`;
    const legacyStat = await this.app.vault.adapter.stat(legacyPath);
    if (migrate && legacyStat) await this.vaultData.backup("migration", await this.app.vault.adapter.read(legacyPath));
    Object.assign(this.settings, await this.vaultData.initialize(sharedSettings(this.settings), migrate, legacyStat?.mtime ?? Date.now()));
    this.normalizeSettings();
    if (migrate || migratedSecrets.changed) await this.persistLocalSettings();
    const onVaultDataChange = (file: TAbstractFile): void => {
      if (file.path === VAULT_DATA_PATH || VAULT_DATA_PATH.startsWith(`${file.path}/`)) this.queueVaultDataReceive();
    };
    this.registerEvent(this.app.vault.on("create", onVaultDataChange));
    this.registerEvent(this.app.vault.on("modify", onVaultDataChange));
    this.registerEvent(this.app.vault.on("delete", onVaultDataChange));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file.path === VAULT_DATA_PATH || oldPath === VAULT_DATA_PATH || VAULT_DATA_PATH.startsWith(`${oldPath}/`) || VAULT_DATA_PATH.startsWith(`${file.path}/`)) this.queueVaultDataReceive();
    }));
    this.settings.defaultView = normalizeLedgerView(this.settings.defaultView);
    this.settings.assets = normalizeAssets(this.settings.assets);
    this.assetsStopped = false;
    this.assetQuotes = new AssetQuoteMonitor(() => this.settings.assets, async url => {
      const response = await requestUrl({ url, method: "GET", throw: true });
      return { text: response.text, arrayBuffer: response.arrayBuffer };
    }, quotes => this.updateAssets(state => {
      const active = new Set(state.accounts.filter(a => !a.archived).map(a => a.id));
      const held = new Set(state.holdings.filter(h => active.has(h.accountId)).map(h => quoteKey(h.kind, h.code)));
      for (const quote of quotes) if (held.has(quote.key)) applyAssetQuote(state, quote);
    }));
    if (this.syncSalaryCycles()) await this.saveSettings(false, false);
    this.budgetMonitor = new BudgetMonitor(() => this.settings, (url) => requestUrl({ url, method: "GET", throw: true }),
      () => this.saveSettings(false, false), (message) => new Notice(message), sharedRequestGate(`bark:${this.app.vault.getName()}`));
    this.repository = new LedgerRepository(this.app, this.settings.ledgerFolder, () => {
      this.refreshViews();
      this.settingTab?.refreshBalanceSummary();
      this.checkBudget();
      void this.captureAssetSnapshot().catch(() => {});
    });
    this.registerView(LEDGER_VIEW_TYPE, (leaf) => new LedgerStatisticsView(leaf, this));
    this.addRibbonIcon("chart-pie", "打开记账统计", () => void this.activateView());
    this.addCommand({ id: "open-ledger-statistics", name: "打开记账统计", callback: () => void this.activateView() });
    this.addCommand({ id: "open-ledger-assets", name: "打开资产总览", callback: () => void this.activateView(true) });
    this.settingTab = new LedgerSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    await this.repository.start();
    const migrated = migrateStarredIds(this.settings.starredRecordIds, flattenRecords(this.repository.files.values()));
    if (JSON.stringify(migrated) !== JSON.stringify(this.settings.starredRecordIds)) {
      this.settings.starredRecordIds = migrated;
      await this.saveSettings(false);
    }
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.settings.assets.accounts.length) void this.updateAssets(state => renameAssetLinks(state, oldPath, file.path)).catch(() => {});
      const renamed = renameStarredIds(this.settings.starredRecordIds, oldPath, file.path);
      let fixedChanged = false;
      for (const item of this.settings.fixedExpenses) for (const [cycle, id] of Object.entries(item.payments)) {
        const next = renameStarredIds([id], oldPath, file.path)[0];
        if (next !== id) { item.payments[cycle] = next; fixedChanged = true; }
      }
      if (fixedChanged || JSON.stringify(renamed) !== JSON.stringify(this.settings.starredRecordIds)) {
        this.settings.starredRecordIds = renamed;
        void this.saveSettings(false);
      }
    }));
    this.registerInterval(window.setInterval(() => this.tick(), 30_000));
    this.registerDomEvent(document, "visibilitychange", () => {
      if (!document.hidden) this.tick();
    });
    this.registerDomEvent(window, "focus", () => this.tick());
    this.checkBudget();
    await this.captureAssetSnapshot();
    // A vault-file migration can outlast Obsidian's view restoration during a
    // plugin reload. Replace the temporary "unknown view" with the real view.
    for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
      if (leaf.view instanceof LedgerStatisticsView) continue;
      const state = leaf.getViewState();
      await leaf.setViewState({ type: "empty" });
      await leaf.setViewState({ type: LEDGER_VIEW_TYPE, state: state.state });
    }
    void this.refreshAssetQuotes().catch(() => {});
  }

  onunload(): void {
    this.assetsStopped = true;
    this.vaultData?.stop();
    this.assetQuotes?.stop();
    this.budgetMonitor?.stop();
    for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
      if (leaf.view instanceof LedgerStatisticsView) void leaf.view.onClose();
    }
    disposeAssetGestures();
    this.repository?.dispose();
  }

  async saveSettings(rescan: boolean, refresh = true, now = new Date()): Promise<void> {
    this.syncSalaryCycles(now);
    const data = JSON.parse(JSON.stringify(withoutLegacyAiSecret(this.settings)));
    const before = this.vaultData?.data;
    const saved = this.saveQueue.then(async () => {
      if (this.vaultData && before) {
        await this.persistLocalSettings();
        const committed = await this.vaultData.save(before, sharedSettings(data));
        Object.assign(this.settings, rebaseShared(this.settings, sharedSettings(data), committed, this.sharedDefaults));
        this.normalizeSettings();
      } else await this.saveData(data);
    });
    this.saveQueue = saved.catch(() => {});
    await saved;
    this.salaryHistoryDirty = ["salaryCycleStart", "salaryCycles", "salaryCents", "balanceCalibration", "balanceCalibrationNote"].some(key =>
      !jsonDataEqual(this.settings[key as keyof LedgerSettings], data[key]));
    if (rescan) await this.repository.setFolder(this.settings.ledgerFolder);
    if (refresh) this.refreshViews();
    this.checkBudget();
  }

  private normalizeSettings(): void {
    this.settings.trendDateNotes = normalizeTrendDateNotes(this.settings.trendDateNotes);
    this.settings.defaultView = normalizeLedgerView(this.settings.defaultView);
    this.settings.assets = normalizeAssets(this.settings.assets);
    this.settings.reportPreferences = normalizeReportPreferences(this.settings.reportPreferences);
    this.settings.reportCaches = normalizeReportCaches(this.settings.reportCaches);
    if (typeof this.settings.reportObjectRules !== "string") this.settings.reportObjectRules = DEFAULT_SETTINGS.reportObjectRules;
    this.settings.fixedExpenses = Array.isArray(this.settings.fixedExpenses) ? this.settings.fixedExpenses.filter(item => item && typeof item.name === "string" && typeof item.id === "string" && item.payments && typeof item.payments === "object") : [];
    this.settings.insightHistory = Array.isArray(this.settings.insightHistory) ? this.settings.insightHistory.filter(item => item && typeof item.id === "string" && typeof item.cycle === "string" && typeof item.date === "string" && Number.isFinite(item.impact)) : [];
    if (!isBalanceCalibration(this.settings.balanceCalibration)) this.settings.balanceCalibration = null;
    if (typeof this.settings.balanceCalibrationNote !== "string") this.settings.balanceCalibrationNote = "";
  }

  private async persistLocalSettings(): Promise<void> {
    const data = withoutLegacyAiSecret(this.settings) as Record<string, unknown>;
    for (const key of Object.keys(sharedSettings(this.settings))) delete data[key];
    const local = { ...data, vaultDataSync: this.vaultSyncMeta };
    const text = JSON.stringify(local);
    if (text === this.localSettingsText) return;
    await this.saveData(local);
    this.localSettingsText = text;
  }

  private queueVaultDataReceive(): void {
    const receive = this.saveQueue.then(async () => {
      if (this.assetsStopped || !this.vaultData) return;
      const expected = this.vaultData.data;
      const changed = await this.vaultData.receive();
      this.syncError = "";
      if (!changed) return;
      const oldFolder = this.settings.ledgerFolder;
      Object.assign(this.settings, rebaseShared(this.settings, expected, this.vaultData.data, this.sharedDefaults));
      this.normalizeSettings();
      if (oldFolder !== this.settings.ledgerFolder) await this.repository?.setFolder(this.settings.ledgerFolder);
      this.refreshViews();
      this.settingTab?.refreshBalanceSummary();
    });
    this.saveQueue = receive.catch(error => {
      const message = error instanceof Error ? error.message : "同步数据读取失败";
      if (message !== this.syncError) new Notice(message, 10000);
      this.syncError = message;
    });
  }

  async restoreVaultData(): Promise<void> {
    const restore = this.saveQueue.then(async () => {
      if (!this.vaultData) throw new Error("数据存储尚未就绪");
      await this.vaultData.restoreMissing();
      this.syncError = "";
      new Notice("已从本机副本恢复同步数据文件");
    });
    this.saveQueue = restore.catch(() => {});
    await restore;
  }

  async onExternalSettingsChange(): Promise<void> {
    // Legacy config sync can still deliver device preferences. Business data now
    // has one authority in the vault; never import old data.json over that file.
    const stored = await this.loadData();
    const clean = withoutLegacyAiSecret(stored ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_SETTINGS)) if (!Object.prototype.hasOwnProperty.call(this.sharedDefaults, key) && Object.prototype.hasOwnProperty.call(clean, key)) {
      (this.settings as unknown as Record<string, unknown>)[key] = clean[key];
    }
    this.queueVaultDataReceive();
    await this.saveQueue;
  }

  updateTrendDateNote(date: string, note: string): Promise<void> {
    const operation = this.trendNoteQueue.then(async () => {
      if (this.assetsStopped) throw new Error("插件已关闭，请重新打开");
      if (!isValidIsoDate(date)) throw new Error("备注日期无效");
      const before = this.settings.trendDateNotes;
      const next = { ...before };
      if (note.trim()) next[date] = note.trim(); else delete next[date];
      if (jsonDataEqual(before, next)) return;
      this.settings.trendDateNotes = next;
      try { await this.saveSettings(false, false); }
      catch (error) { this.settings.trendDateNotes = before; throw error; }
      for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
        if (leaf.view instanceof LedgerStatisticsView) leaf.view.refreshTrendDateNotes();
      }
    });
    this.trendNoteQueue = operation.catch(() => {});
    return operation;
  }

  private checkBudget(): void {
    if (this.repository?.loaded) void this.budgetMonitor.check([...this.repository.files.values()]);
  }

  private tick(): void {
    if (this.syncSalaryCycles() || this.salaryHistoryDirty) void this.saveSettings(false).catch(() => new Notice("工资周期保存失败，请检查同步或磁盘后重新保存设置。"));
    for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
      if (leaf.view instanceof LedgerStatisticsView) leaf.view.refreshDate();
    }
    this.settingTab?.refreshBalanceSummary();
    this.checkBudget();
    if (!document.hidden) {
      void this.captureAssetSnapshot().catch(() => {});
      void this.refreshAssetQuotes().catch(() => {});
    }
  }

  assetSnapshot(): AssetSnapshot {
    return buildAssetSnapshot(this.settings.assets, flattenRecords(this.repository.files.values()));
  }

  private syncSalaryCycles(now = new Date()): boolean {
    const next = reconcileSalaryCycles(this.settings, now);
    const changed = Object.entries(next).some(([key, value]) => !jsonDataEqual(this.settings[key as keyof LedgerSettings], value));
    if (changed) { Object.assign(this.settings, next); this.salaryHistoryDirty = true; }
    return changed;
  }

  private currentSalaryState(): SalaryCycleState {
    const { salaryCycleStart, salaryCycles, salaryCents, balanceCalibration, balanceCalibrationNote } = this.settings;
    return { salaryCycleStart, salaryCycles, salaryCents, balanceCalibration, balanceCalibrationNote };
  }

  refreshAssetQuotes(force = false): Promise<void> { return this.assetQuotes.refresh(force); }
  lookupAssetQuote(kind: SecurityKind, code: string) { return this.assetQuotes.lookup(kind, code); }

  refreshAssetViews(): void { this.refreshViews(); }

  /** Calibration writes to cash once; subsequent asset edits never write back to calibration. */
  calibrateBalance(cents: number, now = new Date()): Promise<void> {
    const operation = this.assetQueue.then(async () => {
      if (this.assetsStopped) throw new Error("插件已关闭，请重新打开");
      if (!Number.isSafeInteger(cents)) throw new Error("余额无效");
      const beforeSettings = { ...this.currentSalaryState(), assets: this.settings.assets };
      this.syncSalaryCycles(now);
      const records = flattenRecords(this.repository.files.values());
      const calibration = createBalanceCalibration(records, now, cents);
      if (!isBalanceCalibration(calibration)) throw new Error("余额无效");
      const beforeAssets = this.settings.assets;
      const next = JSON.parse(JSON.stringify(beforeAssets)) as AssetState;
      let cash = next.accounts.find(a => a.id === next.defaultCashId && a.kind === "cash" && !a.archived);
      if (!cash) {
        cash = { id: assetId(), name: "余额校准账户", kind: "cash", balanceCents: 0, baselineAt: now.toISOString(), includedRecordIds: [], includedEventIds: [] };
        next.accounts.push(cash);
        setDefaultCash(next, cash.id, records, now);
      }
      calibrateAccount(next, cash.id, cents, records, now);
      storeAssetSnapshot(next, buildAssetSnapshot(next, records, now));
      this.settings.assets = next;
      this.settings.balanceCalibration = calibration;
      try { await this.saveSettings(false, false, now); }
      catch (error) { Object.assign(this.settings, beforeSettings); throw error; }
      if (!this.assetsStopped) this.refreshViews();
      this.settingTab?.refreshBalanceSummary();
    });
    this.assetQueue = operation.catch(() => {});
    return operation;
  }

  clearBalanceCalibration(now = new Date()): Promise<void> {
    const operation = this.assetQueue.then(async () => {
      if (this.assetsStopped) throw new Error("插件已关闭，请重新打开");
      const before = this.currentSalaryState();
      this.syncSalaryCycles(now);
      this.settings.balanceCalibration = null;
      try { await this.saveSettings(false, false, now); }
      catch (error) { Object.assign(this.settings, before); throw error; }
      if (!this.assetsStopped) this.refreshViews();
      this.settingTab?.refreshBalanceSummary();
    });
    this.assetQueue = operation.catch(() => {});
    return operation;
  }

  updateSalaryCycle(change: { salaryCents?: number; note?: string }, now = new Date()): Promise<void> {
    const operation = this.assetQueue.then(async () => {
      if (this.assetsStopped) throw new Error("插件已关闭，请重新打开");
      const before = { ...this.currentSalaryState(), financeAdviceCache: this.settings.financeAdviceCache };
      if (change.salaryCents !== undefined && (!Number.isSafeInteger(change.salaryCents) || change.salaryCents < 0)) throw new Error("工资金额无效");
      this.syncSalaryCycles(now);
      if (change.salaryCents !== undefined) {
        this.settings.salaryCents = change.salaryCents;
        this.settings.financeAdviceCache = null;
      }
      if (change.note !== undefined) this.settings.balanceCalibrationNote = change.note;
      try { await this.saveSettings(false, false, now); }
      catch (error) { Object.assign(this.settings, before); throw error; }
      if (!this.assetsStopped) this.refreshViews();
      this.settingTab?.refreshBalanceSummary();
    });
    this.assetQueue = operation.catch(() => {});
    return operation;
  }

  updateAssets(change: (state: AssetState) => void): Promise<void> {
    const operation = this.assetQueue.then(async () => {
      if (this.assetsStopped) throw new Error("插件已关闭，请重新打开资产页");
      const before = this.settings.assets, next = JSON.parse(JSON.stringify(before)) as AssetState;
      change(next);
      storeAssetSnapshot(next, buildAssetSnapshot(next, flattenRecords(this.repository.files.values())));
      // Unrelated vault renames also reach asset-link maintenance. A no-op must
      // not write data.json and feed another sync event or rebuild every view.
      if (jsonDataEqual(next, before)) return;
      this.settings.assets = next;
      try { await this.saveSettings(false, false); }
      catch (error) { this.settings.assets = before; throw error; }
      if (!this.assetsStopped) this.refreshViews();
    });
    this.assetQueue = operation.catch(() => {});
    return operation;
  }

  private captureAssetSnapshot(): Promise<void> {
    if (!this.repository?.loaded || !this.settings.assets.accounts.length || this.assetsStopped) return Promise.resolve();
    const snapshot = this.assetSnapshot(), clone = JSON.parse(JSON.stringify(this.settings.assets)) as AssetState;
    if (!storeAssetSnapshot(clone, snapshot)) return Promise.resolve();
    return this.updateAssets(() => {});
  }

  private async activateView(assets = false): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: LEDGER_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (assets && leaf.view instanceof LedgerStatisticsView) leaf.view.showAssets();
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof LedgerStatisticsView) view.requestRender();
    }
  }
}
