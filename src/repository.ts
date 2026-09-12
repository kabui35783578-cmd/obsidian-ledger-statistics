import { App, EventRef, TAbstractFile, TFile } from "obsidian";
import { ParsedLedgerFile, parseLedgerFile } from "./core";

export class LedgerRepository {
  private cache = new Map<string, ParsedLedgerFile>();
  private refs: EventRef[] = [];
  private notifyTimer: number | null = null;
  private generation = 0;
  private ready = false;

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
    const generation = ++this.generation;
    const next = new Map<string, ParsedLedgerFile>();
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isLedgerFile(file));
    await Promise.all(files.map(async (file) => {
      const parsed = await this.read(file);
      if (parsed && generation === this.generation) next.set(file.path, parsed);
    }));
    if (generation !== this.generation) return;
    this.cache = next;
    this.ready = true;
    this.scheduleNotify();
  }

  dispose(): void {
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
    const parsed = await this.read(file);
    if (parsed) {
      this.cache.set(file.path, parsed);
      this.scheduleNotify();
    }
  }

  private handleDelete(file: TAbstractFile): void {
    if (this.cache.delete(file.path)) this.scheduleNotify();
  }

  private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    const removed = this.cache.delete(oldPath);
    if (file instanceof TFile && this.isLedgerFile(file)) {
      const parsed = await this.read(file);
      if (parsed) this.cache.set(file.path, parsed);
      this.scheduleNotify();
    } else if (removed) {
      this.scheduleNotify();
    }
  }

  private async read(file: TFile): Promise<ParsedLedgerFile | null> {
    try {
      return parseLedgerFile(file.path, await this.app.vault.cachedRead(file));
    } catch (error) {
      return {
        path: file.path,
        date: null,
        frontmatterTotalCents: null,
        records: [],
        diagnostics: [{ kind: "parse", path: file.path, reason: `读取失败：${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }

  private isLedgerFile(file: TFile): boolean {
    const folder = this.folder.replace(/^\/+|\/+$/g, "");
    return file.extension.toLowerCase() === "md" && (folder === "" || file.path.startsWith(`${folder}/`));
  }

  private scheduleNotify(): void {
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      this.onChange();
    }, 80);
  }
}
