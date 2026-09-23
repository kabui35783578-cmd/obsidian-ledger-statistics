import { App, PluginSettingTab, Setting } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import { flattenRecords, formatCents, parseMoneyToCents, salaryDayRange } from "./core";
import { BalanceCalibration, balanceStatus, createBalanceCalibration } from "./balance";
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
  balanceCalibration: BalanceCalibration | null;
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
  balanceCalibration: null,
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

type SettingsSection = "ledger" | "salary" | "balance" | "ai" | "budget";

const SETTINGS_SECTIONS: { id: SettingsSection; label: string; description: string }[] = [
  { id: "ledger", label: "账本与显示", description: "账本来源、统计口径、默认视图与星标核对。" },
  { id: "salary", label: "工资周期", description: "管理固定支出及其周期末参考。" },
  { id: "balance", label: "余额校准", description: "按实际余额校准本周期剩余金额，并查看账面与实际的净差额。" },
  { id: "ai", label: "AI 洞察", description: "控制洞察判断及其接口连接。使用前需在“余额校准”设置到账工资。" },
  { id: "budget", label: "预算与提醒", description: "设置今日预算、统计范围与超额提醒。" }
];

export class LedgerSettingTab extends PluginSettingTab {
  private connectionController?: AbortController;
  private activeSection: SettingsSection = "ledger";
  private balanceSummaryRefresh?: () => void;
  hide(): void { this.connectionController?.abort(); this.balanceSummaryRefresh = undefined; }
  constructor(app: App, private plugin: LedgerStatisticsPlugin) {
    super(app, plugin);
  }

  refreshBalanceSummary(): void { this.balanceSummaryRefresh?.(); }

  display(): void {
    this.connectionController?.abort();
    this.containerEl.empty();
    this.containerEl.addClass("ledger-settings");
    this.containerEl.createEl("h2", { text: "记账统计设置" });
    this.containerEl.createEl("p", { cls: "ledger-settings-intro", text: "按主题查找设置。切换主题不会改动已保存的内容。" });

    const navigation = this.containerEl.createDiv({ cls: "ledger-settings-navigation" });
    navigation.setAttribute("aria-label", "设置主题");
    const panels = new Map<SettingsSection, HTMLElement>();
    const buttons = new Map<SettingsSection, HTMLButtonElement>();
    for (const section of SETTINGS_SECTIONS) {
      const button = navigation.createEl("button", { cls: "ledger-settings-navigation-button", text: section.label });
      button.type = "button";
      button.setAttribute("aria-controls", `ledger-settings-${section.id}`);
      buttons.set(section.id, button);
      const panel = this.containerEl.createDiv({ cls: "ledger-settings-panel" });
      panel.id = `ledger-settings-${section.id}`;
      panel.createEl("h3", { text: section.label });
      panel.createEl("p", { cls: "ledger-settings-panel-description", text: section.description });
      panels.set(section.id, panel);
      button.addEventListener("click", () => showSection(section.id));
    }
    const showSection = (section: SettingsSection): void => {
      this.activeSection = section;
      for (const [id, panel] of panels) panel.hidden = id !== section;
      for (const [id, button] of buttons) {
        button.setAttribute("aria-pressed", String(id === section));
        button.classList.toggle("is-active", id === section);
      }
    };
    showSection(this.activeSection);

    const ledgerPanel = panels.get("ledger")!;
    const salaryPanel = panels.get("salary")!;
    const balancePanel = panels.get("balance")!;
    const aiPanel = panels.get("ai")!;
    const budgetPanel = panels.get("budget")!;

    new Setting(ledgerPanel)
      .setName("记账文件夹")
      .setDesc("仓库根目录下的相对路径。插件只读取其中的 Markdown 文件。")
      .addText((text) => text
        .setPlaceholder("记账")
        .setValue(this.plugin.settings.ledgerFolder)
        .onChange(async (value) => {
          this.plugin.settings.ledgerFolder = value.trim().replace(/^\/+|\/+$/g, "") || "记账";
          await this.plugin.saveSettings(true);
        }));

    new Setting(ledgerPanel)
      .setName("默认视图")
      .setDesc("首次打开统计面板时显示的页面。")
      .addDropdown((dropdown) => {
        for (const [id, name] of Object.entries(VIEW_NAMES)) dropdown.addOption(id, name);
        dropdown.setValue(this.plugin.settings.defaultView).onChange(async (value) => {
          this.plugin.settings.defaultView = value as LedgerViewId;
          await this.plugin.saveSettings(false);
        });
      });

    new Setting(ledgerPanel)
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

    new Setting(ledgerPanel)
      .setName("消费口径排除分类")
      .setDesc("以中文逗号或英文逗号分隔。‘全部支出’口径不会排除这些分类。")
      .addTextArea((text) => text
        .setPlaceholder("债务/还款")
        .setValue(this.plugin.settings.excludedCategories.join("，"))
        .onChange(async (value) => {
          this.plugin.settings.excludedCategories = [...new Set(value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))];
          await this.plugin.saveSettings(false);
        }));

    let refreshBalanceSummary = (): void => {};
    new Setting(balancePanel)
      .setName("每个工资周期到账工资")
      .setDesc("工资日固定每月 15 日。填写实际到账金额；用于周期参考和洞察判断。余额校准不会改动此数。")
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
              refreshBalanceSummary();
              return;
            }
            const cents = parseMoneyToCents(trimmed);
            if (cents === null || cents < 0) return;
            this.plugin.settings.salaryCents = cents;
            this.plugin.settings.financeAdviceCache = null;
            await this.plugin.saveSettings(false);
            refreshBalanceSummary();
          });
        text.inputEl.setAttribute("inputmode", "decimal");
        return text;
      });

    const calibrationSetting = new Setting(balancePanel)
      .setName("校准当前余额")
      .setDesc("填写此刻实际还剩的金额，再点击“校准”。仅对当前工资周期生效；之后新发生的记账消费继续扣减。校准前的补记不会重复扣款。")
      .addText((text) => {
        text.setPlaceholder("例如 3500");
        text.inputEl.setAttribute("inputmode", "decimal");
        text.inputEl.setAttribute("aria-label", "当前实际余额");
        return text;
      });
    const calibrationInput = calibrationSetting.controlEl.querySelector("input")!;
    calibrationSetting.addButton((button) => button.setButtonText("校准余额").setCta().onClick(async () => {
      const cents = parseMoneyToCents(calibrationInput.value);
      if (cents === null) {
        calibrationSetting.setDesc("请输入有效的非负金额，最多两位小数；输入 0 也可以校准。");
        return;
      }
      this.plugin.settings.balanceCalibration = createBalanceCalibration(flattenRecords(this.plugin.repository.files.values()), new Date(), cents);
      await this.plugin.saveSettings(false);
      calibrationInput.value = "";
      calibrationSetting.setDesc("余额已校准。新记账消费继续扣减；校准前的补记不会重复扣款。");
      refreshBalanceSummary();
    }));
    calibrationSetting.addButton((button) => button.setButtonText("取消校准").onClick(async () => {
      this.plugin.settings.balanceCalibration = null;
      await this.plugin.saveSettings(false);
      calibrationInput.value = "";
      refreshBalanceSummary();
    }));

    const balanceSummary = balancePanel.createDiv({ cls: "ledger-balance-summary", attr: { "aria-live": "polite" } });
    refreshBalanceSummary = () => {
      balanceSummary.empty();
      const now = new Date();
      const cycle = salaryDayRange(now);
      const status = balanceStatus(flattenRecords(this.plugin.repository.files.values()), now, this.plugin.settings.salaryCents, this.plugin.settings.balanceCalibration);
      balanceSummary.createEl("strong", { text: `本周期 ${cycle.start} — ${cycle.end}` });
      const addRow = (label: string, amount: number) => {
        const row = balanceSummary.createDiv({ cls: "ledger-balance-summary-row" });
        row.createSpan({ text: label });
        row.createEl("strong", { text: formatCents(amount) });
      };
      addRow("到账工资", this.plugin.settings.salaryCents);
      addRow("已记账支出", status.recordedSpentCents);
      addRow(status.calibrated ? "当前余额 · 已校准" : "当前余额 · 账面推算", status.remainingCents);
      if (status.calibrated) {
        addRow("未记账净差额", status.unrecordedNetCents);
        balanceSummary.createEl("small", { text: status.unrecordedNetCents >= 0
          ? "正数表示实际余额低于账面推算；可能有未记录的支出等，并不等同于垫付。"
          : "负数表示实际余额高于账面推算；可能有其他收入或上期结余。" });
      } else {
        balanceSummary.createEl("small", { text: "尚未校准。当前余额只是工资减已记账支出的推算值；上次校准不会跨工资周期沿用。" });
      }
      balanceSummary.createEl("p", { text: "余额与差额仅用于对账，不进入消费异常、历史均值或 AI 判断。校准后补记较早交易不会二次扣款；如有未记账资金变化，请再次校准。" });
    };
    refreshBalanceSummary();
    this.balanceSummaryRefresh = refreshBalanceSummary;

    new Setting(salaryPanel).setName("固定支出")
      .setDesc("手动确认本周期及前两个周期的支付记录，减少付款日期变化对预测的影响。")
      .addButton((button) => button.setButtonText("管理固定支出").onClick(() => new FixedExpenseModal(this.plugin).open()));
    new Setting(ledgerPanel).setName("星标核对")
      .setDesc("检查修改、删除或离线移动后无法匹配的星标。")
      .addButton((button) => button.setButtonText("核对星标").onClick(() => new StarRepairModal(this.plugin).open()));

    new Setting(aiPanel)
      .setName("启用 AI 财务判断")
      .setDesc("发送汇总、候选事件、分类参考及有限交易备注，不发送账本文件、路径或完整原始行。有效判断跨日保留；重要变化或原判断失效时，在查看洞察时自动更新，也可手动刷新。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.financeAiEnabled)
        .onChange(async (value) => {
          this.plugin.settings.financeAiEnabled = value;
          await this.plugin.saveSettings(false);
          this.display();
        }));

    if (this.plugin.settings.financeAiEnabled) {
      new Setting(aiPanel)
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

      new Setting(aiPanel)
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

      new Setting(aiPanel)
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
      const test = new Setting(aiPanel).setName("测试 AI 连接")
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

    new Setting(budgetPanel)
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

    new Setting(budgetPanel)
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

    new Setting(budgetPanel)
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

    new Setting(budgetPanel)
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

    ledgerPanel.createEl("p", {
      cls: "ledger-settings-footnote",
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
