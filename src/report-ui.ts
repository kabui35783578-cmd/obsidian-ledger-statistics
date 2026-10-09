import { Modal, Notice } from "obsidian";
import type LedgerStatisticsPlugin from "./main";
import { addDays, formatCents, isValidIsoDate, isoFromDate, LedgerRecord } from "./core";
import { buildReportSnapshot, localSpendingReport, normalizeReportPreferences, reportDays, reportPeriods, ReportEvidence, ReportPreferences, ReportSnapshot, SpendingReport } from "./report";
import { appendReportCache, findReportCache, reportConfiguration, requestSpendingReport } from "./report-ai";
import { sharedRequestGate } from "./request-gate";
import { createButton } from "./ui";
import { formatReportFact, formatReportText, reportPlainLanguage, reportProgress, reportTextParts } from "./report-presentation";

export class ReportEvidenceModal extends Modal {
  constructor(plugin: LedgerStatisticsPlugin, private snapshot: ReportSnapshot, private evidenceIds: string[], private openRecord: (r: LedgerRecord) => Promise<void>, private generatedAt?: string) { super(plugin.app); }
  onOpen(): void {
    this.setTitle("报告证据");
    this.contentEl.empty(); this.contentEl.addClass("ledger-report-evidence");
    if (this.generatedAt) this.contentEl.createEl("p", { cls: "ledger-report-muted", text: `以下为 ${new Date(this.generatedAt).toLocaleString("zh-CN")} 生成时的依据；打开来源文件会显示文件当前内容。` });
    const entries = this.snapshot.evidence.filter(e => this.evidenceIds.includes(e.id));
    for (const e of entries) {
      const section = this.contentEl.createDiv({ cls: "ledger-report-evidence-section" });
      section.createEl("h3", { text: reportPlainLanguage(e.label) });
      if (e.scope) section.createEl('p', {cls:'ledger-report-evidence-scope',text:`分析对象：${e.scope.kind==='all'?'全部筛选后支出':e.scope.label} · ${e.scope.accounting==='consumption'?'消费支出':'全部记账口径'}`});
      e.ranges.forEach(r => section.createEl("p", { cls: "ledger-report-muted", text: `${reportPlainLanguage(r.label)}：${r.range.start} 至 ${r.range.end}` }));
      const p=this.snapshot.preferences;
      if (p.category || p.keyword || !p.includeStarred) section.createEl('p',{cls:'ledger-report-muted',text:`筛选：${p.category||'全部分类'}${p.keyword?` · 关键词 ${p.keyword}`:''}${!p.includeStarred?' · 排除星标':''}`});
      const caution=e.readings?.counter[0];
      if(caution)section.createEl('p',{cls:'ledger-report-limit',text:`需同时考虑：${formatReportText(caution.text)}`});
      const interpretation=(e.readings?.supporting.length||e.readings?.counter.length)?section.createEl('details',{cls:'ledger-report-evidence-group'}):undefined;
      interpretation?.createEl('summary',{text:'解读线索：观察与相反信息'});
      const readings = (label:string, items:NonNullable<ReportEvidence['readings']>['supporting']) => {
        if (!items.length || !interpretation) return;
        const group=interpretation.createDiv({cls:'ledger-report-readings'});group.createEl('h4',{text:label});
        const list=group.createEl('ul');items.forEach(item=>list.createEl('li',{text:formatReportText(item.text)}));
      };
      readings('观察线索',e.readings?.supporting??[]);readings('需要同时考虑',e.readings?.counter??[]);
      const facts = (parent:HTMLElement, keys:string[]) => {
        const list=parent.createEl('dl',{cls:'ledger-report-facts'});
        for(const key of keys){const f=e.facts[key];if(!f)continue;const value=formatReportFact(key,f);list.createEl('dt',{text:formatReportText(f.label)});list.createEl('dd',{text:value.text,cls:value.tone?`ledger-report-${value.tone}`:''});}
      };
      if(e.sections?.length){
        const shown=new Set<string>();
        e.sections.forEach(group=>{const details=section.createEl('details',{cls:'ledger-report-evidence-group'});details.open=group.expanded??false;details.createEl('summary',{text:group.label});facts(details,group.keys);group.keys.forEach(k=>shown.add(k));});
        const rest=Object.keys(e.facts).filter(k=>!shown.has(k));if(rest.length)facts(section,rest);
      }else facts(section,Object.keys(e.facts));
      if(e.categories?.length){
        const categories=section.createEl('details',{cls:'ledger-report-evidence-group ledger-report-categories'});
        categories.createEl('summary',{text:`全部分类增减（${e.categories.length}类）`});
        categories.createEl('p',{cls:'ledger-report-muted',text:this.snapshot.comparable?'按金额变化幅度排序；两期长度不同时，上期按观察日折算。新增只表示上期该类未记录金额。':'可比数据不足，仅列出已记录分类金额，不据此判断新增或增减。'});
        e.categories.forEach(c=>{
          const card=categories.createDiv({cls:'ledger-report-category'});card.createEl('h4',{text:c.label});
          if(this.snapshot.comparable&&c.status!=='existing')card.createEl('p',{cls:'ledger-report-muted',text:c.status==='new'?'上期该分类未记录金额，本期有记录':'本期该分类未记录金额，上期有记录'});
          const list=card.createEl('dl',{cls:'ledger-report-facts'});
          const row=(key:string,label:string,value:number)=>{const formatted=formatReportFact(key,{label,value,unit:'元'});list.createEl('dt',{text:label});list.createEl('dd',{text:formatted.text,cls:formatted.tone?`ledger-report-${formatted.tone}`:''});};
          row('current','本期已记录金额',c.current);row('previous','上期已记录金额',c.previous);
          if(c.difference!==undefined){if(c.previousScaled!==c.previous)row('scaled','上期按观察日折算金额',c.previousScaled);row('category_difference','金额差额',c.difference);}
        });
      }
      e.limits.forEach(t => section.createEl("p", { cls: "ledger-report-limit", text: formatReportText(t) }));
    }
    const ids = new Set(entries.flatMap(e => e.recordIds));
    const records = this.snapshot.records.filter(r => ids.has(r.id)).sort((a, b) => b.date.localeCompare(a.date) || b.cents - a.cents);
    this.contentEl.createEl("h3", { text: `相关流水（${records.length} 笔）` });
    const list = this.contentEl.createDiv({ cls: "ledger-report-records" });
    // Paginate large evidence sets without hiding which records contributed.
    let shown = 0;
    const more = createButton(this.contentEl, "显示更多流水");
    const show = () => {
      records.slice(shown, shown + 40).forEach(r => {
        const button = createButton(list, `${r.date} · ${r.category} · ${formatCents(r.cents)} · ${r.note || "无备注"}`);
        button.addClass("ledger-report-record");
        button.addEventListener("click", () => { this.close(); void this.openRecord(r); });
      });
      shown += 40; more.hidden = shown >= records.length;
    };
    more.addEventListener("click", show); show();
  }
  onClose(): void { this.contentEl.empty(); }
}

export class ReportPanel {
  private controller: AbortController | null = null;
  private loading = false;
  private error = "";
  private requestFingerprint = "";
  private disposed = false;
  private cachedSnapshot?: ReportSnapshot;
  private snapshotKey = "";
  constructor(private plugin: LedgerStatisticsPlugin, private redraw: () => void, private openRecord: (r: LedgerRecord) => Promise<void>) {}
  get preferences(): ReportPreferences { return normalizeReportPreferences(this.plugin.settings.reportPreferences); }
  private config() { return { endpoint: this.plugin.settings.financeAiEndpoint, model: this.plugin.settings.financeAiModel, apiKey: this.plugin.settings.financeAiApiKey }; }
  snapshot(now = new Date()): ReportSnapshot {
    const repository = this.plugin.repository;
    const key = JSON.stringify([repository.contentRevision ?? [...repository.files.values()], this.preferences, isoFromDate(now), this.plugin.settings.excludedCategories, this.plugin.settings.starredRecordIds, this.plugin.settings.reportObjectRules]);
    if (this.cachedSnapshot && key === this.snapshotKey) return this.cachedSnapshot;
    this.snapshotKey = key;
    return this.cachedSnapshot = buildReportSnapshot([...repository.files.values()], this.preferences, now, this.plugin.settings.excludedCategories, this.plugin.settings.starredRecordIds, {objectRules:this.plugin.settings.reportObjectRules});
  }
  cancel(): void { this.controller?.abort(); this.controller = null; this.loading = false; }
  dispose(): void { this.disposed = true; this.cancel(); }
  private change(patch: Partial<ReportPreferences>): void {
    this.cancel(); this.error = "";
    this.plugin.settings.reportPreferences = { ...this.preferences, ...patch };
    void this.plugin.saveSettings(false, false).catch(() => new Notice("报告筛选保存失败"));
    this.redraw();
  }
  private shift(delta: number): void {
    const p = this.preferences;
    if (p.mode === "custom") {
      const n = reportDays(p.customRange);
      const range = { start: addDays(p.customRange.start, n * delta), end: addDays(p.customRange.end, n * delta) };
      if (range.start <= isoFromDate(new Date())) this.change({ customRange: range });
    } else {
      const now = new Date(), current = reportPeriods(p, now).fullRange;
      const boundary = delta < 0 ? addDays(current.start, -1) : addDays(current.end, 1);
      const target = reportPeriods({ ...p, offset: 0, anchorDate: undefined }, new Date(`${boundary}T12:00:00`)).fullRange;
      if (target.start > isoFromDate(now)) return;
      const historical = target.end < isoFromDate(now);
      this.change({ offset: historical ? 1 : 0, anchorDate: historical ? target.start : undefined });
    }
  }
  render(parent: HTMLElement): void {
    const snapshot = this.snapshot(), p = this.preferences;
    const configuration = reportConfiguration(this.config());
    if (this.loading && this.requestFingerprint !== `${snapshot.fingerprint}:${configuration}`) this.cancel();
    // Always show the last successful manual generation, even after data/configuration changes.
    const caches = this.plugin.settings.reportCaches ?? [];
    const cache = caches[caches.length - 1];
    const changed = !!cache && (cache.fingerprint !== snapshot.fingerprint || cache.configuration !== configuration);
    // Legacy caches can use current evidence only when their exact fingerprint still matches.
    const reportSnapshot = cache ? cache.snapshot ?? (findReportCache(caches, snapshot, this.config()) === cache ? snapshot : undefined) : snapshot;
    const shell = parent.createDiv({ cls: "ledger-report" });
    const toolbar = shell.createDiv({ cls: "ledger-report-toolbar" });
    const select = (label: string, value: string, options: Array<[string, string]>, changed: (value: string) => void) => {
      const field = toolbar.createEl("label", { cls: "ledger-field" }); field.createSpan({ text: label });
      const el = field.createEl("select"); options.forEach(([v, text]) => el.createEl("option", { value: v, text })); el.value = value;
      el.addEventListener("change", () => changed(el.value)); return el;
    };
    select("报告期间", p.mode, [["salary", "工资周期"], ["month", "自然月"], ["custom", "自定义"]], mode => this.change({ mode: mode as ReportPreferences["mode"], offset: 0, anchorDate: undefined, ...(mode === "custom" ? { customRange: { ...snapshot.range } } : {}) }));
    const nav = toolbar.createDiv({ cls: "ledger-report-period-nav" });
    createButton(nav, "上一期").addEventListener("click", () => this.shift(-1));
    const next = createButton(nav, "下一期"); next.disabled = p.mode === "custom" ? addDays(p.customRange.start, reportDays(p.customRange)) > isoFromDate(new Date()) : p.offset === 0;
    next.addEventListener("click", () => this.shift(1));
    if (p.mode === "custom") for (const [key, label] of [["start", "开始"], ["end", "结束"]] as const) {
      const field = toolbar.createEl("label", { cls: "ledger-field" }); field.createSpan({ text: label });
      const input = field.createEl("input", { type: "date", value: p.customRange[key] });
      input.addEventListener("change", () => {
        const range = { ...p.customRange, [key]: input.value };
        if (!isValidIsoDate(range.start) || !isValidIsoDate(range.end) || range.start > range.end || new Date(`${range.start}T12:00:00`) > new Date() || reportDays(range) > 366) { new Notice("请选择有效日期，开始日期不晚于今天，范围不超过一年"); input.value = p.customRange[key]; return; }
        this.change({ customRange: range });
      });
    }
    select("口径", p.scope, [["consumption", "消费支出"], ["all", "全部支出"]], scope => this.change({ scope: scope as ReportPreferences["scope"] }));
    const categories = [...new Set([...this.plugin.repository.files.values()].flatMap(f => f.records.map(r => r.category)))].sort();
    select("分类", p.category, [["", "全部分类"], ...categories.map(c => [c, c] as [string, string])], category => this.change({ category }));
    const keyword = toolbar.createEl("label", { cls: "ledger-field" }); keyword.createSpan({ text: "关键词" });
    const input = keyword.createEl("input", { type: "search", value: p.keyword, placeholder: "分类或备注" });
    input.addEventListener("change", () => this.change({ keyword: input.value }));
    select("星标记录", p.includeStarred ? "include" : "exclude", [["include", "包含星标"], ["exclude", "排除星标"]], value => this.change({ includeStarred: value === "include" }));
    shell.createEl("p", { cls: "ledger-report-period", text: `${snapshot.label} · ${snapshot.range.start} 至 ${snapshot.range.end}${snapshot.range.end !== snapshot.fullRange.end ? "（进行中）" : ""}` });
    shell.createEl("p", { cls: "ledger-report-muted", text: `对比 ${snapshot.previousRange.start} 至 ${snapshot.previousRange.end} · 可用完整历史 ${snapshot.historicalRanges.length} 期${p.category || p.keyword || !p.includeStarred ? " · 局部报告" : ""}` });
    const actions = shell.createDiv({ cls: "ledger-report-actions" });
    const configured = this.plugin.settings.financeAiEnabled && !!this.config().endpoint.trim() && !!this.config().model.trim();
    const generate = createButton(actions, this.loading ? "正在生成…" : cache ? "重新生成报告" : "生成报告");
    generate.disabled = this.loading || !configured;
    generate.addEventListener("click", () => void this.generate(snapshot));
    actions.createSpan({ cls: "ledger-report-muted", text: cache ? `AI 报告 · ${new Date(cache.generatedAt).toLocaleString("zh-CN")}` : configured ? "本地分析 · 点击生成 AI 报告" : "本地分析 · 配置并启用 AI 后可生成完整报告" });
    const missingEvidence = cache && !reportSnapshot;
    const notice = missingEvidence ? `旧报告${changed ? "可更新，" : "无依据，"}重新生成可补全依据。` : changed ? "报告可更新，当前保留旧版。" : "";
    if (notice) shell.createEl("p", { cls: "ledger-report-status", text: notice });
    if (cache && reportSnapshot) shell.createEl("p", { cls: "ledger-report-muted", text: `报告生成范围：${reportSnapshot.label} · ${reportSnapshot.range.start} 至 ${reportSnapshot.range.end} · ${reportSnapshot.preferences.scope === "all" ? "全部支出" : "消费支出"} · ${reportSnapshot.preferences.category || "全部分类"}${reportSnapshot.preferences.keyword ? ` · 关键词 ${reportSnapshot.preferences.keyword}` : ""}${!reportSnapshot.preferences.includeStarred ? " · 排除星标" : ""}` });
    if (this.error) shell.createEl("p", { cls: "ledger-report-status", text: `${this.error}。${cache ? "上次生成的报告仍保留。" : "当前仍可查看本地分析。"}` });
    renderReportArticle(shell, cache?.report ?? localSpendingReport(snapshot), reportSnapshot, ids => {
      if (reportSnapshot) new ReportEvidenceModal(this.plugin, reportSnapshot, ids, this.openRecord, cache?.generatedAt).open();
    });
    const qualitySnapshot = reportSnapshot ?? snapshot;
    const details = shell.createEl("details", { cls: "ledger-report-quality" }); details.createEl("summary", { text: "数据范围与分析口径" });
    details.createEl("p", { cls: "ledger-report-muted", text: cache && reportSnapshot ? "以下为报告生成时的数据范围与分析口径。" : "以下为当前筛选的数据范围与分析口径。" });
    details.createEl("p", { text: "缺失日期视为未知；明确零消费账本视为零。笔数是记账记录，不代表杯数、人数或商品单价。按日期分析，不推断小时级购买顺序。" });
    for (const [i, c] of qualitySnapshot.coverage.entries()) {
      if (i >= 2 && c.complete) continue;
      details.createEl("p", { text: `${i === 0 ? "本期" : i === 1 ? "上期" : `历史第${i - 1}期`} ${c.range.start} 至 ${c.range.end}：${c.complete ? "账本核验通过" : `缺少 ${c.missingDates.length} 天账本，${c.problems.length} 个异常账本`}` });
      if (c.missingDates.length) details.createEl("p", { cls: "ledger-report-muted", text: c.missingDates.join("、") });
      for (const problem of c.problems) {
        const b = createButton(details, `${problem.date}：${problem.reason}`);
        b.addEventListener("click", () => void this.plugin.app.workspace.openLinkText(problem.path, "", true));
      }
    }
    for (const path of qualitySnapshot.undatedPaths) {
      const b = createButton(details, `日期无法识别：${path}`); b.addEventListener("click", () => void this.plugin.app.workspace.openLinkText(path, "", true));
    }
  }
  private async generate(snapshot: ReportSnapshot): Promise<void> {
    if (this.loading || this.disposed) return;
    snapshot = JSON.parse(JSON.stringify(snapshot)) as ReportSnapshot;
    const config = this.config(), configuration = reportConfiguration(config), controller = new AbortController();
    this.controller = controller; this.loading = true; this.error = ""; this.requestFingerprint = `${snapshot.fingerprint}:${configuration}`; this.redraw();
    try {
      const report = await requestSpendingReport(config, snapshot, controller.signal, sharedRequestGate(`ai:${this.plugin.app.vault.getName()}`));
      if (this.disposed || controller.signal.aborted || this.snapshot().fingerprint !== snapshot.fingerprint || reportConfiguration(this.config()) !== configuration || !this.plugin.settings.financeAiEnabled) return;
      const previousCaches = this.plugin.settings.reportCaches ?? [];
      const nextCaches = appendReportCache(previousCaches, { fingerprint: snapshot.fingerprint, configuration, generatedAt: new Date().toISOString(), report, snapshot });
      this.plugin.settings.reportCaches = nextCaches;
      try { await this.plugin.saveSettings(false, false); }
      catch (error) {
        if (this.plugin.settings.reportCaches === nextCaches) this.plugin.settings.reportCaches = previousCaches;
        throw error;
      }
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.error = error instanceof Error ? error.message : "报告生成失败";
    } finally {
      if (this.controller === controller) { this.controller = null; this.loading = false; }
      if (!this.disposed && !controller.signal.aborted) this.redraw();
    }
  }
}

export function renderReportArticle(parent: HTMLElement, report: SpendingReport, snapshot: ReportSnapshot | undefined, evidence: (ids: string[]) => void): void {
  const article = parent.createEl("article", { cls: "ledger-report-article" });
  article.createEl("h2", { text: formatReportText(report.title).replace(/\*\*/g, "") });
  if (snapshot) article.createEl("p", { cls: "ledger-report-progress", text: reportProgress(snapshot) });
  const prose = (parent: HTMLElement, text: string, cls = "") => {
    const emphasis = { remaining: 2 };
    for (const paragraph of text.split(/\n\s*\n/).filter(t => t.trim())) {
      const el = parent.createEl("p", { cls });
      let strong: HTMLElement | undefined;
      for (const part of reportTextParts(paragraph, emphasis)) {
        if (!part.bold) strong = undefined;
        else if (!strong) strong = el.createEl("strong");
        (part.bold ? strong! : el).createSpan({ text: part.text, cls: part.tone ? `ledger-report-${part.tone}` : "" });
      }
    }
  };
  if (report.summary) prose(article, report.summary, "ledger-report-summary");
  if (snapshot?.overview) {
    const b = createButton(article, "查看本期概况"); b.addClass("ledger-report-overview-citation");
    b.addEventListener("click", () => evidence([snapshot.overview!.id]));
  }
  if(snapshot && report.paragraphs.length)article.createEl('p',{cls:'ledger-report-reference-note',text:'引用按钮指向本地事实；报告的解释需结合观察与相反线索判断。'});
  report.paragraphs.forEach((p, i) => {
    const section = article.createEl("section");
    if (p.heading) section.createEl("h3", { text: formatReportText(p.heading).replace(/\*\*/g, "") });
    prose(section, p.text);
    if (!snapshot) return;
    const ids = p.evidenceIds.filter(id => snapshot.evidence.some(e => e.id === id));
    if (!ids.length) {
      section.createEl('p',{cls:'ledger-report-reference-note',text:'本段未指定有效证据引用，可展开本地分析自行核对。'});
      return;
    }
    const labels=[...new Set(ids.map(id=>{const e=snapshot.evidence.find(e=>e.id===id)!;return e.scope?.kind==='all'?'全部筛选后支出':e.scope?.label??e.label;}))];
    section.createEl('p',{cls:'ledger-report-reference-note',text:`引用对象：${labels.join('、')}${p.evidenceIds.some(id=>!ids.includes(id))?' · 部分引用未对应到本地证据':''}`});
    const b = createButton(section, `查看依据 ${["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"][i] ?? i + 1}`); b.addClass("ledger-report-citation");
    b.addEventListener("click", () => evidence(ids));
  });
  if (snapshot && (!report.paragraphs.length || report.paragraphs.some(p => !p.evidenceIds.some(id => snapshot.evidence.some(e => e.id === id)))) && snapshot.findings.length) {
    const local = article.createEl("details", { cls: "ledger-report-quality" });
    local.createEl("summary", { text: "查看本地分析与证据" });
    local.createEl('p',{text:'以下是独立计算的本地发现，供自行核对，不自动作为未指定引用段落的证明。'});
    snapshot.findings.forEach(f => {
      const b = createButton(local, formatReportText(f.title)); b.addClass("ledger-report-citation");
      b.addEventListener("click", () => evidence(f.evidenceIds));
    });
  }
}
