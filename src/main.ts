import { Notice, Plugin, requestUrl } from "obsidian";
import { BudgetMonitor } from "./budget-monitor";
import { sharedRequestGate } from "./request-gate";
import { flattenRecords, migrateStarredIds, renameStarredIds } from "./core";
import { LedgerRepository } from "./repository";
import { isBalanceCalibration } from "./balance";
import { DEFAULT_SETTINGS, LedgerSettingTab, LedgerSettings } from "./settings";
import { LedgerStatisticsView, LEDGER_VIEW_TYPE } from "./view";
import { normalizeReportPreferences } from "./report";
import { normalizeReportCaches } from "./report-ai";
import { AssetSnapshot, AssetState, buildAssetSnapshot, normalizeAssets, quoteKey, renameAssetLinks, storeAssetSnapshot } from "./assets";
import { AssetQuoteMonitor } from "./asset-quotes";

export default class LedgerStatisticsPlugin extends Plugin {
  settings: LedgerSettings = DEFAULT_SETTINGS;
  repository!: LedgerRepository;
  private budgetMonitor!: BudgetMonitor;
  private settingTab?: LedgerSettingTab;
  private saveQueue: Promise<void> = Promise.resolve();
  private assetQueue: Promise<void> = Promise.resolve();
  private assetQuotes!: AssetQuoteMonitor;
  private assetsStopped = false;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<LedgerSettings> | null);
    this.settings.assets = normalizeAssets(this.settings.assets);
    this.assetsStopped = false;
    this.assetQuotes = new AssetQuoteMonitor(() => this.settings.assets, async url => {
      const response = await requestUrl({ url, method: "GET", throw: true });
      return { text: response.text, arrayBuffer: response.arrayBuffer };
    }, quotes => this.updateAssets(state => {
      const held = new Set(state.holdings.map(h => quoteKey(h.kind, h.code)));
      for (const quote of quotes) if (held.has(quote.key)) {
        state.quotes[quote.key] = quote;
        if (!quote.error) for (const h of state.holdings) if (quoteKey(h.kind, h.code) === quote.key && h.name === h.code) h.name = quote.name;
      }
    }));
    this.settings.reportPreferences = normalizeReportPreferences(this.settings.reportPreferences);
    this.settings.reportCaches = normalizeReportCaches(this.settings.reportCaches);
    if (typeof this.settings.reportObjectRules !== "string") this.settings.reportObjectRules = DEFAULT_SETTINGS.reportObjectRules;
    this.settings.fixedExpenses = Array.isArray(this.settings.fixedExpenses) ? this.settings.fixedExpenses.filter((item) => item && typeof item.name === "string" && typeof item.id === "string" && item.payments && typeof item.payments === "object") : [];
    this.settings.insightHistory = Array.isArray(this.settings.insightHistory) ? this.settings.insightHistory.filter((item) => item && typeof item.id === "string" && typeof item.cycle === "string" && typeof item.date === "string" && Number.isFinite(item.impact)) : [];
    if (!isBalanceCalibration(this.settings.balanceCalibration)) this.settings.balanceCalibration = null;
    if (typeof this.settings.balanceCalibrationNote !== "string") this.settings.balanceCalibrationNote = "";
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
    void this.refreshAssetQuotes().catch(() => {});
  }

  onunload(): void {
    this.assetsStopped = true;
    this.assetQuotes?.stop();
    this.budgetMonitor?.stop();
    for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
      if (leaf.view instanceof LedgerStatisticsView) leaf.view.cancelFinanceRequest();
    }
    this.repository.dispose();
  }

  async saveSettings(rescan: boolean, refresh = true): Promise<void> {
    const data = JSON.parse(JSON.stringify(this.settings));
    const saved = this.saveQueue.then(() => this.saveData(data));
    this.saveQueue = saved.catch(() => {});
    await saved;
    if (rescan) await this.repository.setFolder(this.settings.ledgerFolder);
    if (refresh) this.refreshViews();
    this.checkBudget();
  }

  private checkBudget(): void {
    if (this.repository?.loaded) void this.budgetMonitor.check([...this.repository.files.values()]);
  }

  private tick(): void {
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

  refreshAssetQuotes(force = false): Promise<void> { return this.assetQuotes.refresh(force); }

  refreshAssetViews(): void { this.refreshViews(); }

  updateAssets(change: (state: AssetState) => void): Promise<void> {
    const operation = this.assetQueue.then(async () => {
      if (this.assetsStopped) return;
      const before = this.settings.assets, next = JSON.parse(JSON.stringify(before)) as AssetState;
      change(next);
      storeAssetSnapshot(next, buildAssetSnapshot(next, flattenRecords(this.repository.files.values())));
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
