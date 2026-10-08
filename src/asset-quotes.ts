import { AssetHolding, AssetQuote, AssetState, SecurityKind, decimal, normalizeCode, quoteKey } from "./assets";
import { isValidIsoDate } from "./core";

export interface QuoteResponse { text: string; arrayBuffer?: ArrayBuffer; }
export type QuoteFetcher = (url: string) => Promise<QuoteResponse>;
export function parseFundQuote(code: string, source: string, now: Date): AssetQuote {
  const name = /var\s+fS_name\s*=\s*"([^"\r\n]+)"/.exec(source)?.[1];
  const returnedCode = /var\s+fS_code\s*=\s*"(\d{6})"/.exec(source)?.[1];
  if (!name || returnedCode !== code) throw new Error("基金代码或返回格式不匹配");
  if (/货币|现金管理|现金增利|活期/.test(name)) throw new Error("货币基金暂不支持自动收益累计，请使用普通净值型基金");
  const literal = /var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/.exec(source)?.[1];
  if (!literal) throw new Error("未找到基金单位净值数据");
  const rows: unknown = JSON.parse(literal);
  if (!Array.isArray(rows) || !rows.length) throw new Error("暂无公布净值");
  const valid = rows.filter(r => r && typeof r.x === "number" && Number.isFinite(r.x) && typeof r.y === "number" && Number.isFinite(r.y) && r.y > 0 && r.x <= now.getTime()).sort((a, b) => a.x - b.x);
  const latest = valid[valid.length - 1];
  if (!latest) throw new Error("暂无有效净值");
  // Eastmoney dates are midnight Asia/Shanghai; keep the provider's calendar day.
  const asOf = new Date(latest.x + 8 * 3600000).toISOString().slice(0, 10);
  return { key: `fund:${code}`, name, price: String(latest.y), asOf, fetchedAt: now.toISOString() };
}
export function parseStockQuote(holding: Pick<AssetHolding, "code" | "kind">, source: string, now: Date): AssetQuote {
  const literal = new RegExp(`v_${holding.code}="([^"\\r\\n]*)"`).exec(source)?.[1];
  if (!literal) throw new Error("行情代码或返回格式不匹配");
  const fields = literal.split("~"), price = fields[3], time = fields[30];
  if (fields[2] !== holding.code.slice(2) || !price || decimal(price).lte(0) || !/^\d{14}$/.test(time ?? "")) throw new Error("暂无有效股票报价");
  const day = `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
  if (!isValidIsoDate(day) || +time.slice(8, 10) > 23 || +time.slice(10, 12) > 59 || +time.slice(12, 14) > 59) throw new Error("报价时间无效");
  const asOf = `${day}T${time.slice(8, 10)}:${time.slice(10, 12)}:${time.slice(12, 14)}+08:00`;
  if (Date.parse(asOf) > now.getTime() + 60000) throw new Error("报价时间晚于当前时间");
  return { key: quoteKey(holding.kind, holding.code), name: fields[1] || holding.code, price: decimal(price).toFixed(), asOf, fetchedAt: now.toISOString() };
}
export function quoteDue(holding: AssetHolding, quote: AssetQuote | undefined, now: Date, force = false): boolean {
  if (decimal(holding.quantity).eq(0) && holding.amountBasisCents === undefined) return false;
  if (quote?.error && quote.attemptedAt && now.getTime() - Date.parse(quote.attemptedAt) < 15 * 60000) return false;
  return force || (holding.amountBasisCents !== undefined && holding.quantity === "0") || !quote || now.getTime() - Date.parse(quote.fetchedAt) >= (holding.kind === "fund" ? 6 * 3600000 : 15 * 60000);
}
export class AssetQuoteMonitor {
  private stopped = false;
  private running: Promise<void> | null = null;
  private rerun = false;
  private connections = 0;
  private inflight = new Map<string, Promise<AssetQuote>>();
  private failedLookups = new Map<string, { at: number; message: string }>();
  constructor(private state: () => AssetState, private fetch: QuoteFetcher,
    private commit: (quotes: AssetQuote[]) => Promise<void>, private clock = () => new Date(), private timeoutMs = 30000) {}
  stop(): void { this.stopped = true; }
  lookup(kind: SecurityKind, input: string): Promise<AssetQuote> {
    const code = normalizeCode(kind, input), key = quoteKey(kind, code), now = this.clock();
    if (this.stopped) return Promise.reject(new Error("插件已关闭，请重新打开资产页"));
    const failed = this.failedLookups.get(key);
    if (failed && now.getTime() - failed.at < 15 * 60000) return Promise.reject(new Error(`${failed.message}，请稍后重试`));
    const cached = this.state().quotes[key];
    if (cached && decimal(cached.price).gt(0) && now.getTime() - Date.parse(cached.fetchedAt) < (kind === "fund" ? 6 * 3600000 : 15 * 60000)) return Promise.resolve({ ...cached });
    if (!this.inflight.has(key) && this.connections >= 2) return Promise.reject(new Error("行情正在更新，请稍后再保存"));
    return this.requestQuote(kind, code).catch(error => {
      if (!this.stopped) this.failedLookups.set(key, { at: now.getTime(), message: error instanceof Error ? error.message : "行情查询失败" });
      throw error;
    });
  }
  refresh(force = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) { this.rerun = true; return this.running; }
    this.running = this.run(force).finally(() => {
      this.running = null;
      if (this.rerun && !this.stopped) { this.rerun = false; void this.refresh().catch(() => {}); }
    });
    return this.running;
  }
  private async run(force: boolean): Promise<void> {
    const state = this.state(), now = this.clock(), unique = new Map<string, AssetHolding>();
    const activeAccounts = new Set(state.accounts.filter(a => !a.archived).map(a => a.id));
    for (const h of state.holdings) if (activeAccounts.has(h.accountId) && quoteDue(h, state.quotes[quoteKey(h.kind, h.code)], now, force)) unique.set(quoteKey(h.kind, h.code), { ...h });
    const jobs = [...unique.values()], updates: AssetQuote[] = [];
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, async () => {
      while (!this.stopped && this.connections < 2 && index < jobs.length) {
        const h = jobs[index++], key = quoteKey(h.kind, h.code), old = this.state().quotes[key];
        try {
          updates.push(await this.requestQuote(h.kind, h.code));
        } catch (error) {
          updates.push({ key, name: old?.name ?? h.name, price: old?.price ?? "0", asOf: old?.asOf ?? "", fetchedAt: old?.fetchedAt ?? now.toISOString(), attemptedAt: this.clock().toISOString(), error: error instanceof Error ? error.message : "行情更新失败" });
        }
      }
    }));
    if (!this.stopped && updates.length) await this.commit(updates);
  }
  private requestQuote(kind: SecurityKind, code: string): Promise<AssetQuote> {
    const key = quoteKey(kind, code), existing = this.inflight.get(key);
    if (existing) return existing;
    const request = (async () => {
      const url = kind === "fund" ? `https://fund.eastmoney.com/pingzhongdata/${code}.js` : `https://qt.gtimg.cn/q=${code}`;
      const response = await this.fetchBounded(url);
      if (this.stopped) throw new Error("插件已关闭");
      let source = response.text;
      if (kind !== "fund" && response.arrayBuffer) { try { source = new TextDecoder("gb18030").decode(response.arrayBuffer); } catch { /* Keep requestUrl text. */ } }
      const quote = kind === "fund" ? parseFundQuote(code, source, this.clock()) : parseStockQuote({ kind, code }, source, this.clock());
      const old = this.state().quotes[key];
      if (old && Date.parse(quote.asOf) < Date.parse(old.asOf)) throw new Error("数据源返回较旧行情，已保留上次报价");
      return quote;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, request); return request;
  }
  private async fetchBounded(url: string): Promise<QuoteResponse> {
    this.connections++;
    // Obsidian requestUrl cannot cancel the transport. Even after a UI timeout,
    // retain the connection slot until the native request really settles.
    const connection = Promise.resolve().then(() => this.fetch(url)).finally(() => { this.connections--; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("行情请求超时，保留上次值")), this.timeoutMs); });
    try { return await Promise.race([connection, timeout]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
