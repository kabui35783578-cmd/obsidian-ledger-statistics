import type { TFile, Vault } from "obsidian";

export const VAULT_DATA_FOLDER = "记账统计数据";
export const VAULT_DATA_PATH = `${VAULT_DATA_FOLDER}/状态.json`;
export const SHARED_SETTING_KEYS = [
  "salaryCycleStart", "salaryCycles", "assets", "reportPreferences", "reportCaches", "reportObjectRules",
  "fixedExpenses", "insightHistory", "ledgerFolder", "excludedCategories", "salaryCents", "balanceCalibration",
  "balanceCalibrationNote", "trendDateNotes", "financeAdviceCache", "dailyBudgetCents", "budgetCategory",
  "includeStarredInBudget", "starredRecordIds"
] as const;

type Values = Record<string, unknown>;
interface Cell { clock: number; device: string; value?: unknown; deleted?: true }
export interface VaultDataDocument {
  format: "ledger-statistics";
  version: 1;
  seen: Record<string, number>;
  entries: Record<string, Cell>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const equal = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Values)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function record(value: unknown): value is Values { return !!value && typeof value === "object" && !Array.isArray(value); }
const id = (value: unknown): string => record(value) && typeof value.id === "string" ? value.id : "";
interface Collection { path: string[]; identity: (value: unknown) => string; set?: boolean }
const collections: Collection[] = [
  { path: ["salaryCycles"], identity: v => record(v) ? String(v.cycleStart ?? "") : "" },
  { path: ["reportCaches"], identity: v => record(v) ? JSON.stringify([v.fingerprint, v.configuration]) : "" },
  { path: ["fixedExpenses"], identity: id },
  { path: ["insightHistory"], identity: v => record(v) ? JSON.stringify([v.cycle, v.id, v.date]) : "" },
  { path: ["starredRecordIds"], identity: v => typeof v === "string" ? v : "", set: true },
  ...["accounts", "holdings", "events"].map(key => ({ path: ["assets", key], identity: id })),
  { path: ["assets", "epochs"], identity: v => record(v) ? JSON.stringify([v.accountId, v.from]) : "" },
  { path: ["assets", "snapshots"], identity: v => record(v) ? String(v.date ?? "") : "" }
];
const dictionaries = [["trendDateNotes"], ["assets", "quotes"], ["assets", "recordAssignments"]];
const assetScalars = ["version", "defaultCashId", "hideAmounts", "excludeFixed"];
const keyOf = (path: string[]): string => JSON.stringify(path);
function get(data: Values, path: string[]): unknown { return path.reduce<unknown>((v, k) => record(v) ? v[k] : undefined, data); }
function put(data: Values, path: string[], value: unknown): void {
  let target = data;
  for (const k of path.slice(0, -1)) {
    if (!record(target[k])) Object.defineProperty(target, k, { value: {}, enumerable: true, writable: true, configurable: true });
    target = target[k] as Values;
  }
  Object.defineProperty(target, path[path.length - 1], { value, enumerable: true, writable: true, configurable: true });
}
export function sharedSettings(settings: object): Values {
  return Object.fromEntries(SHARED_SETTING_KEYS.filter(k => Object.prototype.hasOwnProperty.call(settings, k)).map(k => [k, clone((settings as Values)[k])]));
}
/** Logical records stay atomic; large saved report snapshots are never expanded into thousands of registers. */
export function flattenShared(data: Values): Map<string, unknown> {
  const units = new Map<string, unknown>();
  const special = new Set(["assets", ...collections.map(c => c.path[0]), ...dictionaries.map(p => p[0])]);
  for (const k of SHARED_SETTING_KEYS) if (!special.has(k) && data[k] !== undefined) units.set(keyOf([k]), clone(data[k]));
  for (const k of assetScalars) if (get(data, ["assets", k]) !== undefined) units.set(keyOf(["assets", k]), clone(get(data, ["assets", k])));
  for (const c of collections) {
    const values = get(data, c.path);
    if (!Array.isArray(values)) continue;
    const order: string[] = [];
    for (const value of values) {
      const identity = c.identity(value);
      if (!identity || order.includes(identity)) continue;
      order.push(identity); units.set(keyOf([...c.path, identity]), clone(value));
    }
    if (!c.set) units.set(keyOf(["$order", ...c.path]), order);
  }
  for (const path of dictionaries) {
    const values = get(data, path);
    if (record(values)) for (const [k, v] of Object.entries(values)) units.set(keyOf([...path, k]), clone(v));
  }
  return units;
}
function allowedKey(key: string): boolean {
  let path: unknown; try { path = JSON.parse(key); } catch { return false; }
  if (!Array.isArray(path) || !path.every(p => typeof p === "string") || keyOf(path) !== key) return false;
  if (path[0] === "$order") return collections.some(c => !c.set && equal(path.slice(1), c.path));
  if (collections.some(c => path.length === c.path.length + 1 && equal(path.slice(0, -1), c.path))) return true;
  if (dictionaries.some(p => path.length === p.length + 1 && equal(path.slice(0, -1), p))) return true;
  if (path.length === 2 && path[0] === "assets") return assetScalars.includes(path[1]);
  return path.length === 1 && (SHARED_SETTING_KEYS as readonly string[]).includes(path[0])
    && !["assets", ...collections.map(c => c.path[0]), ...dictionaries.map(p => p[0])].includes(path[0]);
}
function validValue(key: string, value: unknown): boolean {
  const path: string[] = JSON.parse(key);
  if (path[0] === "$order") return Array.isArray(value) && value.every(v => typeof v === "string");
  const collection = collections.find(c => path.length === c.path.length + 1 && equal(path.slice(0, -1), c.path));
  if (collection) return collection.identity(value) === path[path.length - 1] && (collection.set ? typeof value === "string" : record(value));
  if (path[0] === "trendDateNotes" || path[1] === "recordAssignments") return typeof value === "string";
  if (path[1] === "quotes") return record(value) && typeof value.price === "string" && typeof value.asOf === "string";
  if (path[0] === "assets") return path[1] === "version" ? value === 1 : path[1] === "defaultCashId" ? typeof value === "string" : typeof value === "boolean";
  if (["salaryCents", "dailyBudgetCents"].includes(path[0])) return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (path[0] === "includeStarredInBudget") return typeof value === "boolean";
  if (path[0] === "excludedCategories") return Array.isArray(value) && value.every(v => typeof v === "string");
  if (["balanceCalibration", "financeAdviceCache"].includes(path[0])) return value === null || record(value);
  if (path[0] === "reportPreferences") return record(value);
  return typeof value === "string";
}
function materialize(units: Map<string, unknown>, defaults: Values): Values {
  const result = clone(defaults);
  for (const c of collections) put(result, c.path, []);
  for (const path of dictionaries) put(result, path, {});
  for (const [key, value] of units) {
    const path: string[] = JSON.parse(key);
    if (path[0] === "$order" || collections.some(c => path.length === c.path.length + 1 && equal(path.slice(0, -1), c.path))) continue;
    put(result, path, clone(value));
  }
  for (const c of collections) {
    const items = [...units].filter(([key]) => { const p: string[] = JSON.parse(key); return p.length === c.path.length + 1 && equal(p.slice(0, -1), c.path); });
    const order = units.get(keyOf(["$order", ...c.path]));
    const ranks = new Map((Array.isArray(order) ? order : []).map((v, i) => [v, i]));
    const last = (key: string): string => { const path: string[] = JSON.parse(key); return path[path.length - 1]; };
    items.sort(([a], [b]) => (ranks.get(last(a)) ?? Infinity) - (ranks.get(last(b)) ?? Infinity) || a.localeCompare(b));
    const values = items.map(([, v]) => clone(v));
    if (c.path[0] === "reportCaches") values.sort((a, b) => String((a as Values).generatedAt).localeCompare(String((b as Values).generatedAt)));
    if (c.path[1] === "snapshots") values.sort((a, b) => String((a as Values).date).localeCompare(String((b as Values).date)));
    put(result, c.path, values);
  }
  return result;
}
const emptyDocument = (): VaultDataDocument => ({ format: "ledger-statistics", version: 1, seen: {}, entries: {} });
export function parseVaultData(text: string): VaultDataDocument {
  let doc: unknown; try { doc = JSON.parse(text); } catch { throw new Error("同步数据文件无法解析，已停止写入并保留本机副本"); }
  if (!record(doc) || doc.format !== "ledger-statistics" || doc.version !== 1 || !record(doc.seen) || !record(doc.entries)
    || Object.keys(doc).some(k => !["format", "version", "seen", "entries"].includes(k))) throw new Error("同步数据格式或版本不支持，已停止写入");
  const validClock = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
  for (const [device, clock] of Object.entries(doc.seen)) if (!/^[\w-]{1,100}$/.test(device) || ["__proto__", "constructor", "prototype"].includes(device) || !validClock(clock)) throw new Error("同步版本信息损坏");
  for (const [key, cell] of Object.entries(doc.entries)) {
    if (!allowedKey(key) || !record(cell) || !validClock(cell.clock) || typeof cell.device !== "string" || !Object.hasOwnProperty.call(doc.seen, cell.device)
      || (doc.seen[cell.device] as number) < cell.clock || (cell.deleted !== undefined && cell.deleted !== true)
      || (!cell.deleted && (!Object.hasOwnProperty.call(cell, "value") || !validValue(key, cell.value)))) throw new Error("同步数据条目损坏，已停止写入");
  }
  return doc as unknown as VaultDataDocument;
}
export function mergeVaultData(a: VaultDataDocument, b: VaultDataDocument): { document: VaultDataDocument; conflicts: string[] } {
  const doc = clone(a), conflicts: string[] = [];
  for (const [device, clock] of Object.entries(b.seen)) doc.seen[device] = Math.max(doc.seen[device] ?? 0, clock);
  for (const [key, right] of Object.entries(b.entries)) {
    const left = doc.entries[key];
    if (!left) { doc.entries[key] = clone(right); continue; }
    const sameValue = left.deleted === right.deleted && equal(left.value, right.value);
    if (!sameValue && left.device === right.device && left.clock === right.clock) throw new Error("同步版本重复但内容不同，已停止写入");
    if (!sameValue && JSON.parse(key)[0] !== "$order" && left.clock > (b.seen[left.device] ?? 0) && right.clock > (a.seen[right.device] ?? 0)) conflicts.push(key);
    if (right.clock > left.clock || (right.clock === left.clock && right.device > left.device)) doc.entries[key] = clone(right);
  }
  return { document: doc, conflicts };
}
function documentData(doc: VaultDataDocument, defaults: Values): Values {
  const units = flattenShared(defaults);
  for (const [key, cell] of Object.entries(doc.entries)) { if (cell.deleted) units.delete(key); else units.set(key, clone(cell.value)); }
  return materialize(units, defaults);
}
export function editVaultData(doc: VaultDataDocument, before: Values, after: Values, device: string, now = Date.now()): VaultDataDocument {
  const base = flattenShared(before), next = flattenShared(after), changed = [...new Set([...base.keys(), ...next.keys()])].filter(k => !equal(base.get(k), next.get(k)));
  if (!changed.length) return doc;
  const result = clone(doc), clock = Math.max(now, ...Object.values(doc.seen).map(n => n + 1), 1);
  result.seen[device] = clock;
  for (const k of changed) result.entries[k] = next.has(k) ? { clock, device, value: next.get(k) } : { clock, device, deleted: true };
  return result;
}

export class VaultDataStore {
  private document = emptyDocument();
  private replicaText = "";
  private ready = false;
  private missing = false;
  private backupSequence = 0;
  private stopped = false;
  private diskText = "";
  private materialized?: Values;
  private conflictsReported = new Set<string>();
  readonly replicaPath: string;
  readonly backupFolder: string;
  constructor(private vault: Vault, pluginDir: string, readonly device: string, private defaults: Values,
    private notify: (message: string) => void, private clock = Date.now) {
    this.replicaPath = `${pluginDir}/sync-replica.json`;
    this.backupFolder = `${pluginDir}/sync-backups`;
  }
  get data(): Values { return clone(this.materialized ??= documentData(this.document, this.defaults)); }
  stop(): void { this.stopped = true; }
  private async folder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!await this.vault.adapter.exists(current)) {
        try { await this.vault.createFolder(current); } catch (error) { if (!await this.vault.adapter.exists(current)) throw error; }
      }
    }
  }
  async backup(label: string, content = stable(this.document)): Promise<string> {
    await this.folder(this.backupFolder);
    const path = `${this.backupFolder}/${label}-${this.clock()}-${++this.backupSequence}.json`;
    await this.vault.adapter.write(path, content);
    return path;
  }
  async initialize(legacy: Values, migrate: boolean, legacyTime: number): Promise<Values> {
    if (await this.vault.adapter.exists(this.replicaPath)) {
      this.replicaText = await this.vault.adapter.read(this.replicaPath);
      this.document = parseVaultData(this.replicaText);
    }
    const file = this.vault.getAbstractFileByPath(VAULT_DATA_PATH);
    if (file) this.document = await this.join(this.document, parseVaultData(await this.vault.read(file as TFile)));
    if (migrate) {
      // Defaults on a newly installed phone must never replace real synced data.
      const seed = editVaultData(emptyDocument(), this.defaults, legacy, this.device, Math.max(1, legacyTime));
      this.document = await this.join(this.document, seed);
    }
    this.ready = true;
    if (!file && !migrate) { this.missing = true; await this.mirror(); this.notify("同步数据文件缺失，已保留本机副本；请在插件设置中恢复数据文件。"); }
    else await this.persist(this.document, true);
    return this.data;
  }
  private async join(a: VaultDataDocument, b: VaultDataDocument): Promise<VaultDataDocument> {
    const { document, conflicts } = mergeVaultData(a, b);
    const fresh = conflicts.filter(key => !this.conflictsReported.has(`${key}:${stable([a.entries[key], b.entries[key]])}`));
    if (fresh.length) {
      await this.backup("conflict", JSON.stringify({ format: "ledger-statistics-conflict", local: a, incoming: b, conflicts: fresh }, null, 2));
      for (const key of fresh) this.conflictsReported.add(`${key}:${stable([a.entries[key], b.entries[key]])}`);
      this.notify(`发现 ${fresh.length} 项同步冲突，已保留双方备份，同一项采用较新的修改。`);
    }
    return document;
  }
  private async mirror(): Promise<void> {
    const text = stable(this.document);
    if (text === this.replicaText) return;
    await this.vault.adapter.write(this.replicaPath, text);
    this.replicaText = text;
  }
  private async persist(candidate: VaultDataDocument, allowCreate = false, attempt = 0): Promise<void> {
    if (this.stopped) throw new Error("插件已关闭，未写入同步数据");
    await this.folder(VAULT_DATA_FOLDER);
    let file = this.vault.getAbstractFileByPath(VAULT_DATA_PATH);
    if (!file) {
      if (this.missing || !allowCreate) { this.missing = true; throw new Error("同步数据文件已被删除，已停止写入；请先在设置中恢复"); }
      try { file = await this.vault.create(VAULT_DATA_PATH, stable(candidate)); }
      catch (error) { file = this.vault.getAbstractFileByPath(VAULT_DATA_PATH); if (!file) throw error; }
    }
    const diskText = await this.vault.read(file as TFile);
    const disk = parseVaultData(diskText);
    const merged = await this.join(candidate, disk);
    let committed = merged;
    let writtenText = diskText;
    if (!equal(merged, disk)) {
      // Re-read under Obsidian's file lock; a receive between read and write cannot be dropped.
      let result: string;
      try {
        result = await this.vault.process(file as TFile, text => {
          if (this.stopped) throw new Error("插件已关闭，未写入同步数据");
          if (!equal(parseVaultData(text), disk)) throw new Error("ledger-vault-retry");
          return stable(committed);
        });
      } catch (error) {
        if (error instanceof Error && error.message === "ledger-vault-retry") {
          if (attempt >= 3) throw new Error("同步文件持续变化，本次保存未写入，请稍后重试");
          return this.persist(candidate, allowCreate, attempt + 1);
        }
        throw error;
      }
      committed = parseVaultData(result);
      writtenText = result;
    }
    this.document = committed;
    this.materialized = undefined;
    this.diskText = writtenText;
    // The canonical write has already succeeded. A local cache failure must not
    // make callers roll back a successfully saved financial transaction.
    try { await this.mirror(); }
    catch { this.notify("数据文件已保存，但本机恢复副本写入失败，请检查磁盘空间和权限。"); }
  }
  async save(before: Values, after: Values): Promise<Values> {
    if (!this.ready || this.missing) throw new Error("同步数据文件不可写，请在设置中检查或恢复");
    const candidate = editVaultData(this.document, before, after, this.device, this.clock());
    await this.persist(candidate);
    return this.data;
  }
  async receive(): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(VAULT_DATA_PATH);
    if (!file) {
      if (!this.missing) this.notify("同步数据文件被移走或删除，已停止写入并保留本机副本。");
      this.missing = true;
      return false;
    }
    const text = await this.vault.read(file as TFile);
    if (text === this.diskText) { this.missing = false; return false; }
    const before = this.data, remote = parseVaultData(text);
    const merged = await this.join(this.document, remote);
    this.missing = false;
    await this.persist(merged);
    return !equal(before, this.data);
  }
  async restoreMissing(): Promise<void> {
    if (this.vault.getAbstractFileByPath(VAULT_DATA_PATH)) throw new Error("数据文件仍存在，未覆盖；请先检查文件内容");
    await this.backup("before-restore");
    this.missing = false;
    await this.persist(this.document, true);
  }
}

/** Rebase the committed result without erasing edits made while a save was awaiting I/O. */
export function rebaseShared(current: object, expected: Values, committed: Values, defaults: Values): Values {
  const actual = flattenShared(sharedSettings(current)), base = flattenShared(expected), next = flattenShared(committed);
  for (const key of new Set([...base.keys(), ...next.keys()])) if (equal(actual.get(key), base.get(key))) {
    if (next.has(key)) actual.set(key, next.get(key)); else actual.delete(key);
  }
  return materialize(actual, defaults);
}
