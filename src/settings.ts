import { App, PluginSettingTab, Setting } from "obsidian";
import type LedgerStatisticsPlugin from "./main";

export type LedgerViewId = "overview" | "category" | "trend" | "calendar" | "details" | "compare";

export interface LedgerSettings {
  ledgerFolder: string;
  defaultView: LedgerViewId;
  excludedCategories: string[];
}

export const DEFAULT_SETTINGS: LedgerSettings = {
  ledgerFolder: "记账",
  defaultView: "overview",
  excludedCategories: ["债务/还款"]
};

const VIEW_NAMES: Record<LedgerViewId, string> = {
  overview: "总览",
  category: "分类",
  trend: "趋势",
  calendar: "日历",
  details: "明细",
  compare: "对比"
};

export class LedgerSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: LedgerStatisticsPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "记账统计设置" });

    new Setting(this.containerEl)
      .setName("记账文件夹")
      .setDesc("仓库根目录下的相对路径。插件只读取其中的 Markdown 文件。")
      .addText((text) => text
        .setPlaceholder("记账")
        .setValue(this.plugin.settings.ledgerFolder)
        .onChange(async (value) => {
          this.plugin.settings.ledgerFolder = value.trim().replace(/^\/+|\/+$/g, "") || "记账";
          await this.plugin.saveSettings(true);
        }));

    new Setting(this.containerEl)
      .setName("默认视图")
      .setDesc("首次打开统计面板时显示的页面。")
      .addDropdown((dropdown) => {
        for (const [id, name] of Object.entries(VIEW_NAMES)) dropdown.addOption(id, name);
        dropdown.setValue(this.plugin.settings.defaultView).onChange(async (value) => {
          this.plugin.settings.defaultView = value as LedgerViewId;
          await this.plugin.saveSettings(false);
        });
      });

    new Setting(this.containerEl)
      .setName("消费口径排除分类")
      .setDesc("以中文逗号或英文逗号分隔。‘全部支出’口径不会排除这些分类。")
      .addTextArea((text) => text
        .setPlaceholder("债务/还款")
        .setValue(this.plugin.settings.excludedCategories.join("，"))
        .onChange(async (value) => {
          this.plugin.settings.excludedCategories = [...new Set(value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))];
          await this.plugin.saveSettings(false);
        }));

    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "插件不会修改账目。正文逐笔记录是统计来源，frontmatter total 仅用于核对。"
    });
  }
}
