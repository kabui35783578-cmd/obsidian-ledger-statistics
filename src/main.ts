import { Plugin } from "obsidian";
import { LedgerRepository } from "./repository";
import { DEFAULT_SETTINGS, LedgerSettingTab, LedgerSettings } from "./settings";
import { LedgerStatisticsView, LEDGER_VIEW_TYPE } from "./view";

export default class LedgerStatisticsPlugin extends Plugin {
  settings: LedgerSettings = DEFAULT_SETTINGS;
  repository!: LedgerRepository;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<LedgerSettings> | null);
    this.repository = new LedgerRepository(this.app, this.settings.ledgerFolder, () => this.refreshViews());
    this.registerView(LEDGER_VIEW_TYPE, (leaf) => new LedgerStatisticsView(leaf, this));
    this.addRibbonIcon("chart-pie", "打开记账统计", () => void this.activateView());
    this.addCommand({ id: "open-ledger-statistics", name: "打开记账统计", callback: () => void this.activateView() });
    this.addSettingTab(new LedgerSettingTab(this.app, this));
    await this.repository.start();
  }

  onunload(): void {
    this.repository.dispose();
  }

  async saveSettings(rescan: boolean, refresh = true): Promise<void> {
    await this.saveData(this.settings);
    if (rescan) await this.repository.setFolder(this.settings.ledgerFolder);
    if (refresh) this.refreshViews();
  }

  private async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: LEDGER_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof LedgerStatisticsView) view.requestRender();
    }
  }
}
