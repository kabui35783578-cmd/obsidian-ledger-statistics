import { Modal, Notice } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import { LedgerRecord, flattenRecords, formatCents, isoFromDate } from "./core";
import { ASSET_NAMES, AssetAccount, AssetEvent, AssetEventKind, AssetHolding, AssetKind, AssetSnapshot, SecurityKind, addAmountHolding, addAssetEvent, assetId, assetTotals, baselineRecordIds, calibrateAccount, decimal, knownRecord, linkRecord, moneyCents, normalizeCode, previousMonthSnapshot, quantityFromAmount, setDefaultCash } from "./assets";
import { renderAssetAllocation, renderAssetSankey } from "./asset-charts";

function button(parent: HTMLElement, text: string, action: () => void, primary = false): HTMLButtonElement {
  const node = parent.createEl("button", { cls: `ledger-button${primary ? " ledger-assets-primary" : ""}`, text });
  node.type = "button"; node.addEventListener("click", action); return node;
}
function input(parent: HTMLElement, name: string, value = "", type = "text", hint = ""): HTMLInputElement {
  const label = parent.createEl("label", { cls: "ledger-assets-field" }); label.createSpan({ text: name });
  const node = label.createEl("input", { type, value }); node.setAttribute("aria-label", name);
  if (hint) label.createEl("small", { text: hint }); return node;
}
function select(parent: HTMLElement, name: string, choices: Array<[string, string]>, value = ""): HTMLSelectElement {
  const label = parent.createEl("label", { cls: "ledger-assets-field" }); label.createSpan({ text: name });
  const node = label.createEl("select"); node.setAttribute("aria-label", name);
  for (const [key, text] of choices) node.createEl("option", { value: key, text });
  if (value) node.value = value; return node;
}
class AssetFormModal extends Modal {
  constructor(plugin: LedgerStatisticsPlugin, private title: string, private build: (body: HTMLElement) => () => Promise<void>) { super(plugin.app); }
  onOpen(): void {
    this.modalEl.addClass("ledger-assets-modal"); this.setTitle(this.title);
    const body = this.contentEl.createEl("form", { cls: "ledger-assets-form" });
    const submit = this.build(body), error = body.createDiv({ cls: "ledger-assets-form-error", attr: { role: "alert" } });
    const controls = body.createDiv({ cls: "ledger-assets-actions" });
    const save = controls.createEl("button", { cls: "ledger-button ledger-assets-primary", text: "保存" }); save.type = "submit";
    button(controls, "取消", () => this.close());
    body.addEventListener("submit", event => {
      event.preventDefault(); if (save.disabled) return; save.disabled = true; save.setText("保存中…"); error.setText("");
      void submit().then(() => { this.close(); new Notice("资产已保存"); }).catch(reason => { error.setText(reason instanceof Error ? reason.message : "保存失败，请重试"); save.disabled = false; save.setText("保存"); });
    });
  }
  onClose(): void { this.contentEl.empty(); }
}
export class AssetPanel {
  private expanded = new Set<string>();
  constructor(private plugin: LedgerStatisticsPlugin) {}
  private records(): LedgerRecord[] { return flattenRecords(this.plugin.repository.files.values()); }
  render(parent: HTMLElement): void {
    const state = this.plugin.settings.assets, snapshot = this.plugin.assetSnapshot(), totals = assetTotals(snapshot, state.excludeFixed);
    const money = (cents: number): string => state.hideAmounts ? "••••" : formatCents(cents);
    const root = parent.createDiv({ cls: "ledger-assets" }), top = root.createDiv({ cls: "ledger-assets-title-row" });
    top.createEl("h2", { text: "我的资产" });
    const actions = top.createDiv({ cls: "ledger-assets-actions" });
    button(actions, "添加账户", () => this.accountForm(), true);
    button(actions, "添加持仓", () => this.holdingForm());
    const refresh = button(actions, "刷新行情", () => {
      refresh.disabled = true;
      void this.plugin.refreshAssetQuotes(true).catch(e => new Notice(e instanceof Error ? e.message : "行情刷新失败")).finally(() => { refresh.disabled = false; });
    });
    const hero = root.createDiv({ cls: "ledger-assets-hero" }), caption = hero.createDiv({ cls: "ledger-assets-caption" });
    caption.createSpan({ text: totals.missing ? "已估值资产（元）· 估值不完整" : "总资产（元）" });
    button(caption, state.hideAmounts ? "显示金额" : "隐藏金额", () => void this.save(s => { s.hideAmounts = !s.hideAmounts; }).catch(e => new Notice(String(e))));
    const toggle = caption.createEl("label", { cls: "ledger-assets-toggle" }); toggle.createSpan({ text: "排除固定资产" });
    const check = toggle.createEl("input", { type: "checkbox" }); check.checked = state.excludeFixed;
    check.addEventListener("change", () => void this.save(s => { s.excludeFixed = check.checked; }).catch(e => new Notice(String(e))));
    hero.createDiv({ cls: "ledger-assets-total", text: state.hideAmounts ? "••••" : formatCents(totals.assetsCents).replace("¥", "") });
    const latest = [...snapshot.accounts.flatMap(a => a.holdings.filter(h => h.valueCents !== null && h.quote && decimal(h.quote.price).gt(0)).map(h => h.quote?.asOf).filter((v): v is string => !!v))].sort().reverse()[0];
    hero.createDiv({ cls: "ledger-assets-updated", text: latest ? `行情 ${latest.replace("T", " ").slice(0, 16)}` : "当前余额" });
    const metrics = hero.createDiv({ cls: "ledger-assets-metrics" });
    metrics.createSpan({ text: `净资产 ${money(totals.netCents)}` }); metrics.createSpan({ text: `总负债 ${money(totals.liabilitiesCents)}` });
    metrics.createSpan({ text: `负债率 ${state.hideAmounts ? "••••" : totals.assetsCents > 0 ? `${(totals.liabilitiesCents / totals.assetsCents * 100).toFixed(2)}%` : "—"}` });
    this.renderComparison(hero, snapshot);
    if (snapshot.pending.length) {
      const warning = root.createDiv({ cls: "ledger-assets-warning" }); warning.createEl("strong", { text: "有资金变动待核对" });
      const details = warning.createEl("details"); details.createEl("summary", { text: `${snapshot.pending.length}项待核对` });
      for (const text of snapshot.pending) details.createEl("p", { text: state.hideAmounts ? "流水待核对" : text });
      button(warning, "核对流水", () => this.reviewForm()); button(warning, "核对交易关联", () => this.linkForm());
    }
    const card = root.createDiv({ cls: "ledger-assets-card" }), heading = card.createDiv({ cls: "ledger-assets-title-row" });
    heading.createEl("h3", { text: "资产组成" });
    button(heading, "放大查看", () => this.sankeyModal(snapshot));
    renderAssetAllocation(card, snapshot, state.excludeFixed, state.hideAmounts);
    const list = root.createDiv({ cls: "ledger-assets-card" });
    const listHeader = list.createDiv({ cls: "ledger-assets-title-row" }); listHeader.createEl("h3", { text: "账户与持仓" });

    if (!state.accounts.length) list.createEl("p", { text: "添加账户，开始查看资产。" });
    for (const account of snapshot.accounts) {
      const row = list.createDiv({ cls: "ledger-assets-account" });
      const info = row.createDiv(); info.createEl("strong", { text: account.name });
      info.createEl("small", { text: `${ASSET_NAMES[account.kind]}${account.id === state.defaultCashId ? " · 默认消费扣款" : ""}${account.missing ? " · 含未估值持仓" : ""}` });
      row.createEl("strong", { text: money(account.cents) }); button(row, "管理", () => this.accountDetails(account.id));
      const holdingList = account.holdings.length ? list.createEl("details", { cls: "ledger-assets-holding-list" }) : null;
      holdingList?.createEl("summary", { text: `${account.holdings.length}项持仓` });
      for (const holding of account.holdings) {
        const detail = holdingList!.createDiv({ cls: "ledger-assets-holding" });
        detail.createEl("strong", { text: holding.name });
        detail.createSpan({ text: `${holding.code}${holding.amountBasisCents !== undefined ? " · 参考份额" : ""} · ${state.hideAmounts ? "••••" : holding.amountBasisCents !== undefined && holding.quantity === "0" ? "待换算" : decimal(holding.quantity).toDecimalPlaces(2).toFixed()} ${holding.kind === "stock" ? "股" : "份"}` });
        detail.createSpan({ text: holding.valueCents === null ? "未估值" : money(holding.valueCents) });
        if (holding.valueCents !== null) detail.createEl("small", { text: `${holding.amountBasisCents !== undefined ? "录入后变化" : "持仓盈亏"} ${money(holding.valueCents - holding.costCents)}` });
        detail.createEl("small", { text: holding.quote && decimal(holding.quote.price).gt(0) ? `行情 ${holding.quote.asOf.replace("T", " ").slice(0, 19)}${holding.quote.error ? " · 更新失败，保留上次值" : ""}` : holding.quote?.error || (holding.amountBasisCents !== undefined ? "按录入金额显示 · 等待行情" : "等待行情") });
        button(detail, "核对持仓", () => this.holdingCorrection(holding));
      }
    }
    const tools = root.createEl("details", { cls: "ledger-assets-card" }); tools.createEl("summary", { text: "资产管理" });
    const toolsActions = tools.createDiv({ cls: "ledger-assets-actions" });
    button(toolsActions, "记录交易", () => this.eventForm()); button(toolsActions, "默认扣款账户", () => this.defaultForm()); button(toolsActions, "核对流水", () => this.reviewForm()); button(toolsActions, "交易关联", () => this.linkForm());
    tools.createEl("p", { cls: "ledger-assets-hint", text: "份额由当前金额和首次获取的行情估算。基金净值可能延迟；买卖前可在持仓详情核对平台实际份额与成本。" });
    const events = tools.createEl("details", { cls: "ledger-assets-card" }); events.createEl("summary", { text: `资产交易记录（${state.events.length}笔）` });
    for (const event of [...state.events].reverse().slice(0, 100)) events.createDiv({ cls: "ledger-assets-event-row", text: `${event.date} · ${event.note || EVENT_NAMES[event.kind]} · ${money(event.amountCents)}${event.link ? " · 已关联账本" : ""}` });

  }
  private save(change: (state: LedgerStatisticsPlugin["settings"]["assets"]) => void): Promise<void> { return this.plugin.updateAssets(change); }
  private renderComparison(parent: HTMLElement, current: AssetSnapshot): void {
    const state = this.plugin.settings.assets, previous = previousMonthSnapshot(state, current.date), card = parent.createDiv({ cls: "ledger-assets-comparison" });
    const title = card.createDiv({ cls: "ledger-assets-title-row" }); title.createSpan({ text: previous ? `相比 ${previous.date}` : "暂无可比记录" });
    button(title, "资产月历 ›", () => this.calendarModal());
    if (!previous) { return; }
    const before = assetTotals(previous, state.excludeFixed), after = assetTotals(current, state.excludeFixed);
    if (before.missing || after.missing) { card.createEl("p", { text: "本次或历史估值不完整，暂不判断资产增减。" }); return; }
    const delta = after.assetsCents - before.assetsCents, debt = after.liabilitiesCents - before.liabilitiesCents;
    const summary = card.createDiv({ cls: "ledger-assets-change-summary" });
    summary.createSpan({ text: `总资产 ${state.hideAmounts ? "••••" : `${delta >= 0 ? "+" : "−"}${formatCents(Math.abs(delta))}`}` });
    summary.createSpan({ text: `总负债 ${state.hideAmounts ? "••••" : debt === 0 ? "没有变化" : `${debt > 0 ? "+" : "−"}${formatCents(Math.abs(debt))}`}` });
    const values = (["cash", "fixed", "investment", "receivable", "liability"] as AssetKind[]).filter(k => !(state.excludeFixed && k === "fixed")).map(k => ({ kind: k, cents: after.groups[k] - before.groups[k] }));
    const maximum = Math.max(1, ...values.map(v => Math.abs(v.cents))), bars = card.createDiv({ cls: "ledger-assets-change-bars" });
    for (const v of values) {
      const column = bars.createDiv({ cls: "ledger-assets-change-column" });
      const compact = Math.abs(v.cents) >= 1000000 ? `${(Math.abs(v.cents) / 1000000).toFixed(2)}万` : formatCents(Math.abs(v.cents)).replace("¥", "");
      column.createEl("small", { cls: v.cents > 0 ? "is-up" : "is-down", text: state.hideAmounts ? "••••" : v.cents === 0 ? "没有变化" : `${v.cents > 0 ? "↑" : "↓"}${compact}` });
      const track = column.createDiv({ cls: "ledger-assets-change-track" }); const fill = track.createDiv({ cls: `ledger-assets-change-fill${v.cents < 0 ? " is-negative" : ""}` });
      fill.style.height = `${state.hideAmounts ? 0 : Math.abs(v.cents) / maximum * 100}%`; column.createEl("small", { text: ASSET_NAMES[v.kind] });
    }
  }
  private accountForm(existing?: AssetAccount): void {
    new AssetFormModal(this.plugin, existing ? "管理账户与余额核对" : "添加资产账户", body => {
      const name = input(body, "账户名称", existing?.name ?? "");
      const kind = select(body, "账户类别", Object.entries(ASSET_NAMES), existing?.kind ?? "cash"); kind.disabled = !!existing;
      const current = existing ? this.plugin.assetSnapshot().accounts.find(a => a.id === existing.id)! : null;
      const currentBalance = current ? current.cents - (existing?.kind === "investment" ? current.holdings.reduce((sum, h) => sum + (h.valueCents ?? 0), 0) : 0) : 0;
      const balance = input(body, "当前余额（元）", existing ? (currentBalance / 100).toFixed(2) : "0");
      const balanceLabel = balance.parentElement!.querySelector("span")!;
      const hint = body.createEl("small", { cls: "ledger-assets-hint" });
      const updateFields = (): void => {
        balanceLabel.setText(kind.value === "investment" ? "账户现金（元，不含持仓）" : kind.value === "liability" ? "尚欠金额（元）" : "当前余额／价值（元）");
        hint.setText(kind.value === "investment" ? "账户现金与持仓分别计算；基金、股票金额请用添加持仓。" : "按当前余额保存，之前的流水不重复扣款。");
      };
      kind.addEventListener("change", updateFields); updateFields();
      const useDefault = input(body, "设为默认消费扣款账户", "", "checkbox"); useDefault.checked = existing ? existing.id === this.plugin.settings.assets.defaultCashId : !this.plugin.settings.assets.defaultCashId;
      const updateDefault = (): void => { useDefault.parentElement!.hidden = kind.value !== "cash"; };
      kind.addEventListener("change", updateDefault); updateDefault();
      return async () => {
        if (!name.value.trim()) throw new Error("请填写账户名称");
        const now = new Date(), category = kind.value as AssetKind, cents = moneyCents(balance.value, category !== "liability");
        await this.save(state => {
          let account = existing && state.accounts.find(a => a.id === existing.id);
          if (account) { account.name = name.value.trim(); calibrateAccount(state, account.id, cents, this.records(), now); }
          else { account = { id: assetId(), name: name.value.trim(), kind: category, balanceCents: cents, baselineAt: now.toISOString(), includedRecordIds: baselineRecordIds(this.records(), now), includedEventIds: [] }; state.accounts.push(account); }
          if (category === "cash" && useDefault.checked) setDefaultCash(state, account.id, this.records(), existing ? new Date() : now);
        });
      };
    }).open();
  }
  private holdingForm(): void {
    const choices = this.plugin.settings.assets.accounts.filter(a => a.kind === "investment").map(a => [a.id, a.name] as [string, string]);
    if (!choices.length) { new Notice("请先添加一个投资理财账户"); this.accountForm(); return; }
    new AssetFormModal(this.plugin, "添加持仓", body => {
      const account = select(body, "投资账户", choices);
      if (choices.length === 1) account.parentElement!.hidden = true;
      const kind = select(body, "类型", [["fund", "基金"], ["stock", "股票"], ["etf", "ETF"]]);
      const code = input(body, "证券代码"), amount = input(body, "当前持仓金额（元）");
      amount.inputMode = "decimal";
      body.createEl("small", { cls: "ledger-assets-hint", text: "日期默认今天，名称与参考份额自动查询。行情更新前显示填写金额，之后显示估值变化。" });
      return async () => {
        await this.save(state => { addAmountHolding(state, account.value, kind.value as SecurityKind, code.value, amount.value); });
        void this.plugin.refreshAssetQuotes(true).catch(e => new Notice(e instanceof Error ? e.message : "行情更新失败，可稍后重试"));
      };
    }).open();
  }
  private holdingCorrection(holding: AssetHolding): void {
    new AssetFormModal(this.plugin, "核对持仓信息", body => {
      const name = input(body, "持仓名称", holding.name), code = input(body, "证券代码", holding.code), quantity = input(body, "当前实际总数量／份额", holding.quantity), cost = input(body, "剩余持仓总成本（元）", (holding.costCents / 100).toFixed(2));
      body.createEl("p", { text: "用于纠正初始录入、分红或拆分后的持仓。此操作不移动现金；实际买卖请使用记录交易。历史快照保留当时数据。" });
      return async () => {
        const normalized = normalizeCode(holding.kind, code.value), number = decimal(quantity.value);
        if (number.lt(0) || (holding.kind !== "fund" && !number.isInteger())) throw new Error("数量须为非负数，股票和ETF须为整数");
        const cents = moneyCents(cost.value);
        await this.save(s => { const h = s.holdings.find(h => h.id === holding.id); if (!h) throw new Error("持仓不存在"); h.name = name.value.trim() || normalized; h.code = normalized; h.quantity = number.toFixed(); h.costCents = cents; delete h.amountBasisCents; });
        void this.plugin.refreshAssetQuotes().catch(() => {});
      };
    }).open();
  }
  private eventForm(): void {
    const state = this.plugin.settings.assets;
    if (!state.accounts.length) { this.accountForm(); return; }
    new AssetFormModal(this.plugin, "记录资产交易", body => {
      const type = select(body, "交易类型", Object.entries(EVENT_NAMES));
      const account = select(body, "投资／转出／收入／负债账户", state.accounts.map(a => [a.id, `${a.name} · ${ASSET_NAMES[a.kind]}`]));
      const cash = select(body, "扣款／到账／转入现金账户", [["", "请选择"], ...state.accounts.filter(a => a.kind === "cash").map(a => [a.id, a.name] as [string, string])], state.defaultCashId);
      const holding = select(body, "持仓（买卖、分红或份额调整时必选）", [["", "请选择"], ...state.holdings.map(h => [h.id, `${h.name} · ${state.accounts.find(a => a.id === h.accountId)?.name}`] as [string, string])]);
      holding.addEventListener("change", () => { const h = state.holdings.find(h => h.id === holding.value); if (h) account.value = h.accountId; });
      const amount = input(body, "实际支付／到账金额（元，含费用；余额调整可负数）", "0");
      const fee = input(body, "手续费（元）", "0"), price = input(body, "成交价格／净值（买卖换算时填写）"), quantity = input(body, "实际成交数量／份额调整后的总数量");
      button(body, "换算成交数量", () => {
        try { const h = state.holdings.find(h => h.id === holding.value); if (!h) throw new Error("请选择持仓"); quantity.value = quantityFromAmount(moneyCents(amount.value), moneyCents(fee.value), price.value, h.kind, type.value === "sell"); }
        catch (e) { new Notice(e instanceof Error ? e.message : "换算失败"); }
      });
      const date = input(body, "确认日期", isoFromDate(new Date()), "date"), note = input(body, "备注");
      const links = this.records().slice().sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
      const linked = select(body, "关联已记账流水（避免重复扣款）", [["", "不关联"], ...links.map(r => [r.id, `${r.date} ${r.time} ${formatCents(r.cents)} ${r.note || r.category}`] as [string, string])]);
      body.createEl("p", { cls: "ledger-assets-hint", text: "买卖按实际确认份额登记。转账金额为到账金额，转出另扣费用；卖出金额为实际到账金额。还款金额为减少的负债本金，费用另扣现金。红利再投资只增加确认份额；份额调整用于拆分或核对，不改现金及持仓成本。关联后该笔消费由资产交易扣款。" });
      const confirmed = input(body, "已确认成交数量与实际金额", "", "checkbox");
      return async () => {
        if (!confirmed.checked) throw new Error("请确认这笔资金变动已发生");
        const kind = type.value as AssetEventKind;
        const event: AssetEvent = { id: assetId(), kind, date: date.value, createdAt: new Date().toISOString(), accountId: account.value, cashAccountId: cash.value || undefined, holdingId: holding.value || undefined, amountCents: moneyCents(amount.value, kind === "adjust"), feeCents: moneyCents(fee.value), quantity: quantity.value || undefined, price: price.value || undefined, note: note.value.trim(), link: linked.value ? linkRecord(links.find(r => r.id === linked.value)!) : undefined };
        if (event.link && !["buy", "transfer", "repay"].includes(kind)) throw new Error("账本是支出流水，只有买入、转账或还款可关联；其他类型请取消关联");
        if (["quantity", "reinvest"].includes(kind) && (event.amountCents !== 0 || event.feeCents !== 0)) throw new Error("份额调整与红利再投资不移动现金，请将金额和费用填为0");
        await this.save(s => { addAssetEvent(s, event); }); void this.plugin.refreshAssetQuotes().catch(() => {});
      };
    }).open();
  }
  private defaultForm(): void {
    const accounts = this.plugin.settings.assets.accounts.filter(a => a.kind === "cash");
    if (!accounts.length) { this.accountForm(); return; }
    new AssetFormModal(this.plugin, "默认消费扣款账户", body => {
      const account = select(body, "现金账户", accounts.map(a => [a.id, a.name]), this.plugin.settings.assets.defaultCashId);
      body.createEl("p", { text: "切换从当前时点生效，已发生的历史消费留在原账户。之后所有已记账支出默认扣此账户，与消费页面的筛选无关。" });
      return () => this.save(s => setDefaultCash(s, account.value, this.records(), new Date()));
    }).open();
  }
  private reviewForm(): void {
    const records = this.records().slice().sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    if (!records.length) { new Notice("没有可核对的消费流水"); return; }
    new AssetFormModal(this.plugin, "核对付款账户与补记", body => {
      const record = select(body, "消费流水", records.map(r => [r.id, `${r.date} ${r.time} ${formatCents(r.cents)} ${r.note || r.category}`]));
      const account = select(body, "扣款归属", [["exclude", "已包含在基线／无需再次扣款"], ...this.plugin.settings.assets.accounts.filter(a => a.kind === "cash").map(a => [a.id, a.name] as [string, string])]);
      body.createEl("p", { text: "明确指定后，这笔流水不再按默认账户推算。余额核对会将当时已入账记录纳入新基线。" });
      return () => this.save(s => {
        const selected = records.find(r => r.id === record.value)!;
        for (const id of Object.keys(s.recordAssignments)) {
          if (knownRecord(records.map(r => r.id), id)) continue;
          if (!id.startsWith("ledger-v2:")) continue;
          try { const identity = JSON.parse(id.slice(10)); if (identity[0] === selected.path && identity[1] === selected.date && identity[2] === selected.time && (identity[5] === selected.note || identity[4] === selected.cents)) delete s.recordAssignments[id]; } catch { /* Keep unrelated records. */ }
        }
        s.recordAssignments[record.value] = account.value;
      });
    }).open();
  }
  private linkForm(): void {
    const events = this.plugin.settings.assets.events.filter(e => ["buy", "transfer", "repay"].includes(e.kind)), records = this.records();
    if (!events.length) { new Notice("没有需要关联的买入、转账或还款交易"); return; }
    new AssetFormModal(this.plugin, "核对交易与账本关联", body => {
      const event = select(body, "资产交易", events.map(e => [e.id, `${e.date} ${e.note || EVENT_NAMES[e.kind]} ${formatCents(e.amountCents)}`]));
      const record = select(body, "账本流水", [["", "解除关联"], ...records.map(r => [r.id, `${r.date} ${r.time} ${formatCents(r.cents)} ${r.note || r.category}`] as [string, string])]);
      body.createEl("p", { text: "关联只排除账本重复扣款，不改变已登记的成交金额或持仓。请确认这两条记录描述同一笔资金变动。" });
      return () => this.save(s => {
        if (record.value && s.events.some(e => e.id !== event.value && e.link && knownRecord([e.link.id], record.value))) throw new Error("该流水已关联其他交易");
        s.events.find(e => e.id === event.value)!.link = record.value ? linkRecord(records.find(r => r.id === record.value)!) : undefined;
      });
    }).open();
  }
  private accountDetails(id: string): void { const account = this.plugin.settings.assets.accounts.find(a => a.id === id); if (account) this.accountForm(account); }
  private sankeyModal(snapshot: AssetSnapshot): void {
    const modal = new Modal(this.plugin.app); modal.setTitle(`资产组成 · ${snapshot.date}`); modal.modalEl.addClass("ledger-assets-sankey-modal");
    const expanded = new Set(this.expanded), draw = (): void => {
      modal.contentEl.empty(); renderAssetSankey(modal.contentEl, snapshot, this.plugin.settings.assets.excludeFixed, this.plugin.settings.assets.hideAmounts, expanded, id => { expanded.has(id) ? expanded.delete(id) : expanded.add(id); draw(); }, id => this.accountDetails(id));
    };
    modal.onOpen = draw; modal.open();
  }
  private calendarModal(): void {
    const modal = new Modal(this.plugin.app); modal.setTitle("资产月历"); modal.modalEl.addClass("ledger-assets-sankey-modal");
    modal.onOpen = () => {
      const state = this.plugin.settings.assets, snapshots = [...state.snapshots].sort((a, b) => b.date.localeCompare(a.date));
      if (!snapshots.length) { modal.contentEl.createEl("p", { text: "尚无资产快照，添加账户后自动保存。" }); return; }
      const months = [...new Set(snapshots.map(s => s.date.slice(0, 7)))];
      const month = select(modal.contentEl, "月份", months.map(m => [m, m]));
      const calendar = modal.contentEl.createDiv({ cls: "ledger-assets-calendar" }), detail = modal.contentEl.createDiv();
      let selected = snapshots[0].date;
      const draw = (): void => {
        detail.empty(); const snapshot = snapshots.find(s => s.date === selected)!, totals = assetTotals(snapshot, state.excludeFixed);
        detail.createEl("h3", { text: `${snapshot.date} · ${state.hideAmounts ? "••••" : formatCents(totals.assetsCents)}${totals.missing ? " · 估值不完整" : ""}` });
        detail.createEl("p", { cls: "ledger-assets-hint", text: `保存于 ${new Date(snapshot.savedAt).toLocaleString()}，行情日期保留当时值。` });
        const expanded = new Set<string>(), chart = detail.createDiv(), render = (): void => { chart.empty(); renderAssetSankey(chart, snapshot, state.excludeFixed, state.hideAmounts, expanded, id => { expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); }, () => {}); }; render();
        for (const a of snapshot.accounts) detail.createEl("p", { text: `${a.name} · ${state.hideAmounts ? "••••" : formatCents(a.cents)}${a.missing ? " · 未完整估值" : ""}` });
      };
      const drawMonth = (): void => {
        calendar.empty();
        for (const day of ["一", "二", "三", "四", "五", "六", "日"]) calendar.createEl("span", { text: day });
        const [year, monthNumber] = month.value.split("-").map(Number);
        const start = new Date(year, monthNumber - 1, 1), days = new Date(year, monthNumber, 0).getDate();
        for (let index = 0; index < (start.getDay() + 6) % 7; index++) calendar.createSpan();
        for (let day = 1; day <= days; day++) {
          const date = `${month.value}-${String(day).padStart(2, "0")}`, available = snapshots.some(s => s.date === date);
          const cell = button(calendar, String(day), () => { selected = date; drawMonth(); draw(); });
          cell.disabled = !available; cell.classList.toggle("is-selected", date === selected); cell.setAttribute("aria-label", `${date}${available ? "，查看资产快照" : "，无快照"}`);
        }
      };
      month.addEventListener("change", () => { selected = snapshots.find(s => s.date.startsWith(month.value))!.date; drawMonth(); draw(); }); drawMonth(); draw();
    }; modal.open();
  }
}
const EVENT_NAMES: Record<AssetEventKind, string> = { buy: "买入", sell: "卖出", income: "收入", transfer: "账户转账", repay: "偿还负债", dividend: "现金分红", reinvest: "红利再投资", quantity: "份额核对／拆分", adjust: "资产／负债增减" };
