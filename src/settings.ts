import { App, PluginSettingTab, Setting } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import { parseMoneyToCents } from "./core";

export type LedgerViewId = "overview" | "category" | "trend" | "calendar" | "details" | "compare";

export interface LedgerSettings {
  ledgerFolder: string;
  defaultView: LedgerViewId;
  excludedCategories: string[];
  dailyBudgetCents: number;
  barkUrl: string;
  lastBudgetNotificationDate: string;
}

export const DEFAULT_SETTINGS: LedgerSettings = {
  ledgerFolder: "记账",
  defaultView: "overview",
  excludedCategories: ["债务/还款"],
  dailyBudgetCents: 0,
  barkUrl: "",
  lastBudgetNotificationDate: ""
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

    new Setting(this.containerEl)
      .setName("每日预算")
      .setDesc("总览中的今日预算会统计全部分类，包括债务/还款。留空可关闭，最多保留两位小数。")
      .addText((text) => {
        text
          .setPlaceholder("例如 100")
          .setValue(this.budgetValue())
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              this.plugin.settings.dailyBudgetCents = 0;
              await this.plugin.saveSettings(false);
              return;
            }
            const cents = parseMoneyToCents(trimmed);
            if (cents === null || cents < 0) return;
            this.plugin.settings.dailyBudgetCents = cents;
            await this.plugin.saveSettings(false);
          });
        text.inputEl.setAttribute("inputmode", "decimal");
        return text;
      });

    new Setting(this.containerEl)
      .setName("Bark 推送地址")
      .setDesc("粘贴 Bark 地址，例如 https://api.day.app/你的Key；达到或超过今日预算时每天提醒一次。地址只保存在本地，不会上传 GitHub。")
      .addText((text) => {
        text
          .setPlaceholder("https://api.day.app/你的Key")
          .setValue(this.plugin.settings.barkUrl)
          .onChange(async (value) => {
            this.plugin.settings.barkUrl = value.trim();
            this.plugin.settings.lastBudgetNotificationDate = "";
            await this.plugin.saveSettings(false);
          });
        text.inputEl.type = "password";
        text.inputEl.setAttribute("autocomplete", "off");
        return text;
      });

    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "插件不会修改账目。正文逐笔记录是统计来源，frontmatter total 仅用于核对。"
    });
  }

  private budgetValue(): string {
    const cents = this.plugin.settings.dailyBudgetCents;
    if (!Number.isFinite(cents) || cents <= 0) return "";
    return (cents / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }
}
