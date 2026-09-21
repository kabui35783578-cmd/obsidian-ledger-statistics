import { App, EventRef, TAbstractFile, TFile } from "obsidian";
import { ParsedLedgerFile, parseLedgerFile } from "./core";

export class LedgerRepository {
  private cache = new Map<string, ParsedLedgerFile>();
  private refs: EventRef[] = [];
  private notifyTimer: number | null = null;
  private generation = 0;
  private ready = false;
  private disposed = false;
  private revisions = new Map<string, number>();

  constructor(
    private app: App,
    private folder: string,
    private onChange: () => void
  ) {}

  get files(): ReadonlyMap<string, ParsedLedgerFile> {
    return this.cache;
  }

  get loaded(): boolean {
    return this.ready;
  }

  async start(): Promise<void> {
    this.bindEvents();
    await this.rescan();
  }

  async setFolder(folder: string): Promise<void> {
    this.folder = folder;
    await this.rescan();
  }

  async rescan(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.ready = false;
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isLedgerFile(file));
    const paths = new Set(files.map((file) => file.path));
    for (const path of this.cache.keys()) if (!paths.has(path)) this.cache.delete(path);
    // Bounded reads avoid flooding mobile storage. All updates share revision guards.
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
      while (index < files.length && generation === this.generation && !this.disposed) {
        await this.update(files[index++], generation);
      }
    }));
    if (generation !== this.generation || this.disposed) return;
    this.ready = true;
    this.scheduleNotify();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    for (const ref of this.refs) this.app.vault.offref(ref);
    this.refs = [];
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
  }

  private bindEvents(): void {
    this.refs.push(this.app.vault.on("create", (file) => void this.handleCreateOrModify(file)));
    this.refs.push(this.app.vault.on("modify", (file) => void this.handleCreateOrModify(file)));
    this.refs.push(this.app.vault.on("delete", (file) => this.handleDelete(file)));
    this.refs.push(this.app.vault.on("rename", (file, oldPath) => void this.handleRename(file, oldPath)));
  }

  private async handleCreateOrModify(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || !this.isLedgerFile(file)) return;
    await this.update(file, this.generation);
  }

  private async update(file: TFile, generation: number): Promise<void> {
    if (this.disposed || generation !== this.generation || !this.isLedgerFile(file)) return;
    const path = file.path;
    const revision = (this.revisions.get(path) ?? 0) + 1;
    this.revisions.set(path, revision);
    const parsed = await this.read(file, path);
    if (!this.disposed && generation === this.generation && this.revisions.get(path) === revision
      && file.path === path && this.app.vault.getAbstractFileByPath(path) === file && this.isLedgerFile(file) && parsed) {
      this.cache.set(path, parsed);
      this.scheduleNotify();
    }
  }

  private handleDelete(file: TAbstractFile): void {
    this.invalidatePath(file.path);
  }

  private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    this.invalidatePath(oldPath);
    if (file instanceof TFile) await this.handleCreateOrModify(file);
    else await this.rescan();
  }

  private invalidatePath(path: string): void {
    for (const key of new Set([...this.cache.keys(), ...this.revisions.keys(), path])) {
      if (key !== path && !key.startsWith(`${path}/`)) continue;
      this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
      this.cache.delete(key);
    }
    this.scheduleNotify();
  }

  private async read(file: TFile, path: string): Promise<ParsedLedgerFile | null> {
    try {
      return parseLedgerFile(path, await this.app.vault.read(file));
    } catch (error) {
      return {
        path,
        date: null,
        frontmatterTotalCents: null,
        records: [],
        diagnostics: [{ kind: "parse", path, reason: `读取失败：${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }

  private isLedgerFile(file: TFile): boolean {
    const folder = this.folder.replace(/^\/+|\/+$/g, "");
    return file.extension.toLowerCase() === "md" && (folder === "" || file.path.startsWith(`${folder}/`));
  }

  private scheduleNotify(): void {
    if (this.disposed) return;
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      this.onChange();
    }, 80);
  }
}
