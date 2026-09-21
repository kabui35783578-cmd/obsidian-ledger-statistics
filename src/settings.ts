import { App, PluginSettingTab, Setting } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import { parseMoneyToCents } from "./core";
import type { FinanceAdviceCache } from "./ai";
import { testFinanceConnection } from "./ai";
import { sharedRequestGate } from "./request-gate";
import type { FixedExpense } from "./fixed-expenses";
import type { SeenInsight } from "./insights";
import { FixedExpenseModal, StarRepairModal } from "./management";

export type LedgerViewId = "overview" | "category" | "trend" | "calendar" | "details" | "compare";
export type DefaultDatePreset = "today" | "week" | "month" | "salary" | "year";

export interface LedgerSettings {
  fixedExpenses: FixedExpense[];
  insightHistory: SeenInsight[];
  ledgerFolder: string;
  defaultView: LedgerViewId;
  defaultDatePreset: DefaultDatePreset;
  excludedCategories: string[];
  salaryCents: number;
  financeAiEnabled: boolean;
  financeAiEndpoint: string;
  financeAiModel: string;
  financeAiApiKey: string;
  financeAdviceCache: FinanceAdviceCache | null;
  dailyBudgetCents: number;
  budgetCategory: string;
  includeStarredInBudget: boolean;
  starredRecordIds: string[];
  barkUrl: string;
  lastBudgetNotificationDate: string;
}

export const DEFAULT_SETTINGS: LedgerSettings = {
  fixedExpenses: [],
  insightHistory: [],
  ledgerFolder: "记账",
  defaultView: "overview",
  defaultDatePreset: "month",
  excludedCategories: ["债务/还款"],
  salaryCents: 0,
  financeAiEnabled: false,
  financeAiEndpoint: "https://api.openai.com/v1/chat/completions",
  financeAiModel: "",
  financeAiApiKey: "",
  financeAdviceCache: null,
  dailyBudgetCents: 0,
  budgetCategory: "",
  includeStarredInBudget: true,
  starredRecordIds: [],
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

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MIMO_CHAT_ENDPOINT = "https://api.xiaomimimo.com/v1/chat/completions";

export class LedgerSettingTab extends PluginSettingTab {
  private connectionController?: AbortController;
  hide(): void { this.connectionController?.abort(); }
  constructor(app: App, private plugin: LedgerStatisticsPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.connectionController?.abort();
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
      .setName("默认时间筛选")
      .setDesc("下次重新打开统计面板时使用的时间范围。当前周与当前工资周期均截止今天。")
      .addDropdown((dropdown) => dropdown
        .addOption("today", "今天")
        .addOption("week", "本周")
        .addOption("month", "本月")
        .addOption("salary", "工资日")
        .addOption("year", "今年")
        .setValue(this.plugin.settings.defaultDatePreset)
        .onChange(async (value) => {
          this.plugin.settings.defaultDatePreset = value as DefaultDatePreset;
          await this.plugin.saveSettings(false);
        }));

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
      .setName("每个工资周期到账工资")
      .setDesc("工资日固定每月 15 日。余额＝工资减本周期全部支出，不代表银行实际余额；数据保存在本地。")
      .addText((text) => {
        text
          .setPlaceholder("例如 8000")
          .setValue(this.moneyValue(this.plugin.settings.salaryCents))
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              this.plugin.settings.salaryCents = 0;
              this.plugin.settings.financeAdviceCache = null;
              await this.plugin.saveSettings(false);
              return;
            }
            const cents = parseMoneyToCents(trimmed);
            if (cents === null || cents < 0) return;
            this.plugin.settings.salaryCents = cents;
            this.plugin.settings.financeAdviceCache = null;
            await this.plugin.saveSettings(false);
          });
        text.inputEl.setAttribute("inputmode", "decimal");
        return text;
      });

    new Setting(this.containerEl).setName("固定支出")
      .setDesc("手动确认本周期及前两个周期的支付记录，减少付款日期变化对预测的影响。")
      .addButton((button) => button.setButtonText("管理固定支出").onClick(() => new FixedExpenseModal(this.plugin).open()));
    new Setting(this.containerEl).setName("星标核对")
      .setDesc("检查修改、删除或离线移动后无法匹配的星标。")
      .addButton((button) => button.setButtonText("核对星标").onClick(() => new StarRepairModal(this.plugin).open()));

    new Setting(this.containerEl)
      .setName("启用 AI 财务判断")
      .setDesc("只发送程序生成的汇总、候选事件和分类参考值，不发送账本文件、路径或消费备注。每天自动请求最多一次，也可在卡片中手动刷新。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.financeAiEnabled)
        .onChange(async (value) => {
          this.plugin.settings.financeAiEnabled = value;
          await this.plugin.saveSettings(false);
          this.display();
        }));

    if (this.plugin.settings.financeAiEnabled) {
      new Setting(this.containerEl)
        .setName("AI 接口地址")
        .setDesc("兼容 OpenAI Chat Completions 的完整接口地址；非本机地址必须使用 HTTPS。")
        .addText((text) => text
          .setPlaceholder("https://api.openai.com/v1/chat/completions")
          .setValue(this.plugin.settings.financeAiEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.financeAiEndpoint = value.trim();
            this.plugin.settings.financeAdviceCache = null;
            await this.plugin.saveSettings(false);
          }));

      new Setting(this.containerEl)
        .setName("AI 模型")
        .setDesc("填写接口服务商提供的模型名称。")
        .addText((text) => text
          .setPlaceholder("例如服务商提供的模型 ID")
          .setValue(this.plugin.settings.financeAiModel)
          .onChange(async (value) => {
            this.plugin.settings.financeAiModel = value.trim();
            if (/^mimo-/i.test(this.plugin.settings.financeAiModel)) {
              try {
                if (new URL(this.plugin.settings.financeAiEndpoint).hostname === "api.openai.com") {
                  this.plugin.settings.financeAiEndpoint = MIMO_CHAT_ENDPOINT;
                }
              } catch {
                if (this.plugin.settings.financeAiEndpoint === OPENAI_CHAT_ENDPOINT) this.plugin.settings.financeAiEndpoint = MIMO_CHAT_ENDPOINT;
              }
            }
            this.plugin.settings.financeAdviceCache = null;
            await this.plugin.saveSettings(false);
          }));

      new Setting(this.containerEl)
        .setName("AI API Key")
        .setDesc("仅保存在本地 data.json，不会上传 GitHub；本机免密接口可以留空。")
        .addText((text) => {
          text
            .setPlaceholder("sk-…")
            .setValue(this.plugin.settings.financeAiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.financeAiApiKey = value.trim();
              this.plugin.settings.financeAdviceCache = null;
              await this.plugin.saveSettings(false);
            });
          text.inputEl.type = "password";
          text.inputEl.setAttribute("autocomplete", "off");
          return text;
        });
      const test = new Setting(this.containerEl).setName("测试 AI 连接")
        .setDesc("只发送简短测试消息，不发送账目；可能产生少量模型调用费用。");
      test.descEl.setAttribute("aria-live", "polite");
      test.addButton((button) => button.setButtonText("测试连接").onClick(async () => {
        const controller = new AbortController(); this.connectionController = controller;
        const config = { endpoint: this.plugin.settings.financeAiEndpoint, model: this.plugin.settings.financeAiModel, apiKey: this.plugin.settings.financeAiApiKey };
        button.setDisabled(true).setButtonText("正在测试…");
        test.setDesc("正在等待接口响应，最长等待 60 秒…");
        try {
          await testFinanceConnection(config, controller.signal, sharedRequestGate(`ai:${this.app.vault.getName()}`));
          if (!controller.signal.aborted) test.setDesc(config.endpoint === this.plugin.settings.financeAiEndpoint && config.model === this.plugin.settings.financeAiModel && config.apiKey === this.plugin.settings.financeAiApiKey ? "连接成功：模型已返回有效内容。" : "配置已变化，请重新测试。");
        } catch (error) {
          if (!controller.signal.aborted) test.setDesc(error instanceof Error ? error.message : "连接失败，请检查网络与接口配置");
        } finally { if (!controller.signal.aborted) button.setDisabled(false).setButtonText("测试连接"); }
      }));
    }

    new Setting(this.containerEl)
      .setName("每日预算")
      .setDesc("总览中的今日预算按下方预算分类统计。留空可关闭，最多保留两位小数。")
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
      .setName("预算分类")
      .setDesc("默认统计全部分类；选择后，今日预算、当前支出和 Bark 提醒只统计该分类。")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "全部分类");
        const categories = this.budgetCategories();
        for (const category of categories) dropdown.addOption(category, category);
        const current = this.plugin.settings.budgetCategory;
        if (current && !categories.includes(current)) dropdown.addOption(current, `${current}（当前无记录）`);
        dropdown.setValue(current).onChange(async (value) => {
          this.plugin.settings.budgetCategory = value;
          this.plugin.settings.lastBudgetNotificationDate = "";
          await this.plugin.saveSettings(false);
        });
      });

    new Setting(this.containerEl)
      .setName("今日预算星标口径")
      .setDesc("控制今日已花、当前工资周期支出和 Bark 提醒是否统计已标星记录。")
      .addDropdown((dropdown) => dropdown
        .addOption("include", "包含星标支出")
        .addOption("exclude", "不包含星标支出")
        .setValue(this.plugin.settings.includeStarredInBudget ? "include" : "exclude")
        .onChange(async (value) => {
          this.plugin.settings.includeStarredInBudget = value === "include";
          this.plugin.settings.lastBudgetNotificationDate = "";
          await this.plugin.saveSettings(false);
        }));

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
    return this.moneyValue(this.plugin.settings.dailyBudgetCents);
  }

  private moneyValue(cents: number): string {
    if (!Number.isFinite(cents) || cents <= 0) return "";
    return (cents / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  private budgetCategories(): string[] {
    return [...new Set([...this.plugin.repository.files.values()]
      .flatMap((file) => file.records.map((record) => record.category)))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  }
}
