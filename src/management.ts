import { FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import { flattenRecords, formatCents, LedgerRecord, parseMoneyToCents, salaryCycleFullRange, salaryDayRange } from "./core";
import { relinkStar, unmatchedStarIds } from "./insights";

class RecordPicker extends FuzzySuggestModal<LedgerRecord> {
  constructor(private plugin: LedgerStatisticsPlugin, private choose: (record: LedgerRecord) => void, private range?: { start: string; end: string }) {
    super(plugin.app);
    this.setPlaceholder("搜索日期、分类、金额或备注");
  }
  getItems(): LedgerRecord[] {
    return flattenRecords(this.plugin.repository.files.values()).filter((r) => !this.range || (r.date >= this.range.start && r.date <= this.range.end));
  }
  getItemText(r: LedgerRecord): string { return `${r.date} ${r.time} · ${r.category} ${formatCents(r.cents)} · ${r.note}`; }
  onChooseItem(r: LedgerRecord): void { this.choose(r); }
}

export class FixedExpenseModal extends Modal {
  constructor(private plugin: LedgerStatisticsPlugin) { super(plugin.app); }
  onOpen(): void { this.render(); }
  private async save(): Promise<void> {
    this.plugin.settings.financeAdviceCache = null;
    await this.plugin.saveSettings(false);
  }
  private render(): void {
    const root = this.contentEl;
    root.empty(); root.addClass("ledger-management");
    root.createEl("h2", { text: "固定支出确认" });
    root.createEl("p", { text: "工资日固定为每月 15 日。关联实际账目只用于修正周期末参考，不新增、修改或扣减账目。每笔账目只能关联一个项目；分期付款请拆成多个项目。" });
    const records = flattenRecords(this.plugin.repository.files.values());
    const ranges = [salaryDayRange(new Date()), salaryCycleFullRange(new Date(), 1), salaryCycleFullRange(new Date(), 2)];
    for (const item of this.plugin.settings.fixedExpenses) {
      const box = root.createEl("details", { cls: "ledger-management-item" });
      box.open = true;
      box.createEl("summary", { text: item.name || "新固定支出" });
      new Setting(box).setName("名称").addText((text) => text.setValue(item.name).setPlaceholder("例如房租").onChange(async (value) => { item.name = value.trim(); await this.save(); }));
      new Setting(box).setName("本周期预计金额（元）").setDesc("未支付时使用；已支付时以关联账目为准。名称或金额未填写的项目暂不参与预测。")
        .addText((text) => {
          text.setPlaceholder("例如 1500").setValue(item.amountCents ? String(item.amountCents / 100) : "").onChange(async (value) => {
            const cents = value.trim() ? parseMoneyToCents(value) : 0;
            text.inputEl.setAttribute("aria-invalid", String(cents === null || cents < 0));
            if (cents === null || cents < 0) return;
            item.amountCents = cents; await this.save();
          });
          text.inputEl.inputMode = "decimal";
        });
      ranges.forEach((range, index) => {
        const id = item.payments[range.start] ?? "";
        const linked = records.find((record) => record.id === id);
        const title = index === 0 ? "本周期" : `前 ${index} 个周期`;
        const setting = new Setting(box).setName(`${title} · ${range.start}`)
          .setDesc(linked ? `${linked.date} · ${linked.category} · ${formatCents(linked.cents)}` : id.startsWith("ledger-v2:") ? "关联账目失效，请重新选择" : "请选择支付状态；历史记录仅用于从历史预测中排除已确认固定支出。");
        setting.addDropdown((dropdown) => {
          dropdown.addOption("", "待确认");
          if (index === 0) dropdown.addOption("unpaid", "尚未支付");
          dropdown.addOption("none", "此周期无需支付").addOption("link", "关联已支付账目…");
          dropdown.setValue(id && id !== "unpaid" && id !== "none" ? "link" : id);
          dropdown.onChange(async (value) => {
            if (value === "link") {
              new RecordPicker(this.plugin, (record) => {
                const duplicate = this.plugin.settings.fixedExpenses.some((other) => other.id !== item.id && Object.values(other.payments).includes(record.id));
                if (duplicate) { new Notice("这笔账目已关联其他固定支出，请勿重复关联"); return; }
                item.payments[range.start] = record.id;
                void this.save().then(() => this.render());
              }, range).open();
              dropdown.setValue(id && id !== "unpaid" && id !== "none" ? "link" : id);
            } else {
              if (value) item.payments[range.start] = value; else delete item.payments[range.start];
              await this.save(); this.render();
            }
          });
        });
        if (linked || id.startsWith("ledger-v2:")) setting.addButton((button) => button.setButtonText("重新关联").onClick(() => {
          new RecordPicker(this.plugin, (record) => { item.payments[range.start] = record.id; void this.save().then(() => this.render()); }, range).open();
        }));
      });
      new Setting(box).setName("移除此规则").setDesc("不删除原始账目。")
        .addButton((button) => button.setButtonText("移除").onClick(async () => {
          this.plugin.settings.fixedExpenses = this.plugin.settings.fixedExpenses.filter((other) => other.id !== item.id);
          await this.save(); this.render();
        }));
    }
    new Setting(root).addButton((button) => button.setButtonText("添加固定支出").setCta().onClick(async () => {
      this.plugin.settings.fixedExpenses = [...this.plugin.settings.fixedExpenses, { id: crypto.randomUUID(), name: "", amountCents: 0, payments: {} }];
      await this.save(); this.render();
    }));
  }
}

export class StarRepairModal extends Modal {
  constructor(private plugin: LedgerStatisticsPlugin) { super(plugin.app); }
  onOpen(): void { this.render(); }
  private render(): void {
    this.contentEl.empty(); this.contentEl.addClass("ledger-management");
    this.contentEl.createEl("h2", { text: "核对失效星标" });
    this.contentEl.createEl("p", { text: "账目修改、删除或离线移动后，旧星标可能无法匹配。请手动重新关联或移除星标；原始账目不会被修改。" });
    const records = flattenRecords(this.plugin.repository.files.values());
    const missing = unmatchedStarIds(this.plugin.settings.starredRecordIds, records);
    if (!missing.length) this.contentEl.createEl("p", { text: "所有星标均可匹配。" });
    for (const id of missing) {
      let label = id;
      try { const values = JSON.parse(id.slice(10)); label = `${values[1]} · ${values[3]} · ${formatCents(values[4])} · ${values[0]}`; } catch { /* Legacy ID remains visible for manual review. */ }
      new Setting(this.contentEl).setName(label).addButton((button) => button.setButtonText("重新关联").onClick(() => {
        new RecordPicker(this.plugin, (record) => {
          try { this.plugin.settings.starredRecordIds = relinkStar(this.plugin.settings.starredRecordIds, id, record.id, flattenRecords(this.plugin.repository.files.values())); }
          catch (error) { new Notice((error as Error).message); return; }
          void this.plugin.saveSettings(false).then(() => this.render());
        }).open();
      })).addButton((button) => button.setButtonText("移除星标").onClick(async () => {
        this.plugin.settings.starredRecordIds = this.plugin.settings.starredRecordIds.filter((value) => value !== id);
        await this.plugin.saveSettings(false); this.render();
      }));
    }
  }
}
