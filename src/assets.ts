import Decimal from "decimal.js";
/*!
 * decimal.js 10.6.0 - The MIT Licence
 * Copyright (c) 2025 Michael Mclaughlin
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the 'Software'), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to
 * do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import { LedgerRecord, isoFromDate, isValidIsoDate, renameStarredIds } from "./core";

Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
export type AssetKind = "cash" | "investment" | "fixed" | "receivable" | "liability";
export type SecurityKind = "fund" | "stock" | "etf";
export const ASSET_NAMES: Record<AssetKind, string> = { cash: "流动资金", investment: "投资理财", fixed: "固定资产", receivable: "应收款", liability: "负债" };
export interface AssetAccount {
  id: string; name: string; kind: AssetKind; balanceCents: number; baselineAt: string;
  includedEventIds: string[]; includedRecordIds: string[];
  archived?: boolean;
}
export interface AssetHolding {
  id: string; accountId: string; kind: SecurityKind; code: string; name: string;
  quantity: string; costCents: number; acquiredOn: string;
  amountBasisCents?: number;
  estimated?: boolean; costBasisKnown?: boolean;
}
export interface AssetQuote {
  key: string; name: string; price: string; asOf: string; fetchedAt: string;
  attemptedAt?: string; error?: string;
}
export interface LedgerLink { id: string; date: string; time: string; cents: number; note: string; }
export type AssetEventKind = "buy" | "sell" | "income" | "transfer" | "repay" | "dividend" | "reinvest" | "quantity" | "adjust";
export interface AssetEvent {
  id: string; kind: AssetEventKind; date: string; createdAt: string; accountId: string;
  cashAccountId?: string; holdingId?: string; amountCents: number; feeCents: number;
  quantity?: string; price?: string; note: string; link?: LedgerLink;
}
export interface CashEpoch { accountId: string; from: string; to?: string; includedRecordIds: string[]; }
export interface ValuedHolding extends AssetHolding { valueCents: number | null; quote?: AssetQuote; }
export interface ValuedAccount { id: string; name: string; kind: AssetKind; cents: number; missing: boolean; holdings: ValuedHolding[]; unallocatedCents?: number; }
export interface AssetSnapshot { date: string; savedAt: string; accounts: ValuedAccount[]; pending: string[]; }
export interface AssetState {
  version: 1; accounts: AssetAccount[]; holdings: AssetHolding[]; events: AssetEvent[];
  epochs: CashEpoch[]; defaultCashId: string; quotes: Record<string, AssetQuote>;
  snapshots: AssetSnapshot[]; hideAmounts: boolean; excludeFixed: boolean;
  recordAssignments: Record<string, string>;
}
export interface AssetTotals { assetsCents: number; liabilitiesCents: number; netCents: number; missing: boolean; groups: Record<AssetKind, number>; }

export function emptyAssets(): AssetState {
  return { version: 1, accounts: [], holdings: [], events: [], epochs: [], defaultCashId: "", quotes: {}, snapshots: [], hideAmounts: false, excludeFixed: false, recordAssignments: {} };
}
export function assetId(): string { return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`; }
export function decimal(value: string): Decimal {
  if (!/^-?\d+(?:\.\d{1,12})?$/.test(value.trim())) throw new Error("请输入有效数字（最多12位小数）");
  return new Decimal(value);
}
export function moneyCents(value: string, signed = false): number {
  const amount = decimal(value);
  if ((!signed && amount.isNegative()) || amount.decimalPlaces() > 2) throw new Error("金额须为非负数，最多两位小数");
  const cents = amount.times(100).toNumber();
  if (!Number.isSafeInteger(cents)) throw new Error("金额超出可计算范围");
  return cents;
}
export function valueCents(quantity: string, price: string): number {
  const result = decimal(quantity).times(decimal(price)).times(100).toDecimalPlaces(0).toNumber();
  if (!Number.isSafeInteger(result)) throw new Error("市值超出可计算范围");
  return result;
}
export function quantityFromAmount(amountCents: number, feeCents: number, price: string, kind: SecurityKind, sell = false): string {
  const net = new Decimal(amountCents).plus(sell ? feeCents : -feeCents);
  if (net.lte(0) || decimal(price).lte(0)) throw new Error("成交金额扣除费用后及成交价格必须大于零");
  return net.div(100).div(price).toDecimalPlaces(kind === "fund" ? 2 : 0, kind === "fund" ? Decimal.ROUND_HALF_UP : Decimal.ROUND_DOWN).toFixed();
}
export function validateQuantity(value: string, kind: SecurityKind): string {
  const q = decimal(value);
  if (q.lte(0) || (kind !== "fund" && !q.isInteger())) throw new Error(kind === "fund" ? "份额必须大于零" : "股票和ETF必须填写实际成交的整数数量");
  return q.toFixed();
}
export function quoteKey(kind: SecurityKind, code: string): string { return `${kind}:${normalizeCode(kind, code)}`; }
// A current-value entry establishes today's valuation baseline, not a historical purchase.
export function addAmountHolding(state: AssetState, accountId: string, kind: SecurityKind, code: string, amount: string, now = new Date()): AssetHolding {
  if (!state.accounts.some(a => a.id === accountId && a.kind === "investment" && !a.archived)) throw new Error("请选择投资账户");
  const normalized = normalizeCode(kind, code), cents = moneyCents(amount);
  if (cents <= 0) throw new Error("当前持仓金额须大于零");
  const holding: AssetHolding = { id: assetId(), accountId, kind, code: normalized, name: normalized, quantity: "0", costCents: cents, amountBasisCents: cents, estimated: true, costBasisKnown: false, acquiredOn: isoFromDate(now) };
  state.holdings.push(holding);
  return holding;
}
export function applyAssetQuote(state: AssetState, quote: AssetQuote): void {
  const holdings = state.holdings.filter(h => quoteKey(h.kind, h.code) === quote.key && state.accounts.some(a => a.id === h.accountId && !a.archived));
  if (!holdings.length) return;
  state.quotes[quote.key] = quote;
  if (quote.error || decimal(quote.price).lte(0)) return;
  for (const h of holdings) {
    if (h.name === h.code) h.name = quote.name;
    if (h.amountBasisCents !== undefined && h.quantity === "0") {
      h.estimated = true; h.costBasisKnown = false;
      h.quantity = new Decimal(h.amountBasisCents).div(100).div(quote.price).toDecimalPlaces(12).toFixed();
    }
  }
}
export function normalizeCode(kind: SecurityKind, input: string): string {
  const code = input.trim().toLowerCase();
  if (kind === "fund") { if (!/^\d{6}$/.test(code)) throw new Error("基金代码须为6位数字"); return code; }
  if (/^(sh|sz|bj)\d{6}$/.test(code)) return code;
  if (!/^\d{6}$/.test(code)) throw new Error("代码须为6位数字，可加sh／sz／bj前缀");
  return `${/^[569]/.test(code) ? "sh" : /^[48]/.test(code) ? "bj" : "sz"}${code}`;
}
function validCents(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function validInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validQuantity(value: unknown): value is string { try { return typeof value === "string" && decimal(value).gte(0); } catch { return false; } }
function stringIds(value: unknown): string[] { return Array.isArray(value) ? value.filter(v => typeof v === "string") : []; }
export function normalizeAssets(input: unknown): AssetState {
  if (!input || typeof input !== "object") return emptyAssets();
  const s = input as Partial<AssetState>, out = emptyAssets();
  out.accounts = (Array.isArray(s.accounts) ? s.accounts : []).filter(a => a && typeof a.id === "string" && typeof a.name === "string" && a.kind in ASSET_NAMES && validCents(a.balanceCents) && validInstant(a.baselineAt)).map(a => ({ ...a, includedEventIds: stringIds(a.includedEventIds), includedRecordIds: stringIds(a.includedRecordIds) }));
  const accounts = new Set(out.accounts.map(a => a.id));
  out.holdings = (Array.isArray(s.holdings) ? s.holdings : []).filter(h => {
    try { return h && typeof h.id === "string" && typeof h.name === "string" && accounts.has(h.accountId) && ["fund", "stock", "etf"].includes(h.kind) && normalizeCode(h.kind, h.code) === h.code && validQuantity(h.quantity) && validCents(h.costCents) && h.costCents >= 0 && (h.amountBasisCents === undefined || (validCents(h.amountBasisCents) && h.amountBasisCents > 0)) && isValidIsoDate(h.acquiredOn); } catch { return false; }
  }).map(h => h.amountBasisCents !== undefined ? { ...h, estimated: h.estimated ?? true, costBasisKnown: h.costBasisKnown ?? false } : h);
  out.events = (Array.isArray(s.events) ? s.events : []).filter(e => e && typeof e.id === "string" && ["buy", "sell", "income", "transfer", "repay", "dividend", "reinvest", "quantity", "adjust"].includes(e.kind) && accounts.has(e.accountId) && isValidIsoDate(e.date) && validInstant(e.createdAt) && validCents(e.amountCents) && validCents(e.feeCents));
  out.epochs = (Array.isArray(s.epochs) ? s.epochs : []).filter(e => e && accounts.has(e.accountId) && validInstant(e.from) && (!e.to || validInstant(e.to))).map(e => ({ ...e, includedRecordIds: stringIds(e.includedRecordIds) }));
  out.defaultCashId = out.accounts.some(a => a.id === s.defaultCashId && a.kind === "cash" && !a.archived) ? s.defaultCashId! : "";
  for (const [key, q] of Object.entries(s.quotes ?? {})) {
    if (q && q.key === key && typeof q.name === "string" && validInstant(q.fetchedAt) && validQuantity(q.price)
      && (validInstant(q.asOf) || (q.asOf === "" && decimal(q.price).eq(0) && typeof q.error === "string" && validInstant(q.attemptedAt)))) out.quotes[key] = q;
  }
  out.snapshots = (Array.isArray(s.snapshots) ? s.snapshots : []).filter(snap => snap && isValidIsoDate(snap.date) && validInstant(snap.savedAt) && Array.isArray(snap.accounts) && snap.accounts.every(a => a && typeof a.id === "string" && a.kind in ASSET_NAMES && validCents(a.cents) && Array.isArray(a.holdings))).map(snap => ({ ...snap, pending: stringIds(snap.pending) }));
  out.hideAmounts = s.hideAmounts === true; out.excludeFixed = s.excludeFixed === true;
  for (const [id, account] of Object.entries(s.recordAssignments ?? {})) if (typeof account === "string" && (account === "exclude" || accounts.has(account))) out.recordAssignments[id] = account;
  return out;
}
export function linkRecord(record: LedgerRecord): LedgerLink { return { id: record.id, date: record.date, time: record.time, cents: record.cents, note: record.note }; }
// Ignore changing duplicate totals, but retain the occurrence ordinal: insertion of
// another identical expense must not cause an existing linked expense to be charged twice.
function stableIdentity(id: string): string {
  if (!id.startsWith("ledger-v2:")) return id;
  try { const p = JSON.parse(id.slice(10)); return JSON.stringify([...p.slice(0, 6), p[7]]); } catch { return id; }
}
export function knownRecord(ids: string[], id: string): boolean { return ids.some(saved => stableIdentity(saved) === stableIdentity(id)); }
function recordInstant(record: LedgerRecord): number | null {
  return /^\d{1,2}:\d{2}$/.test(record.time) ? new Date(`${record.date}T${record.time.padStart(5, "0")}:00`).getTime() : null;
}
export function baselineRecordIds(records: LedgerRecord[], now: Date): string[] {
  const date = isoFromDate(now);
  return records.filter(r => r.date < date || (r.date === date && (recordInstant(r) === null || recordInstant(r)! <= now.getTime()))).map(r => r.id);
}
export function setDefaultCash(state: AssetState, accountId: string, records: LedgerRecord[], now: Date): void {
  if (!state.accounts.some(a => a.id === accountId && a.kind === "cash" && !a.archived)) throw new Error("请选择现金账户");
  if (state.defaultCashId === accountId) return;
  const at = now.toISOString();
  for (const epoch of state.epochs) if (!epoch.to) epoch.to = at;
  state.epochs.push({ accountId, from: at, includedRecordIds: baselineRecordIds(records, now) });
  state.defaultCashId = accountId;
}
export function calibrateAccount(state: AssetState, id: string, cents: number, records: LedgerRecord[], now: Date): void {
  const account = state.accounts.find(a => a.id === id);
  if (!account || account.archived || !validCents(cents) || (account.kind === "liability" && cents < 0)) throw new Error("余额无效或账户已删除");
  account.balanceCents = cents; account.baselineAt = now.toISOString();
  account.includedEventIds = state.events.map(e => e.id); account.includedRecordIds = baselineRecordIds(records, now);
}
function linkedRecords(state: AssetState, records: LedgerRecord[], pending: Set<string>): Set<string> {
  const excluded = new Set<string>();
  const active = new Set(state.accounts.filter(a => !a.archived).map(a => a.id));
  for (const event of state.events) if (event.link && (active.has(event.accountId) || (event.cashAccountId && active.has(event.cashAccountId)))) {
    const matches = records.filter(r => stableIdentity(r.id) === stableIdentity(event.link!.id));
    if (matches.length === 1) excluded.add(matches[0].id);
    else {
      pending.add(`交易“${event.note || event.kind}”关联的账本流水已变化，请核对关联`);
      // A changed linked expense may still be recognizable by its original date/time.
      // Exclude candidates while reporting uncertainty instead of deducting both sources.
      for (const r of records) if (r.date === event.link.date && r.time === event.link.time && (r.note === event.link.note || r.cents === event.link.cents)) excluded.add(r.id);
    }
  }
  return excluded;
}
export function buildAssetSnapshot(state: AssetState, records: LedgerRecord[], now = new Date()): AssetSnapshot {
  const pending = new Set<string>(), excluded = linkedRecords(state, records, pending), nowMs = now.getTime(), today = isoFromDate(now);
  for (const id of Object.keys(state.recordAssignments)) {
    if (records.some(r => stableIdentity(r.id) === stableIdentity(id))) continue;
    try {
      const identity = JSON.parse(id.slice(10));
      const candidates = records.filter(r => r.path === identity[0] && r.date === identity[1] && r.time === identity[2]
        && (r.note === identity[5] || r.cents === identity[4]));
      if (candidates.length) {
        pending.add(`${identity[1]} ${identity[2]}：已指定付款账户的流水发生变化，请重新核对`);
        for (const r of candidates) excluded.add(r.id);
      }
    } catch { /* Older unmatched identities have no reliable candidate. */ }
  }
  const accounts = state.accounts.filter(a => !a.archived).map(account => {
    let cents = account.balanceCents;
    const baseline = Date.parse(account.baselineAt);
    for (const event of state.events) {
      if (event.date > today || account.includedEventIds.includes(event.id)) continue;
      const cashDelta = event.kind === "buy" ? -event.amountCents : event.kind === "sell" || event.kind === "dividend" ? event.amountCents : event.kind === "transfer" ? event.amountCents : event.kind === "repay" ? -(event.amountCents + event.feeCents) : 0;
      if (event.cashAccountId === account.id) cents += cashDelta;
      if (event.accountId === account.id) {
        if (event.kind === "income" || event.kind === "adjust") cents += event.amountCents;
        if (event.kind === "transfer") cents -= event.amountCents + event.feeCents;
        if (event.kind === "repay") cents -= event.amountCents;
      }
    }
    if (account.kind === "cash") for (const epoch of state.epochs.filter(e => e.accountId === account.id)) {
      const start = Math.max(Date.parse(epoch.from), baseline), end = Math.min(epoch.to ? Date.parse(epoch.to) : nowMs, nowMs);
      for (const record of records) {
        if (excluded.has(record.id) || Object.keys(state.recordAssignments).some(id => stableIdentity(id) === stableIdentity(record.id)) || knownRecord(account.includedRecordIds, record.id) || knownRecord(epoch.includedRecordIds, record.id)) continue;
        const time = recordInstant(record), dayStart = new Date(`${record.date}T00:00:00`).getTime();
        if (time === null) {
          if (dayStart > start && dayStart + 86400000 <= end) cents -= record.cents;
          else if (dayStart <= end && dayStart + 86400000 > start) pending.add(`${record.date} ${record.note || record.category}：补记时间未知，尚未扣款`);
        } else if (epoch.to && Math.floor(time / 60000) === Math.floor(Date.parse(epoch.to) / 60000)
          && !knownRecord(state.epochs.find(e => e.from === epoch.to)?.includedRecordIds ?? [], record.id)) {
          pending.add(`${record.date} ${record.time} ${record.note || record.category}：与账户切换同一分钟，尚未扣款`);
        } else if (time > start && time <= end) cents -= record.cents;
        else if (Math.floor(time / 60000) === Math.floor(start / 60000) && start <= end) pending.add(`${record.date} ${record.time} ${record.note || record.category}：与余额基线同一分钟，尚未扣款`);
      }
    }
    if (account.kind === "cash") for (const record of records) {
      const assignment = Object.entries(state.recordAssignments).find(([id]) => stableIdentity(id) === stableIdentity(record.id))?.[1];
      if (assignment === account.id && record.date <= today && !excluded.has(record.id) && !knownRecord(account.includedRecordIds, record.id)) cents -= record.cents;
    }
    const holdings = state.holdings.filter(h => h.accountId === account.id).map(h => {
      const quote = state.quotes[quoteKey(h.kind, h.code)];
      const value = h.amountBasisCents !== undefined && h.quantity === "0" ? h.amountBasisCents : decimal(h.quantity).eq(0) ? 0 : quote && decimal(quote.price).gt(0) ? valueCents(h.quantity, quote.price) : null;
      return { ...h, quote: quote ? { ...quote } : undefined, valueCents: value };
    });
    const unallocatedCents = account.kind === "investment" ? cents : undefined;
    if (account.kind === "investment") cents += holdings.reduce((sum, h) => sum + (h.valueCents ?? 0), 0);
    if (!Number.isSafeInteger(cents)) throw new Error("账户金额超出可计算范围");
    return { id: account.id, name: account.name, kind: account.kind, cents, missing: holdings.some(h => h.valueCents === null || (h.amountBasisCents !== undefined && h.quantity === "0")), holdings, unallocatedCents };
  });
  return { date: today, savedAt: now.toISOString(), accounts, pending: [...pending] };
}
export function assetTotals(snapshot: AssetSnapshot, excludeFixed = false): AssetTotals {
  const groups: Record<AssetKind, number> = { cash: 0, investment: 0, fixed: 0, receivable: 0, liability: 0 };
  let missing = snapshot.pending.length > 0;
  for (const a of snapshot.accounts) {
    if (excludeFixed && a.kind === "fixed") continue;
    groups[a.kind] += a.cents; missing ||= a.missing;
  }
  const assetsCents = groups.cash + groups.investment + groups.fixed + groups.receivable;
  return { assetsCents, liabilitiesCents: groups.liability, netCents: assetsCents - groups.liability, groups, missing };
}
export function storeAssetSnapshot(state: AssetState, snapshot: AssetSnapshot): boolean {
  if (!state.accounts.length) return false;
  const index = state.snapshots.findIndex(s => s.date === snapshot.date), existing = state.snapshots[index];
  if (existing && JSON.stringify([existing.accounts, existing.pending]) === JSON.stringify([snapshot.accounts, snapshot.pending])) return false;
  const copy = JSON.parse(JSON.stringify(snapshot)) as AssetSnapshot;
  if (index >= 0) state.snapshots[index] = copy; else state.snapshots.push(copy);
  state.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  return true;
}
export function previousMonthSnapshot(state: AssetState, date: string): AssetSnapshot | undefined {
  const previous = new Date(`${date.slice(0, 7)}-01T12:00:00`); previous.setMonth(previous.getMonth() - 1);
  const prefix = isoFromDate(previous).slice(0, 7);
  return state.snapshots.filter(s => s.date.startsWith(prefix)).sort((a, b) => b.date.localeCompare(a.date))[0];
}
/** Cash linking is explicit; opening debt balances never invents cash income. */
export function repayAssetLiability(state: AssetState, liabilityId: string, cents: number, options: { cashAccountId?: string; feeCents?: number; link?: LedgerLink; now?: Date } = {}): void {
  if (!validCents(cents) || cents <= 0) throw new Error("还款本金须大于零");
  const now = options.now ?? new Date();
  addAssetEvent(state, { id: assetId(), kind: "repay", accountId: liabilityId,
    cashAccountId: options.cashAccountId ?? state.defaultCashId, amountCents: cents, feeCents: options.feeCents ?? 0,
    date: isoFromDate(now), createdAt: now.toISOString(), note: "还款", link: options.link });
}
export function addAssetEvent(state: AssetState, event: AssetEvent): void {
  if (state.events.some(e => e.id === event.id)) throw new Error("这笔交易已保存");
  if (!isValidIsoDate(event.date) || event.date > isoFromDate(new Date())) throw new Error("请填写已确认交易的日期，不能填写未来日期");
  if (!validCents(event.amountCents) || !validCents(event.feeCents) || event.feeCents < 0 || (event.kind !== "adjust" && event.amountCents < 0)) throw new Error("交易金额无效");
  const account = state.accounts.find(a => a.id === event.accountId), cash = state.accounts.find(a => a.id === event.cashAccountId);
  if (!account || account.archived) throw new Error("账户不存在或已删除");
  if (event.link && state.events.some(e => e.link && stableIdentity(e.link.id) === stableIdentity(event.link!.id))) throw new Error("这条账本流水已关联其他交易");
  if (["buy", "sell", "dividend", "transfer", "repay"].includes(event.kind) && (!cash || cash.kind !== "cash" || cash.archived)) throw new Error("请选择现金账户");
  if (event.kind === "transfer" && (account.kind !== "cash" || account.id === cash?.id)) throw new Error("转出、转入必须是不同现金账户");
  if (event.kind === "income" && account.kind !== "cash") throw new Error("收入必须进入现金账户");
  if (event.kind === "repay" && account.kind !== "liability") throw new Error("还款须选择负债账户");
  if (account.kind === "liability" && ["repay", "adjust"].includes(event.kind)) {
    const outstanding = account.balanceCents + state.events.filter(e => e.accountId === account.id && !account.includedEventIds.includes(e.id)).reduce((sum, e) => sum + (e.kind === "adjust" ? e.amountCents : e.kind === "repay" ? -e.amountCents : 0), 0);
    if (outstanding + (event.kind === "repay" ? -event.amountCents : event.amountCents) < 0) throw new Error("还款或调整不能超过尚欠金额");
  }
  if (event.kind === "adjust" && account.kind === "investment") throw new Error("投资账户通过持仓估值，不能直接调整余额");
  if (["buy", "sell", "dividend", "reinvest", "quantity"].includes(event.kind)) {
    const h = state.holdings.find(h => h.id === event.holdingId && h.accountId === account.id);
    if (!h) throw new Error("请选择该账户的持仓");
    if (h.amountBasisCents !== undefined && event.kind !== "dividend") throw new Error("请先核对平台实际份额和成本，再记录买卖或份额变动");
    if ((event.kind === "buy" && event.amountCents <= event.feeCents) || (event.kind === "sell" && event.amountCents + event.feeCents <= 0)) throw new Error("请填写实际成交金额和费用");
    if (event.price && decimal(event.price).lte(0)) throw new Error("成交价格必须大于零");
    if (["reinvest", "quantity"].includes(event.kind) && (event.amountCents !== 0 || event.feeCents !== 0)) throw new Error("份额调整不直接改变现金，金额与费用应为0");
    if (event.kind !== "dividend") {
      const q = validateQuantity(event.quantity ?? "", h.kind), current = decimal(h.quantity);
      if (event.kind === "sell") {
        if (decimal(q).gt(current)) throw new Error("卖出数量不能超过当前持仓");
        h.costCents = new Decimal(h.costCents).times(current.minus(q)).div(current).toDecimalPlaces(0).toNumber();
        h.quantity = current.minus(q).toFixed();
      } else if (event.kind === "quantity") h.quantity = q;
      else {
        h.quantity = current.plus(q).toFixed();
        if (event.kind === "buy") h.costCents += event.amountCents;
      }
    }
  }
  state.events.push(event);
}
export function renameAssetLinks(state: AssetState, oldPath: string, newPath: string): void {
  for (const a of state.accounts) a.includedRecordIds = renameStarredIds(a.includedRecordIds, oldPath, newPath);
  for (const e of state.epochs) e.includedRecordIds = renameStarredIds(e.includedRecordIds, oldPath, newPath);
  for (const e of state.events) if (e.link) e.link.id = renameStarredIds([e.link.id], oldPath, newPath)[0];
  const assignments: Record<string, string> = {};
  for (const [id, account] of Object.entries(state.recordAssignments)) assignments[renameStarredIds([id], oldPath, newPath)[0]] = account;
  state.recordAssignments = assignments;
}

/** Current value is a valuation baseline, not the historical purchase cost. */
export function addEstimatedHolding(state: AssetState, accountId: string, kind: SecurityKind, code: string, cents: number, quote: AssetQuote, now = new Date()): AssetHolding {
  const account = state.accounts.find(a => a.id === accountId && a.kind === "investment" && !a.archived);
  if (!account) throw new Error("请选择有效的投资账户");
  if (!validCents(cents) || cents <= 0) throw new Error("当前金额须大于零");
  const normalized = normalizeCode(kind, code);
  if (quote.key !== quoteKey(kind, normalized) || !validInstant(quote.asOf) || decimal(quote.price).lte(0)) throw new Error("没有可用于估算的行情，请稍后重试");
  const quantity = new Decimal(cents).div(100).div(quote.price).toDecimalPlaces(12).toFixed();
  if (decimal(quantity).lte(0) || valueCents(quantity, quote.price) !== cents) throw new Error("金额无法可靠换算，请核对金额");
  const holding: AssetHolding = { id: assetId(), accountId, kind, code: normalized, name: quote.name || normalized, quantity, costCents: cents, acquiredOn: isoFromDate(now), estimated: true, costBasisKnown: false };
  account.balanceCents -= Math.min(Math.max(0, account.balanceCents), cents);
  state.holdings.push(holding); state.quotes[quote.key] = { ...quote };
  return holding;
}

/** Keep past cash legs and ledger associations; deleting a visible account is not reversing its transactions. */
export function removeAssetAccount(state: AssetState, id: string, now = new Date()): void {
  const account = state.accounts.find(a => a.id === id && !a.archived);
  if (!account) throw new Error("账户不存在或已删除");
  account.archived = true;
  if (state.defaultCashId === id) {
    state.defaultCashId = "";
    for (const epoch of state.epochs) if (epoch.accountId === id && !epoch.to) epoch.to = now.toISOString();
  }
}

export function removeAssetHolding(state: AssetState, id: string): void {
  if (!state.holdings.some(h => h.id === id)) throw new Error("持仓不存在");
  state.holdings = state.holdings.filter(h => h.id !== id);
}
