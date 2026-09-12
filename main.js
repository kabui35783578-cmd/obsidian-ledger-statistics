var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LedgerStatisticsPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/repository.ts
var import_obsidian = require("obsidian");

// src/core.ts
var FULL_WIDTH_MAP = {
  "\uFF10": "0",
  "\uFF11": "1",
  "\uFF12": "2",
  "\uFF13": "3",
  "\uFF14": "4",
  "\uFF15": "5",
  "\uFF16": "6",
  "\uFF17": "7",
  "\uFF18": "8",
  "\uFF19": "9",
  "\uFF1A": ":",
  "\uFF5C": "|",
  "\uFFE5": "\xA5",
  "\uFF08": "(",
  "\uFF09": ")",
  "\uFF0C": ",",
  "\uFF0E": ".",
  "\u3000": " "
};
function normalizeLedgerText(value) {
  return value.replace(/[０-９：｜￥（），．　]/g, (char) => {
    var _a;
    return (_a = FULL_WIDTH_MAP[char]) != null ? _a : char;
  });
}
function parseMoneyToCents(value) {
  const normalized = normalizeLedgerText(value).trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  return Number.isSafeInteger(cents) ? cents : null;
}
function formatCents(cents) {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}\xA5${Math.floor(absolute / 100).toLocaleString("zh-CN")}.${String(absolute % 100).padStart(2, "0")}`;
}
function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
function frontmatterCalendarDate(value) {
  const trimmed = value.trim();
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'") ? trimmed.slice(1, -1).trim() : trimmed;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[Tt ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/.exec(unquoted);
  if (!match || !isValidIsoDate(match[1])) return null;
  return match[1];
}
function filenameDate(path) {
  var _a;
  const name = (_a = path.split("/").pop()) != null ? _a : path;
  const match = /^(\d{4})(\d{2})(\d{2})日记账\.md$/.exec(name);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isValidIsoDate(date) ? date : null;
}
function parseFrontmatter(raw) {
  var _a;
  const lines = raw.split(/\r?\n/);
  if (((_a = lines[0]) == null ? void 0 : _a.trim()) !== "---") return { date: null, total: null, endLine: 0 };
  let date = null;
  let total = null;
  let endLine = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      endLine = index + 1;
      break;
    }
    const dateMatch = /^date:\s*(.*?)\s*$/.exec(lines[index]);
    const totalMatch = /^total:\s*(.*?)\s*$/.exec(lines[index]);
    if (dateMatch) date = dateMatch[1];
    if (totalMatch) total = totalMatch[1];
  }
  return { date, total, endLine };
}
function parseLedgerFile(path, raw) {
  var _a;
  const diagnostics = [];
  const records = [];
  const frontmatter = parseFrontmatter(raw);
  const fallbackDate = filenameDate(path);
  const normalizedFrontmatterDate = frontmatter.date ? frontmatterCalendarDate(frontmatter.date) : null;
  let date = null;
  if (normalizedFrontmatterDate) {
    date = normalizedFrontmatterDate;
    if (fallbackDate && fallbackDate !== date) {
      diagnostics.push({ kind: "date", path, reason: `frontmatter \u65E5\u671F ${date} \u4E0E\u6587\u4EF6\u540D\u65E5\u671F ${fallbackDate} \u4E0D\u4E00\u81F4` });
    }
  } else if (fallbackDate) {
    date = fallbackDate;
    diagnostics.push({
      kind: "date",
      path,
      reason: frontmatter.date ? `frontmatter \u65E5\u671F\u65E0\u6548\uFF0C\u5DF2\u4F7F\u7528\u6587\u4EF6\u540D\u65E5\u671F ${fallbackDate}` : `\u7F3A\u5C11 frontmatter date\uFF0C\u5DF2\u4F7F\u7528\u6587\u4EF6\u540D\u65E5\u671F ${fallbackDate}`
    });
  } else {
    diagnostics.push({ kind: "date", path, reason: "\u65E0\u6CD5\u4ECE frontmatter \u6216\u6587\u4EF6\u540D\u53D6\u5F97\u6709\u6548\u65E5\u671F" });
  }
  let frontmatterTotalCents = null;
  if (frontmatter.total !== null) {
    frontmatterTotalCents = parseMoneyToCents(frontmatter.total);
    if (frontmatterTotalCents === null) {
      diagnostics.push({ kind: "total", path, reason: `frontmatter total \u65E0\u6CD5\u89E3\u6790\uFF1A${frontmatter.total}` });
    }
  } else {
    diagnostics.push({ kind: "total", path, reason: "\u7F3A\u5C11 frontmatter total\uFF0C\u65E0\u6CD5\u6838\u5BF9\u6B63\u6587\u5408\u8BA1" });
  }
  const lines = raw.split(/\r?\n/);
  let inRecords = false;
  for (let index = Math.max(0, frontmatter.endLine); index < lines.length; index += 1) {
    const source = lines[index];
    if (/^#\s+今日消费记录\s*$/.test(source.trim())) {
      inRecords = true;
      continue;
    }
    if (inRecords && /^#{1,6}\s+/.test(source.trim())) break;
    if (!inRecords) continue;
    const bullet = /^\s*[-*+]\s*(.*)$/.exec(source);
    if (!bullet) continue;
    const body = bullet[1].trim();
    if (!body) continue;
    const normalized = normalizeLedgerText(body);
    const match = /^(补记|(?:[01]?\d|2[0-3]):[0-5]\d)\s*\|\s*([^|]+?)\s*\|\s*[¥Y]\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(.*))?$/.exec(normalized);
    if (!match || !date) {
      diagnostics.push({ kind: "parse", path, line: index + 1, reason: date ? "\u8BB0\u5F55\u683C\u5F0F\u65E0\u6CD5\u89E3\u6790" : "\u6587\u4EF6\u65E5\u671F\u65E0\u6548\uFF0C\u8BB0\u5F55\u65E0\u6CD5\u5F52\u5165\u7EDF\u8BA1", source });
      continue;
    }
    const cents = parseMoneyToCents(match[3]);
    if (cents === null) {
      diagnostics.push({ kind: "parse", path, line: index + 1, reason: "\u91D1\u989D\u65E0\u6CD5\u89E3\u6790", source });
      continue;
    }
    const note = ((_a = match[4]) != null ? _a : "").trim().replace(/^\((.*)\)$/, "$1").trim();
    records.push({
      id: `${path}:${index + 1}`,
      path,
      date,
      time: match[1],
      category: match[2].trim(),
      cents,
      note,
      line: index + 1,
      raw: source
    });
  }
  if (!inRecords) diagnostics.push({ kind: "parse", path, reason: "\u672A\u627E\u5230\u201C\u4ECA\u65E5\u6D88\u8D39\u8BB0\u5F55\u201D\u6807\u9898" });
  if (frontmatterTotalCents !== null) {
    const parsedTotal = records.reduce((sum, record) => sum + record.cents, 0);
    if (parsedTotal !== frontmatterTotalCents) {
      diagnostics.push({
        kind: "total",
        path,
        reason: `\u6B63\u6587\u5408\u8BA1 ${formatCents(parsedTotal)}\uFF0Cfrontmatter total ${formatCents(frontmatterTotalCents)}\uFF0C\u76F8\u5DEE ${formatCents(parsedTotal - frontmatterTotalCents)}`
      });
    }
  }
  return { path, date, frontmatterTotalCents, records, diagnostics };
}
function flattenRecords(files) {
  const records = [];
  for (const file of files) records.push(...file.records);
  return records.sort((a, b) => b.date.localeCompare(a.date) || b.line - a.line);
}
function recordMatches(record, filter) {
  if (record.date < filter.range.start || record.date > filter.range.end) return false;
  if (filter.scope === "consumption" && filter.excludedCategories.includes(record.category)) return false;
  if (filter.categories.length > 0 && !filter.categories.includes(record.category)) return false;
  const keyword = filter.keyword.trim().toLocaleLowerCase("zh-CN");
  if (keyword && !`${record.date} ${record.time} ${record.category} ${record.note}`.toLocaleLowerCase("zh-CN").includes(keyword)) return false;
  return true;
}
function filteredRecords(files, filter) {
  return flattenRecords(files).filter((record) => recordMatches(record, filter));
}
function summarize(files, records, range) {
  const recordedDates = /* @__PURE__ */ new Set();
  for (const file of files) {
    if (file.date && file.date >= range.start && file.date <= range.end) recordedDates.add(file.date);
  }
  const cents = records.reduce((sum, record) => sum + record.cents, 0);
  const recordedDays = recordedDates.size;
  let maxRecord = null;
  for (const record of records) if (!maxRecord || record.cents > maxRecord.cents) maxRecord = record;
  return {
    cents,
    count: records.length,
    recordedDays,
    averagePerRecordedDayCents: recordedDays === 0 ? 0 : Math.round(cents / recordedDays),
    maxRecord
  };
}
function categorySummaries(records, sortBy = "amount") {
  var _a;
  const map = /* @__PURE__ */ new Map();
  const total = records.reduce((sum, record) => sum + record.cents, 0);
  for (const record of records) {
    const current = (_a = map.get(record.category)) != null ? _a : { cents: 0, count: 0 };
    current.cents += record.cents;
    current.count += 1;
    map.set(record.category, current);
  }
  return [...map.entries()].map(([category, value]) => ({
    category,
    cents: value.cents,
    count: value.count,
    share: total === 0 ? 0 : value.cents / total
  })).sort((a, b) => sortBy === "amount" ? b.cents - a.cents || b.count - a.count : b.count - a.count || b.cents - a.cents);
}
function dateFromIso(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
function isoFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(iso, days) {
  const date = dateFromIso(iso);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}
function monthRange(year, monthIndex) {
  return {
    start: isoFromDate(new Date(year, monthIndex, 1, 12)),
    end: isoFromDate(new Date(year, monthIndex + 1, 0, 12))
  };
}
function trendBucket(dateIso, granularity) {
  if (granularity === "day") return { key: dateIso, start: dateIso, end: dateIso, label: dateIso.slice(5) };
  if (granularity === "month") {
    const date2 = dateFromIso(dateIso);
    const range = monthRange(date2.getFullYear(), date2.getMonth());
    return { key: dateIso.slice(0, 7), start: range.start, end: range.end, label: dateIso.slice(0, 7) };
  }
  const date = dateFromIso(dateIso);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  const start = isoFromDate(date);
  return { key: start, start, end: addDays(start, 6), label: `${start.slice(5)}\u5468` };
}
function trendPoints(records, granularity) {
  var _a;
  const map = /* @__PURE__ */ new Map();
  for (const record of records) {
    const bucket = trendBucket(record.date, granularity);
    const point = (_a = map.get(bucket.key)) != null ? _a : { ...bucket, cents: 0, count: 0 };
    point.cents += record.cents;
    point.count += 1;
    map.set(bucket.key, point);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
function compareValue(currentCents, previousCents) {
  let ratio;
  if (previousCents === 0) ratio = currentCents === 0 ? "none" : "new";
  else ratio = (currentCents - previousCents) / previousCents;
  return { currentCents, previousCents, differenceCents: currentCents - previousCents, ratio };
}
function diagnosticsFor(files) {
  const diagnostics = [];
  for (const file of files) diagnostics.push(...file.diagnostics);
  return diagnostics.sort((a, b) => {
    var _a, _b;
    return a.path.localeCompare(b.path) || ((_a = a.line) != null ? _a : 0) - ((_b = b.line) != null ? _b : 0);
  });
}

// src/repository.ts
var LedgerRepository = class {
  constructor(app, folder, onChange) {
    this.app = app;
    this.folder = folder;
    this.onChange = onChange;
    this.cache = /* @__PURE__ */ new Map();
    this.refs = [];
    this.notifyTimer = null;
    this.generation = 0;
    this.ready = false;
  }
  get files() {
    return this.cache;
  }
  get loaded() {
    return this.ready;
  }
  async start() {
    this.bindEvents();
    await this.rescan();
  }
  async setFolder(folder) {
    this.folder = folder;
    await this.rescan();
  }
  async rescan() {
    const generation = ++this.generation;
    const next = /* @__PURE__ */ new Map();
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
  dispose() {
    for (const ref of this.refs) this.app.vault.offref(ref);
    this.refs = [];
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
  }
  bindEvents() {
    this.refs.push(this.app.vault.on("create", (file) => void this.handleCreateOrModify(file)));
    this.refs.push(this.app.vault.on("modify", (file) => void this.handleCreateOrModify(file)));
    this.refs.push(this.app.vault.on("delete", (file) => this.handleDelete(file)));
    this.refs.push(this.app.vault.on("rename", (file, oldPath) => void this.handleRename(file, oldPath)));
  }
  async handleCreateOrModify(file) {
    if (!(file instanceof import_obsidian.TFile) || !this.isLedgerFile(file)) return;
    const parsed = await this.read(file);
    if (parsed) {
      this.cache.set(file.path, parsed);
      this.scheduleNotify();
    }
  }
  handleDelete(file) {
    if (this.cache.delete(file.path)) this.scheduleNotify();
  }
  async handleRename(file, oldPath) {
    const removed = this.cache.delete(oldPath);
    if (file instanceof import_obsidian.TFile && this.isLedgerFile(file)) {
      const parsed = await this.read(file);
      if (parsed) this.cache.set(file.path, parsed);
      this.scheduleNotify();
    } else if (removed) {
      this.scheduleNotify();
    }
  }
  async read(file) {
    try {
      return parseLedgerFile(file.path, await this.app.vault.cachedRead(file));
    } catch (error) {
      return {
        path: file.path,
        date: null,
        frontmatterTotalCents: null,
        records: [],
        diagnostics: [{ kind: "parse", path: file.path, reason: `\u8BFB\u53D6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` }]
      };
    }
  }
  isLedgerFile(file) {
    const folder = this.folder.replace(/^\/+|\/+$/g, "");
    return file.extension.toLowerCase() === "md" && (folder === "" || file.path.startsWith(`${folder}/`));
  }
  scheduleNotify() {
    if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
    this.notifyTimer = window.setTimeout(() => {
      this.notifyTimer = null;
      this.onChange();
    }, 80);
  }
};

// src/settings.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_SETTINGS = {
  ledgerFolder: "\u8BB0\u8D26",
  defaultView: "overview",
  excludedCategories: ["\u503A\u52A1/\u8FD8\u6B3E"]
};
var VIEW_NAMES = {
  overview: "\u603B\u89C8",
  category: "\u5206\u7C7B",
  trend: "\u8D8B\u52BF",
  calendar: "\u65E5\u5386",
  details: "\u660E\u7EC6",
  compare: "\u5BF9\u6BD4"
};
var LedgerSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "\u8BB0\u8D26\u7EDF\u8BA1\u8BBE\u7F6E" });
    new import_obsidian2.Setting(this.containerEl).setName("\u8BB0\u8D26\u6587\u4EF6\u5939").setDesc("\u4ED3\u5E93\u6839\u76EE\u5F55\u4E0B\u7684\u76F8\u5BF9\u8DEF\u5F84\u3002\u63D2\u4EF6\u53EA\u8BFB\u53D6\u5176\u4E2D\u7684 Markdown \u6587\u4EF6\u3002").addText((text) => text.setPlaceholder("\u8BB0\u8D26").setValue(this.plugin.settings.ledgerFolder).onChange(async (value) => {
      this.plugin.settings.ledgerFolder = value.trim().replace(/^\/+|\/+$/g, "") || "\u8BB0\u8D26";
      await this.plugin.saveSettings(true);
    }));
    new import_obsidian2.Setting(this.containerEl).setName("\u9ED8\u8BA4\u89C6\u56FE").setDesc("\u9996\u6B21\u6253\u5F00\u7EDF\u8BA1\u9762\u677F\u65F6\u663E\u793A\u7684\u9875\u9762\u3002").addDropdown((dropdown) => {
      for (const [id, name] of Object.entries(VIEW_NAMES)) dropdown.addOption(id, name);
      dropdown.setValue(this.plugin.settings.defaultView).onChange(async (value) => {
        this.plugin.settings.defaultView = value;
        await this.plugin.saveSettings(false);
      });
    });
    new import_obsidian2.Setting(this.containerEl).setName("\u6D88\u8D39\u53E3\u5F84\u6392\u9664\u5206\u7C7B").setDesc("\u4EE5\u4E2D\u6587\u9017\u53F7\u6216\u82F1\u6587\u9017\u53F7\u5206\u9694\u3002\u2018\u5168\u90E8\u652F\u51FA\u2019\u53E3\u5F84\u4E0D\u4F1A\u6392\u9664\u8FD9\u4E9B\u5206\u7C7B\u3002").addTextArea((text) => text.setPlaceholder("\u503A\u52A1/\u8FD8\u6B3E").setValue(this.plugin.settings.excludedCategories.join("\uFF0C")).onChange(async (value) => {
      this.plugin.settings.excludedCategories = [...new Set(value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))];
      await this.plugin.saveSettings(false);
    }));
    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u63D2\u4EF6\u4E0D\u4F1A\u4FEE\u6539\u8D26\u76EE\u3002\u6B63\u6587\u9010\u7B14\u8BB0\u5F55\u662F\u7EDF\u8BA1\u6765\u6E90\uFF0Cfrontmatter total \u4EC5\u7528\u4E8E\u6838\u5BF9\u3002"
    });
  }
};

// src/view.ts
var import_obsidian3 = require("obsidian");

// src/ui.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var INK = "#1C1C1A";
var PAPER = "#F0EFEB";
var MUTED = "#8F8E88";
var FAINT = "#C6C5BF";
var GRID = "#DEDDD6";
var LADDER = ["#1C1C1A", "#4A4944", "#6A6963", "#8F8E88", "#B0AFA9", "#C6C5BF", "#D8D7D1"];
function svgEl(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}
function deterministic(index, salt) {
  return Math.abs((index * 73856093 ^ salt * 19349663) % 1e3) / 1e3;
}
function monoCard(parent, badge, title, subtitle) {
  const shell = parent.createDiv({ cls: "ledger-mono-card ledger-reveal" });
  shell.createDiv({ cls: "ledger-mono-badge", text: badge });
  shell.createEl("h3", { text: title });
  shell.createDiv({ cls: "ledger-mono-sub", text: subtitle });
  const chart = shell.createDiv({ cls: "ledger-mono-chart" });
  return { shell, chart };
}
function sourceLine(parent, text) {
  parent.createDiv({ cls: "ledger-mono-source", text });
}
function niceCurrencyUnit(maxCents, targetTicks = 32) {
  if (maxCents <= 0) return 100;
  const raw = maxCents / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, Math.round(step * magnitude));
}
function accessibleTarget(element, label, activate) {
  element.setAttribute("tabindex", "0");
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", label);
  element.classList.add("ledger-chart-target");
  element.addEventListener("click", activate);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") activate();
  });
}
function strongestCategory(data) {
  var _a, _b;
  return (_b = (_a = data[0]) == null ? void 0 : _a.category) != null ? _b : "\u6682\u65E0\u5206\u7C7B";
}
function pctText(cents, total) {
  return total === 0 ? "\u5360\u6BD4 0.0%" : `\u5360\u6BD4 ${(cents / total * 100).toFixed(1)}%`;
}
function renderMobileTickRows(parent, data, max, onClick) {
  const list = parent.createDiv({ cls: "ledger-mobile-tick-rows" });
  data.forEach((item, index) => {
    const row = list.createEl("button", { cls: "ledger-mobile-tick-row" });
    row.type = "button";
    row.setAttribute("aria-label", `${item.category} ${formatCents(item.cents)}\uFF0C${item.count} \u7B14`);
    const head = row.createDiv({ cls: "ledger-mobile-chart-head" });
    head.createEl("strong", { text: item.category });
    const values = head.createSpan();
    values.createEl("strong", { text: formatCents(item.cents) });
    values.createSpan({ text: ` \xB7 ${item.count}\u7B14` });
    const track = row.createDiv({ cls: "ledger-mobile-tick-track", attr: { "aria-hidden": "true" } });
    const tickCount = Math.max(item.cents > 0 ? 1 : 0, Math.round(item.cents / max * 28));
    for (let tick = 0; tick < tickCount; tick += 1) {
      const mark = track.createSpan({ cls: `ledger-mobile-tick${index === 0 ? " is-leading" : ""}` });
      mark.style.height = `${10 + deterministic(tick + 1, index + 2) * 13}px`;
      mark.style.animationDelay = `${index * 0.05 + tick * 0.012}s`;
    }
    row.addEventListener("click", () => onClick(item.category));
  });
}
function renderHorizontalBars(parent, data, onClick) {
  const total = data.reduce((sum, item) => sum + item.cents, 0);
  const leader = data[0];
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS \xB7 F5 TICK ROWS",
    leader ? `${leader.category}\u662F\u672C\u671F\u6700\u91CD\u7684\u4E00\u884C` : "\u672C\u671F\u8FD8\u6CA1\u6709\u5F62\u6210\u5206\u7C7B\u961F\u5217",
    leader ? `\u6BCF\u6839\u523B\u7EBF\u4EE3\u8868\u540C\u4E00\u91D1\u989D\u5355\u4F4D \xB7 \u884C\u5C3E\u4FDD\u7559\u7CBE\u786E\u91D1\u989D \xB7 ${pctText(leader.cents, total)}` : "\u5206\u7C7B\u91D1\u989D \xB7 \u5F53\u524D\u7B5B\u9009\u8303\u56F4"
  );
  if (data.length === 0) return renderEmpty(chart, "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u6CA1\u6709\u53EF\u7ED8\u5236\u7684\u6570\u636E");
  const width = 760;
  const rowHeight = 44;
  const height = data.length * rowHeight + 58;
  const x0 = 126;
  const plotWidth = 430;
  const max = Math.max(...data.map((item) => item.cents), 1);
  const unit = niceCurrencyUnit(max);
  const maxUnits = max / unit;
  const px = plotWidth / Math.max(maxUnits, 1);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "\u5206\u7C7B\u652F\u51FA\u523B\u7EBF\u961F\u5217\u56FE" });
  svg.classList.add("ledger-svg", "ledger-tick-rows", "ledger-desktop-chart");
  data.forEach((item, index) => {
    const y = 28 + index * rowHeight;
    const group = svgEl("g");
    accessibleTarget(group, `${item.category} ${formatCents(item.cents)}\uFF0C${item.count} \u7B14`, () => onClick(item.category));
    const label = svgEl("text", { x: x0 - 12, y: y + 3, "text-anchor": "end", class: "ledger-axis-label" });
    label.textContent = item.category;
    const baseline = svgEl("line", { x1: x0, y1: y + 9, x2: x0 + plotWidth, y2: y + 9, stroke: GRID, "stroke-width": 0.8 });
    group.append(label, baseline);
    const full = Math.floor(item.cents / unit);
    const remainder = item.cents % unit;
    for (let tick = 0; tick < full; tick += 1) {
      const x = x0 + (tick + 0.5) * px;
      group.append(svgEl("line", {
        x1: x,
        y1: y + 9,
        x2: x,
        y2: y - 2 - deterministic(tick + 1, index + 2) * 7,
        stroke: index === 0 ? INK : LADDER[Math.min(index, 4)],
        "stroke-width": 1,
        class: "ledger-fade",
        style: `animation-delay:${index * 0.08 + tick * 0.012}s`
      }));
      if (tick % 5 === 4) group.append(svgEl("circle", { cx: x, cy: y + 14, r: 1, fill: FAINT }));
    }
    if (remainder > 0) {
      const x = x0 + (full + 0.5) * px;
      group.append(svgEl("line", {
        x1: x,
        y1: y + 9,
        x2: x,
        y2: y + 9 - 13 * remainder / unit,
        stroke: LADDER[Math.min(index, 4)],
        "stroke-width": 1,
        "stroke-dasharray": "2 2",
        class: "ledger-fade",
        style: `animation-delay:${index * 0.08 + full * 0.012}s`
      }));
    }
    const value = svgEl("text", { x: x0 + Math.min(plotWidth, item.cents / max * plotWidth) + 12, y: y + 3, class: "ledger-value-label" });
    value.textContent = formatCents(item.cents);
    const count = svgEl("text", { x: 704, y: y + 3, "text-anchor": "end", class: "ledger-count-label" });
    count.textContent = `${item.count}\u7B14`;
    group.append(value, count);
    svg.append(group);
  });
  const unitText = svgEl("text", { x: width / 2, y: height - 12, "text-anchor": "middle", class: "ledger-foot-label" });
  unitText.textContent = `ONE TICK = ${formatCents(unit)} \xB7 DASHED FINAL TICK = REMAINDER`;
  svg.append(unitText);
  chart.append(svg);
  renderMobileTickRows(chart, data, max, onClick);
  sourceLine(shell, "TICK ROWS \xB7 MONO-BASIC \xB7 LOCAL LEDGER");
}
function polar(cx, cy, radius, angle) {
  const radians = angle * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}
function allocateHundred(data) {
  const exact = data.map((item) => item.share * 100);
  const allocated = exact.map(Math.floor);
  let remainder = 100 - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < order.length && remainder > 0; index += 1, remainder -= 1) allocated[order[index].index] += 1;
  return allocated;
}
function renderDonut(parent, data, onClick) {
  const total = data.reduce((sum, item) => sum + item.cents, 0);
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS \xB7 F4 TICK DONUT",
    data.length ? `${strongestCategory(data)}\u5360\u636E\u6700\u5927\u7684\u8868\u76D8\u533A\u6BB5` : "\u8868\u76D8\u7B49\u5F85\u7B2C\u4E00\u7B14\u652F\u51FA",
    "\u4E00\u6839\u523B\u7EBF = \u7EA6 1 \u4E2A\u767E\u5206\u70B9 \xB7 \u7CBE\u786E\u5360\u6BD4\u89C1\u56FE\u4F8B \xB7 \u987A\u65F6\u9488\u8BFB\u53D6"
  );
  if (data.length === 0 || total === 0) return renderEmpty(chart, "\u5408\u8BA1\u4E3A\u96F6\uFF0C\u65E0\u6CD5\u8BA1\u7B97\u5360\u6BD4");
  const wrap = chart.createDiv({ cls: "ledger-donut-wrap" });
  const svg = svgEl("svg", { viewBox: "0 0 340 320", role: "img", "aria-label": "\u5206\u7C7B\u652F\u51FA\u767E\u5206\u6BD4\u523B\u7EBF\u73AF" });
  svg.classList.add("ledger-svg", "ledger-tick-donut");
  const allocation = allocateHundred(data);
  let cursor = 0;
  data.forEach((item, categoryIndex) => {
    const group = svgEl("g");
    accessibleTarget(group, `${item.category} ${(item.share * 100).toFixed(1)}%\uFF0C${formatCents(item.cents)}`, () => onClick(item.category));
    for (let local = 0; local < allocation[categoryIndex]; local += 1) {
      const tick = cursor + local;
      const angle = tick * 3.6 - 90;
      const inner = polar(170, 145, 70, angle);
      const length = 11 + deterministic(tick + 1, categoryIndex + 2) * 7;
      const outer = polar(170, 145, 70 + length, angle);
      group.append(svgEl("line", {
        x1: inner.x,
        y1: inner.y,
        x2: outer.x,
        y2: outer.y,
        stroke: LADDER[Math.min(categoryIndex, LADDER.length - 1)],
        "stroke-width": 1,
        class: "ledger-fade",
        style: `animation-delay:${tick * 0.012}s`
      }));
      if (tick % 10 === 0) {
        const dot = polar(170, 145, 63, angle);
        group.append(svgEl("circle", { cx: dot.x, cy: dot.y, r: 1, fill: FAINT }));
      }
    }
    cursor += allocation[categoryIndex];
    svg.append(group);
  });
  const center = svgEl("text", { x: 170, y: 140, "text-anchor": "middle", class: "ledger-donut-total" });
  center.textContent = formatCents(total);
  const centerSub = svgEl("text", { x: 170, y: 160, "text-anchor": "middle", class: "ledger-foot-label" });
  centerSub.textContent = "100 TICKS \xB7 LOCAL TOTAL";
  svg.append(center, centerSub);
  wrap.append(svg);
  const legend = wrap.createDiv({ cls: "ledger-legend" });
  data.forEach((item, index) => {
    const button = legend.createEl("button", { cls: "ledger-legend-item" });
    const swatch = button.createSpan({ cls: "ledger-swatch" });
    swatch.style.backgroundColor = LADDER[Math.min(index, LADDER.length - 1)];
    button.createSpan({ text: `${item.category} \xB7 ${(item.share * 100).toFixed(1)}%` });
    button.addEventListener("click", () => onClick(item.category));
  });
  sourceLine(shell, "TICK DONUT \xB7 MONO-BASIC \xB7 LOCAL LEDGER");
}
function trendConclusion(points) {
  if (points.length === 0) return "\u8FD9\u6BB5\u65F6\u95F4\u8FD8\u6CA1\u6709\u5F62\u6210\u8D8B\u52BF";
  const peak = points.reduce((best, point) => point.cents > best.cents ? point : best, points[0]);
  return `${peak.label}\u662F\u8FD9\u6BB5\u65F6\u95F4\u7684\u652F\u51FA\u5CF0\u503C`;
}
function renderMobileTrend(parent, points, isLine, onClick) {
  const viewport = parent.createDiv({ cls: "ledger-mobile-trend-scroll" });
  const width = points.length > 10 ? points.length * 34 + 74 : 360;
  const height = 252;
  const left = 44;
  const right = width - 14;
  const top = 38;
  const base = 194;
  const plotWidth = right - left;
  const plotHeight = base - top;
  const max = Math.max(...points.map((point) => point.cents), 1);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": isLine ? "\u79FB\u52A8\u7AEF\u652F\u51FA\u6298\u7EBF\u56FE" : "\u79FB\u52A8\u7AEF\u652F\u51FA\u67F1\u72B6\u56FE" });
  svg.classList.add("ledger-svg", "ledger-mobile-trend");
  svg.style.width = `${width}px`;
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = base - tick / 3 * plotHeight;
    svg.append(svgEl("line", { x1: left, y1: y, x2: right, y2: y, stroke: GRID, "stroke-width": 0.8 }));
    const label = svgEl("text", { x: left - 7, y: y + 4, "text-anchor": "end", class: "ledger-mobile-axis-value" });
    label.textContent = formatCents(Math.round(max * tick / 3)).replace(".00", "");
    svg.append(label);
  }
  const slot = plotWidth / Math.max(points.length, 1);
  const coords = [];
  const peakIndex = points.reduce((best, point, index) => point.cents > points[best].cents ? index : best, 0);
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((point, index) => {
    const x = left + slot * index + slot / 2;
    const y = base - point.cents / max * plotHeight;
    coords.push({ x, y });
    if (!isLine) svg.append(svgEl("line", { x1: x, y1: base, x2: x, y2: y, stroke: index === peakIndex ? INK : MUTED, "stroke-width": index === peakIndex ? 2.4 : 1.4, class: "ledger-fade" }));
    const hitWidth = Math.max(slot, 24);
    const hit = svgEl("rect", { x: x - hitWidth / 2, y: top, width: hitWidth, height: plotHeight + 30, fill: "transparent" });
    accessibleTarget(hit, `${point.label} ${formatCents(point.cents)}\uFF0C${point.count} \u7B14`, () => onClick(point));
    svg.append(hit);
    if (isLine) svg.append(svgEl("circle", { cx: x, cy: y, r: index === peakIndex ? 4.5 : 3, fill: INK, class: "ledger-pop" }));
    if (index === peakIndex) {
      const value = svgEl("text", { x, y: Math.max(19, y - 11), "text-anchor": "middle", class: "ledger-mobile-value-label ledger-peak-label" });
      value.textContent = formatCents(point.cents);
      svg.append(value);
    }
    if (index % labelEvery === 0 && index <= points.length - 1 - labelEvery || index === points.length - 1) {
      const label = svgEl("text", { x, y: base + 23, "text-anchor": "middle", class: "ledger-mobile-axis-label" });
      label.textContent = point.label.length > 5 ? point.label.slice(-5) : point.label;
      svg.append(label);
    }
  });
  const outline = svgEl("path", { d: `M${coords.map((point) => `${point.x} ${point.y}`).join(" L ")}`, fill: "none", stroke: INK, "stroke-width": isLine ? 1.8 : 1.2, pathLength: 1, class: "ledger-draw" });
  if (isLine) svg.insertBefore(outline, svg.firstChild);
  else svg.append(outline);
  const foot = svgEl("text", { x: width / 2, y: height - 10, "text-anchor": "middle", class: "ledger-mobile-foot-label" });
  foot.textContent = points.length > 10 ? "\u5DE6\u53F3\u6ED1\u52A8\u67E5\u770B\u5B8C\u6574\u65F6\u95F4\u8303\u56F4" : "\u70B9\u51FB\u6570\u636E\u70B9\u67E5\u770B\u5BF9\u5E94\u660E\u7EC6";
  svg.append(foot);
  viewport.append(svg);
}
function renderTrendChart(parent, points, type, onClick) {
  const isLine = type === "line";
  const { shell, chart } = monoCard(
    parent,
    isLine ? "LUPI BASICS \xB7 F2 HAIRLINE LINE" : "LUPI BASICS \xB7 F3 HAIRLINE AREA",
    trendConclusion(points),
    isLine ? "\u4E00\u4E2A\u5706\u70B9 = \u4E00\u4E2A\u65F6\u95F4\u6876 \xB7 \u53D1\u4E1D\u6298\u7EBF\u4FDD\u6301\u9010\u65E5\u8BFB\u6570" : "\u4E00\u6839\u53D1\u4E1D = \u4E00\u4E2A\u65F6\u95F4\u6876 \xB7 \u4ECE\u5730\u677F\u751F\u957F\u5230\u5F53\u671F\u91D1\u989D"
  );
  if (points.length === 0) return renderEmpty(chart, "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u6CA1\u6709\u53EF\u7ED8\u5236\u7684\u6570\u636E");
  const width = 820;
  const height = 330;
  const left = 54;
  const top = 34;
  const base = 254;
  const plotWidth = width - left - 26;
  const plotHeight = base - top;
  const max = Math.max(...points.map((point) => point.cents), 1);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": isLine ? "\u652F\u51FA\u53D1\u4E1D\u6298\u7EBF\u56FE" : "\u652F\u51FA\u53D1\u4E1D\u67F1\u72B6\u56FE" });
  svg.classList.add("ledger-svg", "ledger-hairline-chart", "ledger-desktop-chart");
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = base - tick / 4 * plotHeight;
    svg.append(svgEl("line", { x1: left, y1: y, x2: left + plotWidth, y2: y, stroke: GRID, "stroke-width": 0.6 }));
    const label = svgEl("text", { x: left - 8, y: y + 3, "text-anchor": "end", class: "ledger-foot-label" });
    label.textContent = formatCents(Math.round(max * tick / 4)).replace(".00", "");
    svg.append(label);
  }
  const slot = plotWidth / Math.max(points.length, 1);
  const coords = [];
  const peaks = [...points.keys()].sort((a, b) => points[b].cents - points[a].cents).filter((index, position, chosen) => position === 0 || chosen.slice(0, position).every((other) => Math.abs(other - index) >= 3)).slice(0, 2);
  points.forEach((point, index) => {
    const x = left + slot * index + slot / 2;
    const y = base - point.cents / max * plotHeight;
    coords.push({ x, y });
    svg.append(svgEl("line", { x1: x, y1: base, x2: x, y2: base - 8, stroke: FAINT, "stroke-width": 0.7 }));
    if (!isLine) {
      svg.append(svgEl("line", {
        x1: x,
        y1: base,
        x2: x,
        y2: y,
        stroke: peaks.includes(index) ? INK : MUTED,
        "stroke-width": peaks.includes(index) ? 1.2 : 0.65,
        opacity: 0.55 + deterministic(index + 1, 7) * 0.4,
        class: "ledger-fade",
        style: `animation-delay:${index * 0.014}s`
      }));
    }
    const hit = svgEl("rect", { x: left + slot * index, y: top, width: slot, height: plotHeight, fill: "transparent" });
    accessibleTarget(hit, `${point.label} ${formatCents(point.cents)}\uFF0C${point.count} \u7B14`, () => onClick(point));
    svg.append(hit);
    if (isLine) svg.append(svgEl("circle", { cx: x, cy: y, r: peaks.includes(index) ? 4.2 : 2.2, fill: index % 7 >= 5 ? PAPER : INK, stroke: INK, "stroke-width": 1, class: "ledger-pop" }));
    if (peaks.includes(index)) {
      const value = svgEl("text", { x, y: y - 12, "text-anchor": "middle", class: "ledger-value-label ledger-peak-label" });
      value.textContent = formatCents(point.cents);
      svg.append(value);
    }
    const labelEvery = Math.max(1, Math.ceil(points.length / 8));
    if (index % labelEvery === 0 || index === points.length - 1) {
      const label = svgEl("text", { x, y: base + 24, "text-anchor": "middle", class: "ledger-axis-label" });
      label.textContent = point.label;
      svg.append(label);
    }
  });
  const outline = svgEl("path", { d: `M${coords.map((point) => `${point.x} ${point.y}`).join(" L ")}`, fill: "none", stroke: INK, "stroke-width": isLine ? 1.2 : 1, pathLength: 1, class: "ledger-draw" });
  if (isLine) svg.insertBefore(outline, svg.firstChild);
  else svg.append(outline);
  const foot = svgEl("text", { x: width / 2, y: height - 10, "text-anchor": "middle", class: "ledger-foot-label" });
  foot.textContent = isLine ? "ONE DOT = ONE PERIOD \xB7 HAIRLINE PATH \xB7 PEAKS LABELED" : "ONE HAIRLINE = ONE PERIOD, FLOOR TO PEAK";
  svg.append(foot);
  chart.append(svg);
  renderMobileTrend(chart, points, isLine, onClick);
  sourceLine(shell, `${isLine ? "HAIRLINE LINE" : "HAIRLINE AREA"} \xB7 MONO-BASIC \xB7 LOCAL LEDGER`);
}
function renderDumbbell(parent, data, currentLabel, previousLabel, onClick) {
  const changed = [...data].filter((item) => item.currentCents !== item.previousCents);
  const biggest = changed.sort((a, b) => Math.abs(b.currentCents - b.previousCents) - Math.abs(a.currentCents - a.previousCents))[0];
  const { shell, chart } = monoCard(
    parent,
    "LUPI BASICS \xB7 F12 DUMBBELL QUEUE",
    biggest ? `${biggest.category}\u8D21\u732E\u4E86\u6700\u5927\u7684\u671F\u95F4\u53D8\u5316` : "\u4E24\u4E2A\u671F\u95F4\u7684\u5206\u7C7B\u91D1\u989D\u6CA1\u6709\u53D8\u5316",
    `\u7A7A\u5FC3\u70B9 = ${previousLabel} \xB7 \u5B9E\u5FC3\u70B9 = ${currentLabel} \xB7 \u6240\u6709\u5206\u7C7B\u5171\u7528\u91D1\u989D\u8F74`
  );
  if (data.length === 0) return renderEmpty(chart, "\u4E24\u4E2A\u671F\u95F4\u90FD\u6CA1\u6709\u5339\u914D\u8BB0\u5F55");
  const width = 820;
  const rowHeight = 44;
  const height = data.length * rowHeight + 72;
  const left = 138;
  const right = 744;
  const max = Math.max(...data.flatMap((item) => [item.currentCents, item.previousCents]), 1);
  const unit = niceCurrencyUnit(max, 24);
  const scale = (value) => left + value / max * (right - left);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "\u5206\u7C7B\u652F\u51FA\u4E24\u671F\u54D1\u94C3\u5BF9\u6BD4\u56FE" });
  svg.classList.add("ledger-svg", "ledger-dumbbell-chart", "ledger-desktop-chart");
  data.forEach((item, index) => {
    const y = 34 + index * rowHeight;
    const previousX = scale(item.previousCents);
    const currentX = scale(item.currentCents);
    const group = svgEl("g");
    accessibleTarget(group, `${item.category}\uFF0C\u672C\u671F ${formatCents(item.currentCents)}\uFF0C\u57FA\u671F ${formatCents(item.previousCents)}`, () => onClick(item.category));
    const label = svgEl("text", { x: left - 12, y: y + 3, "text-anchor": "end", class: "ledger-axis-label" });
    label.textContent = item.category;
    group.append(label, svgEl("line", { x1: left, y1: y, x2: right, y2: y, stroke: GRID, "stroke-width": 0.7 }));
    const diff = Math.abs(item.currentCents - item.previousCents);
    const beadCount = Math.min(28, Math.floor(diff / unit));
    for (let bead = 0; bead < beadCount; bead += 1) {
      const t = (bead + 0.5) / Math.max(beadCount, 1);
      const x = previousX + (currentX - previousX) * t;
      group.append(svgEl("circle", { cx: x, cy: y + (deterministic(bead + 1, index + 3) - 0.5) * 5, r: 1.8, fill: MUTED, class: "ledger-pop", style: `animation-delay:${index * 0.06 + bead * 0.018}s` }));
    }
    group.append(
      svgEl("circle", { cx: previousX, cy: y, r: 4.8, fill: PAPER, stroke: INK, "stroke-width": 1.2, class: "ledger-pop" }),
      svgEl("circle", { cx: currentX, cy: y, r: 4.8, fill: INK, class: "ledger-pop" })
    );
    const value = svgEl("text", { x: Math.min(right, Math.max(previousX, currentX) + 10), y: y + 3, class: "ledger-value-label" });
    value.textContent = formatCents(item.currentCents - item.previousCents);
    group.append(value);
    svg.append(group);
  });
  const foot = svgEl("text", { x: width / 2, y: height - 12, "text-anchor": "middle", class: "ledger-foot-label" });
  foot.textContent = `ONE BEAD \u2248 ${formatCents(unit)} CHANGE \xB7 HOLLOW = BASE \xB7 INK = CURRENT`;
  svg.append(foot);
  chart.append(svg);
  const mobile = chart.createDiv({ cls: "ledger-mobile-dumbbells" });
  data.forEach((item) => {
    const row = mobile.createEl("button", { cls: "ledger-mobile-dumbbell" });
    row.type = "button";
    row.setAttribute("aria-label", `${item.category}\uFF0C\u672C\u671F ${formatCents(item.currentCents)}\uFF0C\u57FA\u671F ${formatCents(item.previousCents)}`);
    const head = row.createDiv({ cls: "ledger-mobile-chart-head" });
    head.createEl("strong", { text: item.category });
    const delta = item.currentCents - item.previousCents;
    head.createSpan({ cls: "ledger-mobile-delta", text: `${delta > 0 ? "+" : ""}${formatCents(delta)}` });
    const scales = row.createDiv({ cls: "ledger-mobile-dumbbell-scales", attr: { "aria-hidden": "true" } });
    for (const [label, value, kind] of [[previousLabel, item.previousCents, "is-base"], [currentLabel, item.currentCents, "is-current"]]) {
      const scaleRow = scales.createDiv({ cls: "ledger-mobile-scale-row" });
      scaleRow.createSpan({ text: label });
      const track = scaleRow.createDiv({ cls: "ledger-mobile-scale-track" });
      const line = track.createSpan({ cls: `ledger-mobile-scale-fill ${kind}` });
      line.style.width = `${Math.max(value > 0 ? 2 : 0, value / max * 100)}%`;
      const valueEl = scaleRow.createEl("strong", { text: formatCents(value) });
      valueEl.setAttribute("aria-hidden", "true");
    }
    row.addEventListener("click", () => onClick(item.category));
  });
  sourceLine(shell, "DUMBBELL QUEUE \xB7 MONO-BASIC \xB7 LOCAL LEDGER COMPARISON");
}
function renderEmpty(parent, message) {
  parent.createDiv({ cls: "ledger-empty", text: message });
}
function createButton(parent, text, active = false) {
  const button = parent.createEl("button", { cls: `ledger-button${active ? " is-active" : ""}`, text });
  button.type = "button";
  return button;
}

// src/view.ts
var LEDGER_VIEW_TYPE = "ledger-statistics-view";
var VIEW_NAMES2 = [
  ["overview", "\u603B\u89C8"],
  ["category", "\u5206\u7C7B"],
  ["trend", "\u8D8B\u52BF"],
  ["calendar", "\u65E5\u5386"],
  ["details", "\u660E\u7EC6"],
  ["compare", "\u5BF9\u6BD4"]
];
function todayIso() {
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function initialRange() {
  const now = /* @__PURE__ */ new Date();
  return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, end: todayIso() };
}
function daysInclusive(range) {
  const start = /* @__PURE__ */ new Date(`${range.start}T12:00:00`);
  const end = /* @__PURE__ */ new Date(`${range.end}T12:00:00`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 864e5) + 1);
}
function cloneFilter(filter) {
  return {
    range: { ...filter.range },
    scope: filter.scope,
    excludedCategories: [...filter.excludedCategories],
    categories: [...filter.categories],
    keyword: filter.keyword
  };
}
function rangeLabel(range) {
  return range.start === range.end ? range.start : `${range.start}\u2013${range.end}`;
}
function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}
function ratioLabel(value) {
  if (value === "new") return "\u65B0\u589E\uFF08\u57FA\u671F\u4E3A\u96F6\uFF09";
  if (value === "none") return "\u2014\uFF08\u4E24\u671F\u5747\u4E3A\u96F6\uFF09";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}
function addSelect(parent, label, value, options, onChange) {
  const wrapper = parent.createEl("label", { cls: "ledger-field" });
  wrapper.createSpan({ text: label });
  const select = wrapper.createEl("select");
  for (const [optionValue, optionLabel] of options) select.createEl("option", { value: optionValue, text: optionLabel });
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return wrapper;
}
function addDateInput(parent, label, value, onChange) {
  const wrapper = parent.createEl("label", { cls: "ledger-field" });
  wrapper.createSpan({ text: label });
  const input = wrapper.createEl("input", { type: "date", value });
  input.addEventListener("change", () => onChange(input.value));
  return wrapper;
}
var LedgerStatisticsView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.preset = "month";
    this.categoryChart = "bar";
    this.categorySort = "amount";
    this.trendChart = "line";
    this.trendUnit = "day";
    this.detailSort = "newest";
    this.compareMode = "auto";
    this.showDiagnostics = false;
    this.filtersExpanded = !import_obsidian3.Platform.isMobile;
    this.drillContext = null;
    this.autoAdvanceReady = true;
    this.autoAdvanceArmed = false;
    this.autoAdvanceArmSession = -1;
    this.autoAdvanceArmedByTouch = false;
    this.autoAdvanceArmedAt = 0;
    this.autoAdvanceBounceInProgress = false;
    this.touchSession = 0;
    this.lastTouchY = 0;
    this.activeView = plugin.settings.defaultView;
    const range = initialRange();
    this.filter = {
      range,
      scope: "consumption",
      excludedCategories: [...plugin.settings.excludedCategories],
      categories: [],
      keyword: ""
    };
    this.customCurrent = { ...range };
    const previousEnd = addDays(range.start, -1);
    this.customPrevious = { start: addDays(previousEnd, -daysInclusive(range) + 1), end: previousEnd };
  }
  getViewType() {
    return LEDGER_VIEW_TYPE;
  }
  getDisplayText() {
    return "\u8BB0\u8D26\u7EDF\u8BA1";
  }
  getIcon() {
    return "chart-pie";
  }
  async onOpen() {
    this.containerEl.addClass("ledger-statistics-view");
    this.registerDomEvent(this.contentEl, "scroll", () => this.handleAutoAdvanceScroll(), { passive: true });
    this.registerDomEvent(this.contentEl, "touchstart", (event) => this.handleAutoAdvanceTouchStart(event), { passive: true });
    this.registerDomEvent(this.contentEl, "touchmove", (event) => this.handleAutoAdvanceTouchMove(event), { passive: true });
    this.render();
  }
  requestRender() {
    this.filter.excludedCategories = [...this.plugin.settings.excludedCategories];
    this.render();
  }
  refreshSettings() {
    this.filter.excludedCategories = [...this.plugin.settings.excludedCategories];
    this.render();
  }
  render() {
    const root = this.contentEl;
    root.empty();
    if (!this.plugin.repository.loaded) {
      root.createDiv({ cls: "ledger-loading", text: "\u6B63\u5728\u8BFB\u53D6\u8BB0\u8D26\u6587\u4EF6\u2026" });
      return;
    }
    this.renderHeader(root);
    this.renderToolbar(root);
    this.renderTabs(root);
    this.renderDrillBack(root);
    const content = root.createDiv({ cls: "ledger-content" });
    const files = [...this.plugin.repository.files.values()];
    if (files.length === 0) {
      renderEmpty(content, `\u201C${this.plugin.settings.ledgerFolder}\u201D\u4E2D\u6CA1\u6709\u627E\u5230 Markdown \u8BB0\u8D26\u6587\u4EF6`);
    } else {
      if (this.activeView === "overview") this.renderOverview(content);
      if (this.activeView === "category") this.renderCategory(content);
      if (this.activeView === "trend") this.renderTrend(content);
      if (this.activeView === "calendar") this.renderCalendar(content);
      if (this.activeView === "details") this.renderDetails(content);
      if (this.activeView === "compare") this.renderCompare(content);
    }
    this.renderDiagnostics(root);
  }
  renderHeader(root) {
    const header = root.createDiv({ cls: "ledger-header" });
    const title = header.createDiv();
    title.createEl("h2", { text: "\u8BB0\u8D26\u7EDF\u8BA1" });
    title.createDiv({ cls: "ledger-subtitle", text: "\u672C\u5730\u53EA\u8BFB \xB7 \u6B63\u6587\u9010\u7B14\u8BB0\u5F55\u4E3A\u7EDF\u8BA1\u6765\u6E90" });
    const scope = header.createDiv({ cls: `ledger-scope-badge is-${this.filter.scope}` });
    scope.setText(this.filter.scope === "consumption" ? "\u5F53\u524D\u53E3\u5F84\uFF1A\u6D88\u8D39\u652F\u51FA" : "\u5F53\u524D\u53E3\u5F84\uFF1A\u5168\u90E8\u652F\u51FA");
  }
  renderToolbar(root) {
    var _a, _b;
    const panel = root.createEl("details", { cls: "ledger-filter-panel" });
    panel.open = this.filtersExpanded;
    const summary = panel.createEl("summary", { cls: "ledger-filter-summary" });
    const summaryIcon = summary.createSpan({ cls: "ledger-filter-summary-icon" });
    (0, import_obsidian3.setIcon)(summaryIcon, "sliders-horizontal");
    const summaryCopy = summary.createSpan({ cls: "ledger-filter-summary-copy" });
    summaryCopy.createEl("strong", { text: "\u7B5B\u9009\u6761\u4EF6" });
    const categoryLabel = (_a = this.filter.categories[0]) != null ? _a : "\u5168\u90E8\u5206\u7C7B";
    const scopeLabel = this.filter.scope === "consumption" ? "\u6D88\u8D39\u652F\u51FA" : "\u5168\u90E8\u652F\u51FA";
    summaryCopy.createSpan({ text: `${this.filter.range.start.slice(5).replace("-", ".")}\u2013${this.filter.range.end.slice(5).replace("-", ".")} \xB7 ${scopeLabel} \xB7 ${categoryLabel}` });
    const summaryChevron = summary.createSpan({ cls: "ledger-filter-summary-chevron" });
    (0, import_obsidian3.setIcon)(summaryChevron, "chevron-down");
    panel.addEventListener("toggle", () => {
      this.filtersExpanded = panel.open;
    });
    const toolbar = panel.createDiv({ cls: "ledger-toolbar" });
    addSelect(toolbar, "\u65F6\u95F4", this.preset, [["month", "\u672C\u6708"], ["previous", "\u4E0A\u6708"], ["year", "\u4ECA\u5E74"], ["custom", "\u81EA\u5B9A\u4E49"]], (value) => {
      this.applyPreset(value);
      this.render();
    });
    const dates = toolbar.createDiv({ cls: "ledger-date-range", attr: { "aria-label": "\u65E5\u671F\u8303\u56F4" } });
    addDateInput(dates, "\u5F00\u59CB", this.filter.range.start, (value) => {
      if (isValidIsoDate(value) && value <= this.filter.range.end) {
        this.clearDrillContext();
        this.preset = "custom";
        this.filter.range.start = value;
        this.render();
      }
    });
    addDateInput(dates, "\u7ED3\u675F", this.filter.range.end, (value) => {
      if (isValidIsoDate(value) && value >= this.filter.range.start) {
        this.clearDrillContext();
        this.preset = "custom";
        this.filter.range.end = value;
        this.render();
      }
    });
    addSelect(toolbar, "\u53E3\u5F84", this.filter.scope, [["consumption", "\u6D88\u8D39\u652F\u51FA"], ["all", "\u5168\u90E8\u652F\u51FA"]], (value) => {
      this.clearDrillContext();
      this.filter.scope = value;
      this.render();
    });
    const categories = this.allCategories();
    addSelect(toolbar, "\u5206\u7C7B", (_b = this.filter.categories[0]) != null ? _b : "", [["", "\u5168\u90E8\u5206\u7C7B"], ...categories.map((category) => [category, category])], (value) => {
      this.clearDrillContext();
      this.filter.categories = value ? [value] : [];
      this.render();
    });
    const refresh = createButton(toolbar, "\u5237\u65B0\u6570\u636E");
    refresh.addClass("ledger-refresh-button");
    (0, import_obsidian3.setIcon)(refresh.createSpan(), "refresh-cw");
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      await this.plugin.repository.rescan();
      new import_obsidian3.Notice("\u8BB0\u8D26\u7EDF\u8BA1\u5DF2\u5237\u65B0");
      refresh.disabled = false;
    });
  }
  renderTabs(root) {
    const nav = root.createDiv({ cls: "ledger-tabs", attr: { role: "tablist", "aria-label": "\u7EDF\u8BA1\u89C6\u56FE" } });
    for (const [id, name] of VIEW_NAMES2) {
      const button = createButton(nav, name, id === this.activeView);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(id === this.activeView));
      button.addEventListener("click", () => {
        this.activeView = id;
        this.autoAdvanceReady = true;
        this.resetAutoAdvanceArm();
        this.render();
      });
    }
  }
  renderDrillBack(root) {
    if (!this.drillContext) return;
    const banner = root.createDiv({ cls: "ledger-drill-back" });
    const copy = banner.createDiv({ cls: "ledger-drill-back-copy" });
    copy.createDiv({ cls: "ledger-drill-back-label", text: "\u6B63\u5728\u67E5\u770B\u4E0B\u94BB\u660E\u7EC6" });
    copy.createDiv({ cls: "ledger-drill-back-range", text: `\u539F\u7B5B\u9009\uFF1A${rangeLabel(this.drillContext.filter.range)}` });
    const back = createButton(banner, "\u8FD4\u56DE\u4E0A\u4E00\u7EA7");
    back.addClass("ledger-drill-back-button");
    (0, import_obsidian3.setIcon)(back.createSpan({ cls: "ledger-drill-back-icon" }), "arrow-left");
    back.addEventListener("click", () => this.restoreDrillContext());
  }
  renderOverview(parent) {
    const files = [...this.plugin.repository.files.values()];
    const records = filteredRecords(files, this.filter);
    const stats = summarize(files, records, this.filter.range);
    const metrics = parent.createDiv({ cls: "ledger-metrics" });
    this.metric(metrics, "\u6240\u9009\u671F\u95F4\u603B\u989D", formatCents(stats.cents), `${stats.count} \u7B14`, () => this.goDetails());
    this.metric(metrics, "\u7B14\u6570", String(stats.count), "\u70B9\u51FB\u67E5\u770B\u5168\u90E8\u660E\u7EC6", () => this.goDetails());
    this.metric(metrics, "\u65E5\u5747", formatCents(stats.averagePerRecordedDayCents), `\u5206\u6BCD\uFF1A${stats.recordedDays} \u4E2A\u6709\u65E5\u8BB0\u8D26\u6587\u4EF6\u7684\u65E5\u671F`, () => this.goDetails());
    this.metric(metrics, "\u6700\u5927\u5355\u7B14", stats.maxRecord ? formatCents(stats.maxRecord.cents) : "\u2014", stats.maxRecord ? `${stats.maxRecord.category} \xB7 ${stats.maxRecord.date}` : "\u6682\u65E0\u8BB0\u5F55", () => this.goDetails());
    if (records.length === 0) {
      renderEmpty(parent, "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u6CA1\u6709\u8BB0\u5F55\u3002\u7F3A\u5C11\u6587\u4EF6\u7684\u65E5\u671F\u4E0D\u4F1A\u6309\u96F6\u6D88\u8D39\u5904\u7406\u3002");
      return;
    }
    const grid = parent.createDiv({ cls: "ledger-overview-grid" });
    renderHorizontalBars(grid, categorySummaries(records).slice(0, 8), (category) => this.drillCategory(category));
    renderTrendChart(grid, trendPoints(records, this.rangeTrendUnit()), "line", (point) => this.drillRange({ start: point.start, end: point.end }));
  }
  renderCategory(parent) {
    const controls = parent.createDiv({ cls: "ledger-section-controls" });
    addSelect(controls, "\u663E\u793A", this.categoryChart, [["bar", "\u6A2A\u5411\u6761\u5F62\u56FE"], ["donut", "\u73AF\u5F62\u56FE"], ["table", "\u6C47\u603B\u8868"]], (value) => {
      this.categoryChart = value;
      this.render();
    });
    addSelect(controls, "\u6392\u5E8F", this.categorySort, [["amount", "\u6309\u91D1\u989D"], ["count", "\u6309\u7B14\u6570"]], (value) => {
      this.categorySort = value;
      this.render();
    });
    const records = filteredRecords(this.plugin.repository.files.values(), this.filter);
    const summaries = categorySummaries(records, this.categorySort);
    if (this.categoryChart === "bar") renderHorizontalBars(parent, summaries, (category) => this.drillCategory(category));
    if (this.categoryChart === "donut") renderDonut(parent, summaries, (category) => this.drillCategory(category));
    if (this.categoryChart === "table") this.renderCategoryTable(parent, summaries);
  }
  renderCategoryTable(parent, summaries) {
    if (summaries.length === 0) return renderEmpty(parent, "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u6CA1\u6709\u5206\u7C7B\u6570\u636E");
    const wrap = parent.createDiv({ cls: "ledger-table-wrap" });
    const table = wrap.createEl("table", { cls: "ledger-table" });
    const head = table.createTHead().insertRow();
    ["\u5206\u7C7B", "\u91D1\u989D", "\u5360\u6BD4", "\u7B14\u6570"].forEach((text) => head.createEl("th", { text }));
    const body = table.createTBody();
    for (const item of summaries) {
      const row = body.insertRow();
      row.addEventListener("click", () => this.drillCategory(item.category));
      row.createEl("td", { text: item.category });
      row.createEl("td", { text: formatCents(item.cents) });
      row.createEl("td", { text: pct(item.share) });
      row.createEl("td", { text: String(item.count) });
    }
  }
  renderTrend(parent) {
    const controls = parent.createDiv({ cls: "ledger-section-controls" });
    addSelect(controls, "\u56FE\u5F62", this.trendChart, [["line", "\u6298\u7EBF\u56FE"], ["bar", "\u67F1\u72B6\u56FE"]], (value) => {
      this.trendChart = value;
      this.render();
    });
    addSelect(controls, "\u6C47\u603B", this.trendUnit, [["day", "\u6309\u65E5"], ["week", "\u6309\u5468"], ["month", "\u6309\u6708"]], (value) => {
      this.trendUnit = value;
      this.render();
    });
    const records = filteredRecords(this.plugin.repository.files.values(), this.filter);
    renderTrendChart(parent, trendPoints(records, this.trendUnit), this.trendChart, (point) => this.drillRange({ start: point.start, end: point.end }));
    parent.createDiv({ cls: "ledger-note", text: this.filter.categories.length ? `\u5F53\u524D\u53EA\u663E\u793A\u5206\u7C7B\uFF1A${this.filter.categories[0]}` : "\u5F53\u524D\u663E\u793A\u5168\u90E8\u5206\u7C7B\uFF1B\u53EF\u5728\u9876\u90E8\u9009\u62E9\u6307\u5B9A\u5206\u7C7B\u3002" });
  }
  renderCalendar(parent) {
    var _a, _b;
    const endDate = /* @__PURE__ */ new Date(`${this.filter.range.end}T12:00:00`);
    const year = endDate.getFullYear();
    const month = endDate.getMonth();
    const range = monthRange(year, month);
    const header = parent.createDiv({ cls: "ledger-calendar-header" });
    const previous = createButton(header, "\u2039");
    previous.setAttribute("aria-label", "\u4E0A\u4E2A\u6708");
    header.createEl("h3", { text: `${year} \u5E74 ${month + 1} \u6708` });
    const next = createButton(header, "\u203A");
    next.setAttribute("aria-label", "\u4E0B\u4E2A\u6708");
    previous.addEventListener("click", () => this.setCalendarMonth(year, month - 1));
    next.addEventListener("click", () => this.setCalendarMonth(year, month + 1));
    const allFiles = [...this.plugin.repository.files.values()];
    const fileDates = new Set(allFiles.map((file) => file.date).filter((date) => date !== null));
    const monthFilter = { ...this.filter, range };
    const records = filteredRecords(allFiles, monthFilter);
    const amounts = /* @__PURE__ */ new Map();
    for (const record of records) amounts.set(record.date, ((_a = amounts.get(record.date)) != null ? _a : 0) + record.cents);
    const max = Math.max(...amounts.values(), 1);
    const calendar = parent.createDiv({ cls: "ledger-calendar", attr: { role: "grid" } });
    ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u65E5"].forEach((day) => calendar.createDiv({ cls: "ledger-calendar-weekday", text: day }));
    const first = new Date(year, month, 1, 12);
    const lead = (first.getDay() + 6) % 7;
    for (let index = 0; index < lead; index += 1) calendar.createDiv({ cls: "ledger-calendar-spacer" });
    const days = new Date(year, month + 1, 0, 12).getDate();
    for (let day = 1; day <= days; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const hasFile = fileDates.has(iso);
      const amount = (_b = amounts.get(iso)) != null ? _b : 0;
      const level = hasFile ? Math.min(6, Math.ceil(amount / max * 6)) : 0;
      const cell = calendar.createEl("button", { cls: `ledger-calendar-day ${hasFile ? `has-record is-level-${level}` : "is-missing"}` });
      cell.type = "button";
      cell.createSpan({ cls: "ledger-calendar-number", text: String(day) });
      cell.createSpan({ cls: "ledger-calendar-amount", text: hasFile ? formatCents(amount) : "\u65E0\u8BB0\u5F55" });
      cell.setAttribute("aria-label", `${iso}\uFF0C${hasFile ? amount === 0 ? "\u6709\u8BB0\u5F55\u6587\u4EF6\uFF0C\u91D1\u989D\u4E3A\u96F6" : formatCents(amount) : "\u6CA1\u6709\u8BB0\u5F55\u6587\u4EF6"}`);
      cell.addEventListener("click", () => this.drillRange({ start: iso, end: iso }));
    }
    parent.createDiv({ cls: "ledger-calendar-legend", text: "\u6D45\u8272\u5230\u6DF1\u8272\u8868\u793A\u5F53\u6708\u652F\u51FA\u7531\u4F4E\u5230\u9AD8\uFF1B\u659C\u7EB9\u4E3A\u6CA1\u6709\u65E5\u8BB0\u8D26\u6587\u4EF6\uFF0C\u201C\xA50.00\u201D\u4E3A\u6709\u6587\u4EF6\u4F46\u5F53\u524D\u53E3\u5F84\u91D1\u989D\u4E3A\u96F6\u3002" });
  }
  renderDetails(parent) {
    const controls = parent.createDiv({ cls: "ledger-section-controls ledger-detail-controls" });
    const searchLabel = controls.createEl("label", { cls: "ledger-field ledger-search" });
    searchLabel.createSpan({ text: "\u641C\u7D22" });
    const search = searchLabel.createEl("input", { type: "search", placeholder: "\u65E5\u671F\u3001\u5206\u7C7B\u6216\u5907\u6CE8", value: this.filter.keyword });
    let timer = null;
    search.addEventListener("input", () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        this.filter.keyword = search.value;
        this.render();
      }, 180);
    });
    addSelect(controls, "\u6392\u5E8F", this.detailSort, [["newest", "\u65E5\u671F\u6700\u65B0"], ["amount-desc", "\u91D1\u989D\u4ECE\u9AD8\u5230\u4F4E"], ["amount-asc", "\u91D1\u989D\u4ECE\u4F4E\u5230\u9AD8"]], (value) => {
      this.detailSort = value;
      this.render();
    });
    let records = filteredRecords(this.plugin.repository.files.values(), this.filter);
    records = this.sortDetails(records);
    parent.createDiv({ cls: "ledger-results-count", text: `\u5171 ${records.length} \u7B14` });
    if (records.length === 0) return renderEmpty(parent, this.filter.keyword || this.filter.categories.length ? "\u7B5B\u9009\u540E\u6CA1\u6709\u5339\u914D\u8BB0\u5F55" : "\u6240\u9009\u671F\u95F4\u6CA1\u6709\u53EF\u89E3\u6790\u8BB0\u5F55");
    const tableWrap = parent.createDiv({ cls: "ledger-table-wrap ledger-details-table" });
    const table = tableWrap.createEl("table", { cls: "ledger-table" });
    const head = table.createTHead().insertRow();
    ["\u65E5\u671F", "\u65F6\u95F4", "\u5206\u7C7B", "\u91D1\u989D", "\u5907\u6CE8", "\u6765\u6E90"].forEach((text) => head.createEl("th", { text }));
    const body = table.createTBody();
    for (const record of records) {
      const row = body.insertRow();
      row.createEl("td", { text: record.date });
      row.createEl("td", { text: record.time });
      row.createEl("td", { text: record.category });
      row.createEl("td", { text: formatCents(record.cents) });
      row.createEl("td", { text: record.note || "\u2014" });
      const source = row.createEl("td").createEl("button", { cls: "ledger-link-button", text: `\u7B2C ${record.line} \u884C` });
      source.addEventListener("click", () => void this.openRecord(record));
    }
    const cards = parent.createDiv({ cls: "ledger-detail-cards" });
    for (const record of records) {
      const card = cards.createDiv({ cls: "ledger-detail-card" });
      const top = card.createDiv({ cls: "ledger-detail-card-top" });
      top.createSpan({ text: `${record.date} \xB7 ${record.time}` });
      top.createEl("strong", { text: formatCents(record.cents) });
      card.createDiv({ cls: "ledger-detail-category", text: record.category });
      if (record.note) card.createDiv({ text: record.note });
      const footer = card.createDiv({ cls: "ledger-detail-card-footer" });
      const source = footer.createEl("button", { cls: "ledger-link-button ledger-source-button", text: `\u6253\u5F00\u6765\u6E90 \xB7 \u7B2C ${record.line} \u884C` });
      source.addEventListener("click", () => void this.openRecord(record));
    }
  }
  renderCompare(parent) {
    var _a, _b, _c, _d;
    const controls = parent.createDiv({ cls: "ledger-section-controls" });
    addSelect(controls, "\u6BD4\u8F83\u65B9\u5F0F", this.compareMode, [["auto", "\u6309\u6240\u9009\u671F\u95F4\u81EA\u52A8\u6BD4\u8F83"], ["custom", "\u4E24\u4E2A\u81EA\u5B9A\u4E49\u671F\u95F4"]], (value) => {
      this.compareMode = value;
      this.render();
    });
    let current;
    let previous;
    let description;
    if (this.compareMode === "custom") {
      const dates = controls.createDiv({ cls: "ledger-compare-dates" });
      addDateInput(dates, "\u672C\u671F\u5F00\u59CB", this.customCurrent.start, (value) => {
        if (isValidIsoDate(value)) {
          this.customCurrent.start = value;
          this.render();
        }
      });
      addDateInput(dates, "\u672C\u671F\u7ED3\u675F", this.customCurrent.end, (value) => {
        if (isValidIsoDate(value)) {
          this.customCurrent.end = value;
          this.render();
        }
      });
      addDateInput(dates, "\u57FA\u671F\u5F00\u59CB", this.customPrevious.start, (value) => {
        if (isValidIsoDate(value)) {
          this.customPrevious.start = value;
          this.render();
        }
      });
      addDateInput(dates, "\u57FA\u671F\u7ED3\u675F", this.customPrevious.end, (value) => {
        if (isValidIsoDate(value)) {
          this.customPrevious.end = value;
          this.render();
        }
      });
      current = this.customCurrent;
      previous = this.customPrevious;
      description = "\u81EA\u5B9A\u4E49\u671F\u95F4\u6BD4\u8F83";
    } else {
      ({ current, previous, description } = this.autoComparisonRanges());
    }
    if (current.start > current.end || previous.start > previous.end) return renderEmpty(parent, "\u6BD4\u8F83\u65E5\u671F\u8303\u56F4\u65E0\u6548\uFF1A\u5F00\u59CB\u65E5\u671F\u4E0D\u80FD\u665A\u4E8E\u7ED3\u675F\u65E5\u671F");
    parent.createDiv({ cls: "ledger-note", text: `${description}\uFF1A\u672C\u671F ${current.start} \u81F3 ${current.end}\uFF1B\u57FA\u671F ${previous.start} \u81F3 ${previous.end}` });
    const files = [...this.plugin.repository.files.values()];
    const currentRecords = filteredRecords(files, { ...this.filter, range: current, keyword: "" });
    const previousRecords = filteredRecords(files, { ...this.filter, range: previous, keyword: "" });
    const total = compareValue(currentRecords.reduce((sum, record) => sum + record.cents, 0), previousRecords.reduce((sum, record) => sum + record.cents, 0));
    const cards = parent.createDiv({ cls: "ledger-compare-summary" });
    this.metric(cards, "\u672C\u671F", formatCents(total.currentCents), `${currentRecords.length} \u7B14`);
    this.metric(cards, "\u57FA\u671F", formatCents(total.previousCents), `${previousRecords.length} \u7B14`);
    this.metric(cards, "\u91D1\u989D\u5DEE\u989D", formatCents(total.differenceCents), "\u672C\u671F\u51CF\u57FA\u671F");
    this.metric(cards, "\u53D8\u5316\u6BD4\u4F8B", ratioLabel(total.ratio), total.ratio === "new" ? "\u57FA\u671F\u4E3A\u96F6\uFF0C\u4E0D\u8BA1\u7B97\u767E\u5206\u6BD4" : "\u4EE5\u57FA\u671F\u4E3A\u5206\u6BCD");
    const currentMap = new Map(categorySummaries(currentRecords).map((item) => [item.category, item]));
    const previousMap = new Map(categorySummaries(previousRecords).map((item) => [item.category, item]));
    const categories = [.../* @__PURE__ */ new Set([...currentMap.keys(), ...previousMap.keys()])].sort((a, b) => {
      var _a2, _b2, _c2, _d2;
      return ((_b2 = (_a2 = currentMap.get(b)) == null ? void 0 : _a2.cents) != null ? _b2 : 0) - ((_d2 = (_c2 = currentMap.get(a)) == null ? void 0 : _c2.cents) != null ? _d2 : 0);
    });
    if (categories.length === 0) return renderEmpty(parent, "\u4E24\u4E2A\u671F\u95F4\u90FD\u6CA1\u6709\u5339\u914D\u8BB0\u5F55");
    renderDumbbell(parent, categories.map((category) => {
      var _a2, _b2, _c2, _d2;
      return {
        category,
        currentCents: (_b2 = (_a2 = currentMap.get(category)) == null ? void 0 : _a2.cents) != null ? _b2 : 0,
        previousCents: (_d2 = (_c2 = previousMap.get(category)) == null ? void 0 : _c2.cents) != null ? _d2 : 0
      };
    }), "\u672C\u671F", "\u57FA\u671F", (category) => this.drillCategory(category));
    const wrap = parent.createDiv({ cls: "ledger-table-wrap" });
    const table = wrap.createEl("table", { cls: "ledger-table" });
    const head = table.createTHead().insertRow();
    ["\u5206\u7C7B", "\u672C\u671F", "\u57FA\u671F", "\u5DEE\u989D", "\u53D8\u5316"].forEach((text) => head.createEl("th", { text }));
    const body = table.createTBody();
    for (const category of categories) {
      const currentCents = (_b = (_a = currentMap.get(category)) == null ? void 0 : _a.cents) != null ? _b : 0;
      const previousCents = (_d = (_c = previousMap.get(category)) == null ? void 0 : _c.cents) != null ? _d : 0;
      const value = compareValue(currentCents, previousCents);
      const row = body.insertRow();
      row.addEventListener("click", () => this.drillCategory(category));
      row.createEl("td", { text: category });
      row.createEl("td", { text: formatCents(currentCents) });
      row.createEl("td", { text: formatCents(previousCents) });
      row.createEl("td", { text: formatCents(value.differenceCents) });
      row.createEl("td", { text: ratioLabel(value.ratio) });
    }
  }
  renderDiagnostics(root) {
    const diagnostics = diagnosticsFor(this.plugin.repository.files.values());
    const section = root.createDiv({ cls: "ledger-diagnostics" });
    const toggle = createButton(section, diagnostics.length ? `\u6570\u636E\u6838\u9A8C\uFF1A${diagnostics.length} \u9879\u9700\u6CE8\u610F` : "\u6570\u636E\u6838\u9A8C\uFF1A\u672A\u53D1\u73B0\u5F02\u5E38", this.showDiagnostics);
    toggle.addEventListener("click", () => {
      this.showDiagnostics = !this.showDiagnostics;
      this.render();
    });
    if (!this.showDiagnostics) return;
    const panel = section.createDiv({ cls: "ledger-diagnostics-panel" });
    if (diagnostics.length === 0) return renderEmpty(panel, "\u6240\u6709\u6B63\u6587\u5408\u8BA1\u5747\u4E0E\u53EF\u89E3\u6790\u7684 frontmatter total \u4E00\u81F4\uFF0C\u4E14\u672A\u53D1\u73B0\u89E3\u6790\u5F02\u5E38\u3002");
    for (const item of diagnostics) {
      const row = panel.createDiv({ cls: `ledger-diagnostic is-${item.kind}` });
      row.createDiv({ cls: "ledger-diagnostic-title", text: `${item.path}${item.line ? `:${item.line}` : ""}` });
      row.createDiv({ text: item.reason });
      if (item.source) row.createEl("code", { text: item.source });
      const button = row.createEl("button", { cls: "ledger-link-button", text: "\u6253\u5F00\u6765\u6E90" });
      button.addEventListener("click", () => void this.openPath(item.path, item.line));
    }
  }
  metric(parent, label, value, detail, onClick) {
    const card = parent.createEl(onClick ? "button" : "div", { cls: "ledger-metric" });
    card.createDiv({ cls: "ledger-metric-label", text: label });
    card.createDiv({ cls: "ledger-metric-value", text: value });
    card.createDiv({ cls: "ledger-metric-detail", text: detail });
    if (onClick) card.addEventListener("click", onClick);
  }
  applyPreset(preset) {
    this.clearDrillContext();
    this.preset = preset;
    const now = /* @__PURE__ */ new Date();
    if (preset === "month") this.filter.range = initialRange();
    if (preset === "previous") this.filter.range = monthRange(now.getFullYear(), now.getMonth() - 1);
    if (preset === "year") this.filter.range = { start: `${now.getFullYear()}-01-01`, end: todayIso() };
  }
  allCategories() {
    return [...new Set([...this.plugin.repository.files.values()].flatMap((file) => file.records.map((record) => record.category)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }
  goDetails() {
    this.activeView = "details";
    this.render();
  }
  drillCategory(category) {
    this.captureDrillContext();
    this.filter.categories = [category];
    this.activeView = "details";
    this.render();
  }
  drillRange(range) {
    this.captureDrillContext();
    this.filter.range = range;
    this.preset = "custom";
    this.activeView = "details";
    this.render();
  }
  rangeTrendUnit() {
    const days = daysInclusive(this.filter.range);
    return days <= 45 ? "day" : days <= 240 ? "week" : "month";
  }
  setCalendarMonth(year, month) {
    this.clearDrillContext();
    this.filter.range = monthRange(year, month);
    this.preset = "custom";
    this.render();
  }
  captureDrillContext() {
    if (this.drillContext) return;
    this.drillContext = {
      filter: cloneFilter(this.filter),
      preset: this.preset,
      view: this.activeView
    };
  }
  restoreDrillContext() {
    if (!this.drillContext) return;
    const context = this.drillContext;
    this.filter = cloneFilter(context.filter);
    this.preset = context.preset;
    this.activeView = context.view;
    this.drillContext = null;
    this.render();
  }
  clearDrillContext() {
    this.drillContext = null;
  }
  handleAutoAdvanceScroll() {
    if (!import_obsidian3.Platform.isMobile) return;
    if (!this.autoAdvanceReady) {
      if (import_obsidian3.Platform.isMobile && !this.autoAdvanceReady && this.contentEl.scrollTop < this.contentEl.scrollHeight - this.contentEl.clientHeight - 40) {
        this.autoAdvanceReady = true;
      }
      return;
    }
    const remaining = this.contentEl.scrollHeight - this.contentEl.clientHeight - this.contentEl.scrollTop;
    const index = VIEW_NAMES2.findIndex(([id]) => id === this.activeView);
    if (index < 0 || index >= VIEW_NAMES2.length - 1) return;
    if (remaining > 28) {
      if (this.autoAdvanceArmed && remaining > 40) this.resetAutoAdvanceArm();
      return;
    }
    if (!this.autoAdvanceArmed) {
      this.armAutoAdvance();
      return;
    }
    if (this.autoAdvanceBounceInProgress) return;
    if (this.autoAdvanceArmedByTouch && this.autoAdvanceArmSession === this.touchSession) return;
    if (!this.autoAdvanceArmedByTouch && Date.now() - this.autoAdvanceArmedAt < 300) return;
    this.advanceToNextView();
  }
  handleAutoAdvanceTouchStart(event) {
    var _a, _b;
    if (!import_obsidian3.Platform.isMobile) return;
    this.touchSession += 1;
    this.lastTouchY = (_b = (_a = event.touches[0]) == null ? void 0 : _a.clientY) != null ? _b : 0;
  }
  handleAutoAdvanceTouchMove(event) {
    var _a, _b;
    if (!import_obsidian3.Platform.isMobile || !this.autoAdvanceArmed || this.autoAdvanceBounceInProgress) return;
    const y = (_b = (_a = event.touches[0]) == null ? void 0 : _a.clientY) != null ? _b : this.lastTouchY;
    const movingUp = this.lastTouchY - y > 8;
    this.lastTouchY = y;
    if (!movingUp || this.autoAdvanceArmSession === this.touchSession) return;
    const remaining = this.contentEl.scrollHeight - this.contentEl.clientHeight - this.contentEl.scrollTop;
    if (remaining <= 28) this.advanceToNextView();
  }
  armAutoAdvance() {
    this.autoAdvanceArmed = true;
    this.autoAdvanceArmSession = this.touchSession;
    this.autoAdvanceArmedByTouch = this.touchSession > 0;
    this.autoAdvanceArmedAt = Date.now();
    this.autoAdvanceBounceInProgress = true;
    this.contentEl.removeClass("ledger-scroll-bounce");
    void this.contentEl.offsetWidth;
    this.contentEl.addClass("ledger-scroll-bounce");
    window.setTimeout(() => {
      this.contentEl.removeClass("ledger-scroll-bounce");
      this.autoAdvanceBounceInProgress = false;
    }, 280);
  }
  advanceToNextView() {
    const index = VIEW_NAMES2.findIndex(([id]) => id === this.activeView);
    if (index < 0 || index >= VIEW_NAMES2.length - 1) return;
    this.resetAutoAdvanceArm();
    this.autoAdvanceReady = false;
    this.activeView = VIEW_NAMES2[index + 1][0];
    this.render();
    this.contentEl.scrollTop = 0;
  }
  resetAutoAdvanceArm() {
    this.autoAdvanceArmed = false;
    this.autoAdvanceArmSession = -1;
    this.autoAdvanceArmedByTouch = false;
    this.autoAdvanceArmedAt = 0;
  }
  sortDetails(records) {
    const copy = [...records];
    if (this.detailSort === "amount-desc") return copy.sort((a, b) => b.cents - a.cents || b.date.localeCompare(a.date));
    if (this.detailSort === "amount-asc") return copy.sort((a, b) => a.cents - b.cents || b.date.localeCompare(a.date));
    return copy.sort((a, b) => b.date.localeCompare(a.date) || b.line - a.line);
  }
  autoComparisonRanges() {
    const current = { ...this.filter.range };
    const today = todayIso();
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    if (current.start === currentMonthStart && current.end === today) {
      const date = /* @__PURE__ */ new Date(`${current.start}T12:00:00`);
      const previousFull = monthRange(date.getFullYear(), date.getMonth() - 1);
      const sameDay = Math.min(Number(today.slice(8, 10)), Number(previousFull.end.slice(8, 10)));
      return {
        current,
        previous: { start: previousFull.start, end: `${previousFull.start.slice(0, 8)}${String(sameDay).padStart(2, "0")}` },
        description: "\u8FDB\u884C\u4E2D\u6708\u4EFD\u9ED8\u8BA4\u540C\u671F\u6BD4\u8F83"
      };
    }
    const previousEnd = addDays(current.start, -1);
    return {
      current,
      previous: { start: addDays(previousEnd, -daysInclusive(current) + 1), end: previousEnd },
      description: "\u6309\u76F8\u540C\u5929\u6570\u7684\u7D27\u90BB\u4E0A\u4E00\u671F\u95F4\u6BD4\u8F83"
    };
  }
  async openRecord(record) {
    await this.openPath(record.path, record.line);
  }
  async openPath(path, line) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian3.TFile)) {
      new import_obsidian3.Notice(`\u627E\u4E0D\u5230\u6765\u6E90\u6587\u4EF6\uFF1A${path}`);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
    if (line) {
      window.requestAnimationFrame(() => {
        const view = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
        if (view) {
          view.editor.setCursor({ line: Math.max(0, line - 1), ch: 0 });
          view.editor.scrollIntoView({ from: { line: Math.max(0, line - 2), ch: 0 }, to: { line, ch: 0 } }, true);
        }
      });
    }
  }
};

// src/main.ts
var LedgerStatisticsPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.repository = new LedgerRepository(this.app, this.settings.ledgerFolder, () => this.refreshViews());
    this.registerView(LEDGER_VIEW_TYPE, (leaf) => new LedgerStatisticsView(leaf, this));
    this.addRibbonIcon("chart-pie", "\u6253\u5F00\u8BB0\u8D26\u7EDF\u8BA1", () => void this.activateView());
    this.addCommand({ id: "open-ledger-statistics", name: "\u6253\u5F00\u8BB0\u8D26\u7EDF\u8BA1", callback: () => void this.activateView() });
    this.addSettingTab(new LedgerSettingTab(this.app, this));
    await this.repository.start();
  }
  onunload() {
    this.repository.dispose();
  }
  async saveSettings(rescan) {
    await this.saveData(this.settings);
    if (rescan) await this.repository.setFolder(this.settings.ledgerFolder);
    this.refreshViews();
  }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: LEDGER_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(LEDGER_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof LedgerStatisticsView) view.requestRender();
    }
  }
};
