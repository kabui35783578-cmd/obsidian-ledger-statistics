import { Modal, Notice, setIcon } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import { LedgerRecord, flattenRecords, formatCents, isoFromDate } from "./core";
import { ASSET_NAMES, AssetAccount, AssetEvent, AssetEventKind, AssetHolding, AssetKind, AssetSnapshot, SecurityKind, addAssetEvent, addEstimatedHolding, assetId, assetTotals, baselineRecordIds, calibrateAccount, dailyAssetChange, decimal, knownRecord, linkRecord, moneyCents, normalizeCode, previousDaySnapshot, quantityFromAmount, removeAssetAccount, removeAssetHolding, repayAssetLiability, setDefaultCash, validateQuantity } from "./assets";
import { renderAssetOverviewSankey, renderAssetSankey } from "./asset-charts";
import type { AssetQuote } from "./assets";

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
function localDateTime(now = new Date()): string { return `${isoFromDate(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; }
function parseBaseline(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) throw new Error("余额时点无效，不能使用未来时间");
  return date;
}
function changeText(cents: number | null, hide: boolean): string {
  if (hide) return "••••";
  if (cents === null) return "暂无可比记录";
  return cents === 0 ? "没有变化" : `${cents > 0 ? "↑" : "↓"}${formatCents(Math.abs(cents)).replace("¥", "")}`;
}
function changeClass(cents: number | null, hide: boolean): string {
  return hide || cents === null || cents === 0 ? "is-unchanged" : cents > 0 ? "is-up" : "is-down";
}
export class AssetFormModal extends Modal {
  private alive = false;
  constructor(plugin: LedgerStatisticsPlugin, private title: string, private build: (body: HTMLElement, active: () => boolean) => () => Promise<void>, private saveLabel = "保存") { super(plugin.app); }
  onOpen(): void {
    this.alive = true;
    this.modalEl.addClass("ledger-assets-modal"); this.setTitle(this.title);
    const body = this.contentEl.createEl("form", { cls: "ledger-assets-form" });
    const submit = this.build(body, () => this.alive), error = body.createDiv({ cls: "ledger-assets-form-error", attr: { role: "alert" } });
    const controls = body.createDiv({ cls: "ledger-assets-actions" });
    const save = controls.createEl("button", { cls: "ledger-button ledger-assets-primary", text: this.saveLabel }); save.type = "submit";
    button(controls, "取消", () => this.close());
    body.addEventListener("submit", event => {
      event.preventDefault(); if (save.disabled) return; save.disabled = true; error.setText("");
      save.setText("处理中…"); body.setAttribute("aria-busy", "true");
      void submit().then(() => { if (this.alive) { this.close(); new Notice(this.saveLabel === "删除" ? "已删除" : "资产已保存"); } }).catch(reason => { if (!this.alive) return; error.setText(reason instanceof Error ? reason.message : "保存失败，请重试"); save.disabled = false; save.setText(this.saveLabel); body.setAttribute("aria-busy", "false"); });
    });
  }
  close(): void { this.alive = false; super.close(); }
  onClose(): void { this.alive = false; }
}
export class AssetPanel {
  constructor(private plugin: LedgerStatisticsPlugin) {}
  private records(): LedgerRecord[] { return flattenRecords(this.plugin.repository.files.values()); }
  render(parent: HTMLElement): void {
    const state = this.plugin.settings.assets, snapshot = this.plugin.assetSnapshot(), totals = assetTotals(snapshot, state.excludeFixed);
    const money = (cents: number): string => state.hideAmounts ? "••••" : formatCents(cents).replace("¥", "");
    const root = parent.createDiv({ cls: "ledger-assets" });
    const pageHeader = root.createDiv({ cls: "ledger-assets-header" });
    const actions = pageHeader.createDiv({ cls: "ledger-assets-actions ledger-assets-main-actions" });
    button(actions, "添加持仓", () => this.holdingForm(), true);
    button(actions, "更多", () => this.toolsModal());
    const hero = root.createDiv({ cls: "ledger-assets-hero ledger-reveal" });
    const heroHeading = hero.createDiv({ cls: "ledger-assets-title-row ledger-assets-overview-heading" });
    const overview = hero.createDiv({ cls: "ledger-assets-overview" });
    const primary = overview.createDiv({ cls: "ledger-assets-primary-value" });
    const caption = primary.createDiv({ cls: "ledger-assets-caption" });
    caption.createSpan({ text: "总资产（元）" });
    const privacy = button(caption, "", () => void this.save(s => { s.hideAmounts = !s.hideAmounts; }).catch(e => new Notice(String(e))));
    setIcon(privacy, state.hideAmounts ? "eye-off" : "eye");
    privacy.setAttribute("aria-label", state.hideAmounts ? "显示金额" : "隐藏金额");
    heroHeading.appendChild(caption);
    const toggle = heroHeading.createEl("label", { cls: "ledger-assets-toggle" }); toggle.createSpan({ text: "排除固定资产" });
    const check = toggle.createEl("input", { type: "checkbox" }); check.checked = state.excludeFixed;
    check.setAttribute("aria-label", "排除固定资产"); check.setAttribute("role", "switch");
    check.addEventListener("change", () => void this.save(s => { s.excludeFixed = check.checked; }).catch(e => new Notice(String(e))));
    primary.createDiv({ cls: "ledger-assets-total", text: state.hideAmounts ? "••••" : formatCents(totals.assetsCents).replace("¥", "") });
    const updates = primary.createDiv({ cls: "ledger-assets-update-row" });
    const latest = snapshot.accounts.flatMap(a => a.holdings.filter(h => h.quote && decimal(h.quote.price).gt(0)).map(h => h.quote!.asOf)).sort().reverse()[0];
    updates.createEl("small", { text: `${snapshot.date.replace(/-/g, ".")} 更新` });
    if (latest) updates.setAttribute("title", `最新行情 ${latest.replace("T", " ").slice(0, 16)}`);
    const refresh = button(updates, "", () => { refresh.disabled = true; void this.plugin.refreshAssetQuotes(true).catch(e => new Notice(String(e))).finally(() => { refresh.disabled = false; }); });
    setIcon(refresh, "refresh-cw"); refresh.setAttribute("aria-label", "刷新行情");
    const metrics = overview.createDiv({ cls: "ledger-assets-metrics" });
    for (const [label, value] of [["净资产", money(totals.netCents)], ["负债率", state.hideAmounts ? "••••" : totals.assetsCents > 0 ? `${(totals.liabilitiesCents / totals.assetsCents * 100).toFixed(2)}%` : "—"]]) {
      const metric = metrics.createDiv(); metric.createEl("small", { text: label }); metric.createEl("strong", { text: value });
    }
    this.renderComparison(hero, snapshot);
    if (snapshot.pending.length) {
      const warning = root.createDiv({ cls: "ledger-assets-warning ledger-assets-compact-warning" }); warning.createSpan({ text: `${snapshot.pending.length}项变动待核对` }); button(warning, "查看", () => this.toolsModal());
    }
    const card = root.createDiv({ cls: "ledger-assets-card ledger-assets-chart-card ledger-reveal" });
    const heading = card.createDiv({ cls: "ledger-assets-title-row" });
    heading.createEl("h3", { text: "资产组成" });
    const expand = button(heading, "", () => this.sankeyModal(snapshot)); setIcon(expand, "maximize-2"); expand.setAttribute("aria-label", "放大查看桑基图");
    renderAssetOverviewSankey(card, snapshot, state.excludeFixed, state.hideAmounts, (id, holdingId) => this.sankeySelect(id, holdingId));
  }
  private renderAccounts(parent: HTMLElement, onSelect: (id: string) => void, kind?: AssetKind): void {
    const state = this.plugin.settings.assets, snapshot = this.plugin.assetSnapshot();
    const accounts = snapshot.accounts.filter(a => !kind || a.kind === kind);
    const money = (cents: number): string => state.hideAmounts ? "••••" : formatCents(cents);
    const accountSection = parent.createDiv({ cls: "ledger-assets-accounts-section" });
    const accountHeading = accountSection.createDiv({ cls: "ledger-assets-title-row" });
    accountHeading.createEl("h3", { text: "账户" });
    accountHeading.createSpan({ cls: "ledger-assets-subtitle", text: `${accounts.length} 个账户 · 点击管理余额与持仓` });
    if (accounts.length) {
      const grid = accountSection.createDiv({ cls: "ledger-assets-account-grid" });
      const maximum = Math.max(1, ...accounts.map(a => Math.abs(a.cents)));
      for (const account of accounts) {
        const tile = button(grid, "", () => onSelect(account.id)); tile.addClass("ledger-assets-account-tile");
        tile.setAttribute("aria-label", `${account.name}，管理账户`);
        const title = tile.createDiv(); title.createSpan({ cls: `ledger-assets-dot is-${account.kind}` }); title.createSpan({ text: account.name });
        tile.createEl("strong", { text: money(account.cents) });
        tile.createEl("small", { text: account.missing ? "等待行情" : account.kind === "liability" ? `还款 · ${state.accounts.find(a => a.id === state.defaultCashId && !a.archived)?.name ?? "选择扣款账户"}` : account.id === state.defaultCashId ? "默认扣款" : ASSET_NAMES[account.kind] });
        const bar = tile.createDiv({ cls: "ledger-assets-account-bar" }), fill = bar.createDiv({ cls: `is-${account.kind}` }); fill.style.width = `${state.hideAmounts ? 0 : Math.abs(account.cents) / maximum * 100}%`;
      }
    } else accountSection.createEl("p", { cls: "ledger-assets-empty", text: kind ? `暂无${ASSET_NAMES[kind]}账户。` : "暂无账户，点击添加账户开始记录。" });
  }
  private categoryModal(kind: AssetKind): void {
    if (kind === "liability") { this.liabilitiesModal(); return; }
    const modal = new Modal(this.plugin.app); modal.setTitle(`${ASSET_NAMES[kind]} · 账户明细`); modal.modalEl.addClass("ledger-assets-modal");
    modal.onOpen = () => {
      this.renderAccounts(modal.contentEl, id => { modal.close(); this.accountDetails(id); }, kind);
      button(modal.contentEl, `添加${ASSET_NAMES[kind]}账户`, () => { modal.close(); this.accountForm(undefined, kind); });
    }; modal.open();
  }
  private save(change: (state: LedgerStatisticsPlugin["settings"]["assets"]) => void): Promise<void> { return this.plugin.updateAssets(change); }
  private renderComparison(parent: HTMLElement, current: AssetSnapshot): void {
    const state = this.plugin.settings.assets, previous = previousDaySnapshot(state, current.date), card = parent.createDiv({ cls: "ledger-assets-comparison" });
    const title = card.createDiv({ cls: "ledger-assets-title-row" }); title.createSpan({ text: "相比前一天" });
    button(title, "资产月历 ›", () => this.calendarModal());
    const before = previous ? assetTotals(previous, state.excludeFixed) : null, after = assetTotals(current, state.excludeFixed);
    const comparable = !!before && !before.missing && !after.missing;
    const delta = comparable ? after.assetsCents - before!.assetsCents : null, debt = comparable ? after.liabilitiesCents - before!.liabilitiesCents : null;
    const summary = card.createDiv({ cls: "ledger-assets-change-summary" });
    for (const [name, icon, cents] of [["总资产", "wallet", delta], ["总负债", "coins", debt]] as const) {
      const item = summary.createDiv({ cls: "ledger-assets-change-item" });
      const symbol = item.createSpan({ cls: `ledger-assets-change-icon${name === "总负债" ? " is-debt" : ""}` }); setIcon(symbol, icon);
      const content = item.createDiv(); content.createSpan({ cls: "ledger-assets-change-label", text: name });
      content.createDiv({ cls: `ledger-assets-change-value ${changeClass(cents, state.hideAmounts)}`, text: !state.hideAmounts && previous && !comparable ? "金额待补全" : changeText(cents, state.hideAmounts) });
      if (name === "总负债") { item.setAttribute("role", "button"); item.setAttribute("tabindex", "0"); item.setAttribute("aria-label", "管理负债与还款"); item.addEventListener("click", () => this.liabilitiesModal()); item.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.liabilitiesModal(); } }); }
    }
    const values = (["cash", "fixed", "investment", "receivable", "liability"] as AssetKind[]).map(k => ({ kind: k, cents: comparable ? after.groups[k] - before!.groups[k] : null }));
    const maximum = Math.max(1, ...values.map(v => Math.abs(v.cents ?? 0))), bars = card.createDiv({ cls: "ledger-assets-change-bars" });
    for (const v of values) {
      const column = bars.createDiv({ cls: "ledger-assets-change-column" });
      column.setAttribute("role", "button"); column.setAttribute("tabindex", "0");
      column.setAttribute("aria-label", `查看${ASSET_NAMES[v.kind]}账户明细`);
      column.addEventListener("click", () => this.categoryModal(v.kind));
      column.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.categoryModal(v.kind); } });
      const track = column.createDiv({ cls: "ledger-assets-change-track" });
      const fill = track.createDiv({ cls: `ledger-assets-change-fill${(v.cents ?? 0) < 0 ? " is-negative" : ""}` });
      fill.style.height = `${state.hideAmounts ? 0 : Math.abs(v.cents ?? 0) / maximum * 100}%`;
      const excluded = state.excludeFixed && v.kind === "fixed";
      const text = state.hideAmounts ? "••••" : excluded ? "已排除" : v.cents === null ? "—" : v.cents === 0 ? (after.groups[v.kind] !== 0 || before?.groups[v.kind] ? "没有变化" : "") : changeText(v.cents, false).replace(/\.00$/, "");
      const annotation = track.createEl("small", { cls: `ledger-assets-bar-change ${changeClass(excluded ? null : v.cents, state.hideAmounts)}`, text });
      annotation.style.bottom = `calc(${state.hideAmounts ? 0 : Math.abs(v.cents ?? 0) / maximum * 100}% + 4px)`;
      column.createEl("small", { text: ASSET_NAMES[v.kind] });
    }
  }
  private accountForm(existing?: AssetAccount, preferredKind: AssetKind = "cash"): void {
    new AssetFormModal(this.plugin, existing ? "编辑账户" : "添加账户", body => {
      const name = input(body, "账户名称", existing?.name ?? "");
      const kind = select(body, "类别", Object.entries(ASSET_NAMES), existing?.kind ?? preferredKind); kind.disabled = !!existing;
      const valued = existing && this.plugin.assetSnapshot().accounts.find(a => a.id === existing.id);
      const initial = existing ? (existing.kind === "investment" ? valued?.unallocatedCents ?? existing.balanceCents : valued?.cents ?? existing.balanceCents) : 0;
      const balance = input(body, existing?.kind === "investment" ? "待分配金额（元）" : "当前金额（元）", (initial / 100).toFixed(2));
      const allocation = body.createEl("small", { cls: "ledger-assets-hint", text: "添加持仓时，会自动从这笔金额中分配，避免重复计算。" });
      const useDefault = input(body, "作为默认扣款账户", "", "checkbox");
      useDefault.checked = existing ? existing.id === this.plugin.settings.assets.defaultCashId : !this.plugin.settings.assets.defaultCashId;
      const updateFields = (): void => { allocation.hidden = kind.value !== "investment"; useDefault.parentElement!.hidden = kind.value !== "cash"; }; kind.addEventListener("change", updateFields); updateFields();
      const advanced = body.createEl("details", { cls: "ledger-assets-advanced" }); advanced.createEl("summary", { text: "余额时点" });
      const at = input(advanced, "余额对应时点", localDateTime(), "datetime-local");
      return async () => {
        const category = kind.value as AssetKind, cents = moneyCents(balance.value, category !== "liability");
        const now = advanced.open ? parseBaseline(at.value) : new Date();
        await this.save(state => {
          let account = existing && state.accounts.find(a => a.id === existing.id && !a.archived);
          if (existing && !account) throw new Error("账户已删除");
          if (account) { account.name = name.value.trim() || account.name; if (cents !== initial || advanced.open) calibrateAccount(state, account.id, cents, this.records(), now); }
          else { account = { id: assetId(), name: name.value.trim() || ASSET_NAMES[category], kind: category, balanceCents: cents, baselineAt: now.toISOString(), includedRecordIds: baselineRecordIds(this.records(), now), includedEventIds: [] }; state.accounts.push(account); }
          if (category === "cash" && useDefault.checked) setDefaultCash(state, account.id, this.records(), new Date());
          else if (category === "cash" && state.defaultCashId === account.id) { state.defaultCashId = ""; for (const epoch of state.epochs) if (!epoch.to && epoch.accountId === account.id) epoch.to = new Date().toISOString(); }
        });
      };
    }).open();
  }
  private holdingForm(preferredAccount = ""): void {
    const choices = this.plugin.settings.assets.accounts.filter(a => a.kind === "investment" && !a.archived).map(a => [a.id, a.name] as [string, string]);
    new AssetFormModal(this.plugin, "添加持仓", (body, active) => {
      const account = choices.length > 1 ? select(body, "投资账户", choices, preferredAccount) : null;
      const kind = select(body, "类型", [["fund", "基金"], ["stock", "股票"], ["etf", "ETF"]]);
      const code = input(body, "代码"), amount = input(body, "当前金额（元）");
      code.placeholder = "例如 000001"; amount.inputMode = "decimal";
      body.createEl("small", { cls: "ledger-assets-hint", text: "名称自动获取，日期默认今天；按最新可用行情估算份额。" });
      return async () => {
        const security = kind.value as SecurityKind, normalized = normalizeCode(security, code.value), cents = moneyCents(amount.value);
        if (cents <= 0) throw new Error("当前金额须大于零");
        const quote = await this.plugin.lookupAssetQuote(security, normalized);
        if (!active()) throw new Error("已取消添加");
        await this.save(state => {
          if (!active()) throw new Error("已取消添加");
          let id = account?.value || preferredAccount || choices[0]?.[0];
          if (!id) { id = assetId(); state.accounts.push({ id, name: "投资账户", kind: "investment", balanceCents: 0, baselineAt: new Date().toISOString(), includedEventIds: [], includedRecordIds: [] }); }
          if (state.holdings.some(h => h.accountId === id && h.kind === security && h.code === normalized)) throw new Error("此账户已有该持仓，请点击账户中的持仓调整金额");
          addEstimatedHolding(state, id, security, normalized, cents, quote);
        });
      };
    }, "添加").open();
  }
  private holdingCorrection(holding: AssetHolding): void {
    new AssetFormModal(this.plugin, holding.name, (body, active) => {
      const valued = this.plugin.assetSnapshot().accounts.flatMap(a => a.holdings).find(h => h.id === holding.id);
      const amount = input(body, "当前金额（元）", ((valued?.valueCents ?? holding.costCents) / 100).toFixed(2));
      const advanced = body.createEl("details", { cls: "ledger-assets-advanced" }); advanced.createEl("summary", { text: "使用平台实际份额" });
      const quantity = input(advanced, "实际份额／股数", holding.quantity);
      return async () => {
        let q: string, cents: number, quote: AssetQuote | undefined;
        if (advanced.open) { q = validateQuantity(quantity.value, holding.kind); cents = holding.costCents; }
        else {
          cents = moneyCents(amount.value); if (cents <= 0) throw new Error("当前金额须大于零");
          quote = await this.plugin.lookupAssetQuote(holding.kind, holding.code);
          q = decimal(String(cents)).div(100).div(quote.price).toDecimalPlaces(12).toFixed();
        }
        if (!active()) throw new Error("已取消调整");
        await this.save(state => {
          if (!active()) throw new Error("已取消调整");
          const h = state.holdings.find(h => h.id === holding.id && state.accounts.some(a => a.id === h.accountId && !a.archived)); if (!h) throw new Error("持仓或账户已删除");
          h.quantity = q; h.estimated = !advanced.open; delete h.amountBasisCents;
          if (quote) state.quotes[quote.key] = { ...quote };
          if (!advanced.open && h.costBasisKnown === false) h.costCents = cents;
        });
      };
    }).open();
  }
  private eventForm(): void {
    const state = this.plugin.settings.assets;
    if (!state.accounts.some(a => !a.archived)) { this.accountForm(); return; }
    new AssetFormModal(this.plugin, "记录资产交易", body => {
      const type = select(body, "交易类型", Object.entries(EVENT_NAMES));
      const account = select(body, "投资／转出／收入／负债账户", state.accounts.filter(a => !a.archived).map(a => [a.id, `${a.name} · ${ASSET_NAMES[a.kind]}`]));
      const cash = select(body, "扣款／到账／转入现金账户", [["", "请选择"], ...state.accounts.filter(a => a.kind === "cash" && !a.archived).map(a => [a.id, a.name] as [string, string])], state.defaultCashId);
      const holding = select(body, "持仓（买卖、分红或份额调整时必选）", [["", "请选择"], ...state.holdings.filter(h => state.accounts.some(a => a.id === h.accountId && !a.archived)).map(h => [h.id, `${h.name} · ${state.accounts.find(a => a.id === h.accountId)?.name}`] as [string, string])]);
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
    const accounts = this.plugin.settings.assets.accounts.filter(a => a.kind === "cash" && !a.archived);
    if (!accounts.length) { this.accountForm(); return; }
    new AssetFormModal(this.plugin, "默认扣款账户", body => {
      const account = select(body, "现金账户", accounts.map(a => [a.id, a.name]), this.plugin.settings.assets.defaultCashId);
      body.createEl("p", { text: "切换从当前时点生效，已发生的历史消费留在原账户。之后所有已记账支出和快捷还款默认扣此账户，与消费页面的筛选无关。" });
      return () => this.save(s => setDefaultCash(s, account.value, this.records(), new Date()));
    }).open();
  }
  private reviewForm(): void {
    const records = this.records().slice().sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    if (!records.length) { new Notice("没有可核对的消费流水"); return; }
    new AssetFormModal(this.plugin, "核对付款账户与补记", body => {
      const record = select(body, "消费流水", records.map(r => [r.id, `${r.date} ${r.time} ${formatCents(r.cents)} ${r.note || r.category}`]));
      const account = select(body, "扣款归属", [["exclude", "已包含在基线／无需再次扣款"], ...this.plugin.settings.assets.accounts.filter(a => a.kind === "cash" && !a.archived).map(a => [a.id, a.name] as [string, string])]);
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
  private sankeySelect(accountId: string, holdingId?: string): void {
    const holding = holdingId && this.plugin.settings.assets.holdings.find(h => h.id === holdingId && h.accountId === accountId);
    if (holding) this.holdingCorrection(holding); else this.accountDetails(accountId);
  }
  private liabilitiesModal(): void {
    const state = this.plugin.settings.assets, liabilities = this.plugin.assetSnapshot().accounts.filter(a => a.kind === "liability" || (a.kind === "cash" && a.cents < 0));
    if (!liabilities.length) { this.accountForm(undefined, "liability"); return; }
    const modal = new Modal(this.plugin.app); modal.setTitle("负债与还款"); modal.modalEl.addClass("ledger-assets-modal");
    modal.onOpen = () => {
      for (const account of liabilities) {
        const row = modal.contentEl.createDiv({ cls: "ledger-assets-position-row" }), info = row.createDiv();
        info.createEl("strong", { text: account.name });
        info.createEl("small", { text: state.hideAmounts ? "••••" : formatCents(Math.abs(account.cents)) });
        if (account.kind === "cash") info.createEl("small", { text: "支出账户负余额，已计入负债" });
        else button(row, "还款", () => { modal.close(); this.repaymentForm(account.id); }, true);
        button(row, "管理", () => { modal.close(); this.accountDetails(account.id); });
      }
      button(modal.contentEl, "添加负债", () => { modal.close(); this.accountForm(undefined, "liability"); });
    }; modal.open();
  }
  private repaymentForm(liabilityId: string): void {
    const state = this.plugin.settings.assets, accounts = state.accounts.filter(a => a.kind === "cash" && !a.archived);
    if (!accounts.length) { new Notice("请先添加现金账户用于还款"); this.accountForm(); return; }
    new AssetFormModal(this.plugin, `${state.accounts.find(a => a.id === liabilityId)?.name ?? "负债"} · 还款`, (body, active) => {
      const defaultId = accounts.find(a => a.id === state.defaultCashId)?.id;
      const cash = accounts.length > 1 || !defaultId ? select(body, "扣款账户", accounts.map(a => [a.id, a.name]), defaultId) : null;
      if (!cash) body.createEl("small", { cls: "ledger-assets-hint", text: `扣款账户：${accounts[0].name}` });
      const amount = input(body, "还款本金（元）"); amount.inputMode = "decimal";
      const extra = body.createEl("details", { cls: "ledger-assets-advanced" }); extra.createEl("summary", { text: "费用与账本关联" });
      const fee = input(extra, "利息／手续费（元）", "0");
      const records = this.records(), linked = select(extra, "关联已记账还款", [["", "未记在账本"], ...records.map(r => [r.id, `${r.date} ${formatCents(r.cents)} ${r.note || r.category}`] as [string, string])]);
      return async () => {
        const cents = moneyCents(amount.value), feeCents = moneyCents(fee.value), cashAccountId = cash?.value ?? defaultId, now = new Date();
        const link = linked.value ? linkRecord(records.find(r => r.id === linked.value)!) : undefined;
        await this.save(s => { if (!active()) throw new Error("已取消还款"); repayAssetLiability(s, liabilityId, cents, { cashAccountId, feeCents, link, now }); });
      };
    }, "确认还款").open();
  }
  private accountDetails(id: string): void {
    const account = this.plugin.settings.assets.accounts.find(a => a.id === id && !a.archived), valued = this.plugin.assetSnapshot().accounts.find(a => a.id === id);
    if (!account || !valued) return;
    const state = this.plugin.settings.assets, modal = new Modal(this.plugin.app); modal.setTitle(account.name); modal.modalEl.addClass("ledger-assets-modal");
    modal.onOpen = () => {
      modal.contentEl.createDiv({ cls: "ledger-assets-dialog-total", text: state.hideAmounts ? "••••" : formatCents(valued.cents) });
      const actions = modal.contentEl.createDiv({ cls: "ledger-assets-actions" });
      button(actions, "编辑账户", () => { modal.close(); this.accountForm(account); });
      if (account.kind === "liability") button(actions, "还款", () => { modal.close(); this.repaymentForm(id); }, true);
      if (account.kind === "investment") button(actions, "添加持仓", () => { modal.close(); this.holdingForm(id); }, true);
      button(actions, "删除账户", () => { modal.close(); this.deleteForm("账户", account.name, s => removeAssetAccount(s, id)); }).addClass("ledger-assets-danger");
      if (account.kind === "investment" && (valued.unallocatedCents ?? 0) !== 0) modal.contentEl.createEl("p", { cls: "ledger-assets-hint", text: `待添加持仓 ${state.hideAmounts ? "••••" : formatCents(valued.unallocatedCents!)}` });
      for (const h of valued.holdings) {
        const row = modal.contentEl.createDiv({ cls: "ledger-assets-position-row" }), info = row.createDiv();
        info.createEl("strong", { text: h.name });
        info.createEl("small", { text: `${h.code} · ${h.estimated ? "估算份额" : "实际份额"} ${state.hideAmounts ? "••••" : decimal(h.quantity).toDecimalPlaces(h.estimated ? 4 : 12).toFixed()}` });
        info.createEl("small", { text: h.quote?.asOf ? `行情 ${h.quote.asOf.replace("T", " ").slice(0, 16)}${h.quote.error ? " · 更新失败" : ""}` : "待更新行情" });
        row.createEl("strong", { text: h.valueCents === null ? "金额待补全" : state.hideAmounts ? "••••" : formatCents(h.valueCents) });
        const controls = row.createDiv({ cls: "ledger-assets-actions" });
        button(controls, "调整", () => { modal.close(); this.holdingCorrection(h); });
        const remove = button(controls, "×", () => { modal.close(); this.deleteForm("持仓", h.name, s => removeAssetHolding(s, h.id)); }); remove.setAttribute("aria-label", `删除持仓 ${h.name}`);
      }
    }; modal.open();
  }
  private deleteForm(kind: string, name: string, change: (state: LedgerStatisticsPlugin["settings"]["assets"]) => void): void {
    new AssetFormModal(this.plugin, `删除${kind} · ${name}`, body => {
      body.createEl("p", { text: "从当前资产中移除，历史快照和已记录的现金交易保留。" });
      return () => this.save(change);
    }, "删除").open();
  }
  private toolsModal(): void {
    const modal = new Modal(this.plugin.app); modal.setTitle("资产管理"); modal.modalEl.addClass("ledger-assets-modal", "ledger-assets-tools-modal");
    modal.onOpen = () => {
      modal.contentEl.createDiv({ cls: "ledger-assets-badge", text: "MANAGE · LOCAL LEDGER" });
      const actions = modal.contentEl.createDiv({ cls: "ledger-assets-tool-grid" });
      for (const [name, icon, action] of [["添加账户", "wallet", () => this.accountForm()], ["记录交易", "arrow-left-right", () => this.eventForm()], ["默认扣款账户", "credit-card", () => this.defaultForm()], ["核对流水", "list-checks", () => this.reviewForm()], ["交易关联", "link", () => this.linkForm()], ["资产月历", "calendar-days", () => this.calendarModal()]] as Array<[string, string, () => void]>) {
        const item = button(actions, "", () => { modal.close(); action(); }); item.addClass("ledger-assets-menu-item");
        setIcon(item.createSpan({ cls: "ledger-assets-menu-icon" }), icon);
        item.createSpan({ cls: "ledger-assets-menu-label", text: name });
        setIcon(item.createSpan({ cls: "ledger-assets-menu-chevron" }), "chevron-right");
      }
      this.renderAccounts(modal.contentEl, id => { modal.close(); this.accountDetails(id); });
      for (const text of this.plugin.assetSnapshot().pending) modal.contentEl.createEl("p", { cls: "ledger-assets-hint", text: this.plugin.settings.assets.hideAmounts ? "有资金变动待核对" : text });
      const events = this.plugin.settings.assets.events;
      if (events.length) {
        const history = modal.contentEl.createEl("details"); history.createEl("summary", { text: `交易记录 · ${events.length}笔` });
        for (const e of [...events].reverse().slice(0, 100)) history.createDiv({ cls: "ledger-assets-event-row", text: `${e.date} · ${e.note || EVENT_NAMES[e.kind]} · ${this.plugin.settings.assets.hideAmounts ? "••••" : formatCents(e.amountCents)}` });
      }
    }; modal.open();
  }
  private sankeyModal(snapshot: AssetSnapshot): void {
    const modal = new Modal(this.plugin.app); modal.setTitle(`资产组成 · ${snapshot.date}`); modal.modalEl.addClass("ledger-assets-sankey-modal", "ledger-assets-sankey-expanded");
    const draw = (): void => {
      modal.contentEl.empty();
      modal.contentEl.createEl("small", { cls: "ledger-assets-sankey-help", text: "左右拖动 · 双指缩放" });
      renderAssetSankey(modal.contentEl, snapshot, this.plugin.settings.assets.excludeFixed, this.plugin.settings.assets.hideAmounts, (id, holdingId) => { modal.close(); this.sankeySelect(id, holdingId); }, false, false, true);
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
        detail.createEl("h3", { text: `${snapshot.date} · ${state.hideAmounts ? "••••" : formatCents(totals.assetsCents)}${totals.missing ? " · 金额待补全" : ""}` });
        const change = dailyAssetChange(state, snapshot, state.excludeFixed);
        detail.createDiv({ cls: `ledger-assets-day-change ${changeClass(change, state.hideAmounts)}`, text: `相比前一天 ${changeText(change, state.hideAmounts)}` });
        detail.createEl("p", { cls: "ledger-assets-hint", text: `保存于 ${new Date(snapshot.savedAt).toLocaleString()}，行情日期保留当时值。` });
        const chart = detail.createDiv(); renderAssetSankey(chart, snapshot, state.excludeFixed, state.hideAmounts, () => {});
        for (const a of snapshot.accounts) detail.createEl("p", { text: `${a.name} · ${state.hideAmounts ? "••••" : formatCents(a.cents)}${a.missing ? " · 金额待补全" : ""}` });
      };
      const drawMonth = (): void => {
        calendar.empty();
        for (const day of ["一", "二", "三", "四", "五", "六", "日"]) calendar.createEl("span", { text: day });
        const [year, monthNumber] = month.value.split("-").map(Number);
        const start = new Date(year, monthNumber - 1, 1), days = new Date(year, monthNumber, 0).getDate();
        for (let index = 0; index < (start.getDay() + 6) % 7; index++) calendar.createSpan();
        for (let day = 1; day <= days; day++) {
          const date = `${month.value}-${String(day).padStart(2, "0")}`, snapshot = snapshots.find(s => s.date === date);
          const change = snapshot ? dailyAssetChange(state, snapshot, state.excludeFixed) : null;
          const cell = button(calendar, "", () => { selected = date; drawMonth(); draw(); });
          cell.createSpan({ text: String(day) });
          if (snapshot) cell.createEl("small", { cls: `ledger-assets-calendar-change ${changeClass(change, state.hideAmounts)}`, text: state.hideAmounts ? "••" : change === null ? "—" : change === 0 ? "持平" : changeText(change, false).replace(/\.00$/, "") });
          cell.disabled = !snapshot; cell.classList.toggle("is-selected", date === selected); cell.setAttribute("aria-label", `${date}${snapshot ? `，相比前一天${changeText(change, state.hideAmounts)}，查看资产快照` : "，无快照"}`);
        }
      };
      month.addEventListener("change", () => { selected = snapshots.find(s => s.date.startsWith(month.value))!.date; drawMonth(); draw(); }); drawMonth(); draw();
    }; modal.open();
  }
}
const EVENT_NAMES: Record<AssetEventKind, string> = { buy: "买入", sell: "卖出", income: "收入", transfer: "账户转账", repay: "偿还负债", dividend: "现金分红", reinvest: "红利再投资", quantity: "份额核对／拆分", adjust: "资产／负债增减" };
