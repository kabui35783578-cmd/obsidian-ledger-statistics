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
var import_obsidian6 = require("obsidian");

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
function barkPushUrl(baseUrl, title, body) {
  try {
    const parsed = new URL(baseUrl.trim());
    if (parsed.protocol !== "https:") return null;
    const key = parsed.pathname.split("/").filter(Boolean)[0];
    if (!key) return null;
    return `${parsed.origin}/${encodeURIComponent(key)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  } catch (e) {
    return null;
  }
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
function budgetScopedRecords(records, includeStarred, starredRecordIds) {
  const copy = [...records];
  if (includeStarred) return copy;
  const starred = new Set(starredRecordIds);
  return copy.filter((record) => !starred.has(record.id));
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
function budgetProgress(spentCents, budgetCents) {
  const spent = Math.max(0, spentCents);
  const budget = Math.max(0, budgetCents);
  if (budget === 0) return { ratio: 0, percent: 0, remainingCents: 0, overBudgetCents: 0 };
  const ratio = spent / budget;
  return {
    ratio,
    percent: Math.min(100, ratio * 100),
    remainingCents: Math.max(0, budget - spent),
    overBudgetCents: Math.max(0, spent - budget)
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
function weekRange(date = /* @__PURE__ */ new Date(), weekOffset = 0) {
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const daysSinceMonday = (current.getDay() + 6) % 7;
  const start = new Date(current);
  start.setDate(current.getDate() - daysSinceMonday - weekOffset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: isoFromDate(start),
    end: weekOffset === 0 ? isoFromDate(current) : isoFromDate(end)
  };
}
function salaryDayRange(date = /* @__PURE__ */ new Date(), cycleOffset = 0) {
  const today = isoFromDate(date);
  const currentStartMonth = date.getDate() <= 14 ? date.getMonth() - 1 : date.getMonth();
  const startMonth = currentStartMonth - cycleOffset;
  return {
    start: isoFromDate(new Date(date.getFullYear(), startMonth, 15, 12)),
    end: cycleOffset === 0 ? today : isoFromDate(new Date(date.getFullYear(), startMonth + 1, 14, 12))
  };
}
function salaryCycleFullRange(date = /* @__PURE__ */ new Date(), cycleOffset = 0) {
  const currentStartMonth = date.getDate() <= 14 ? date.getMonth() - 1 : date.getMonth();
  const startMonth = currentStartMonth - cycleOffset;
  return {
    start: isoFromDate(new Date(date.getFullYear(), startMonth, 15, 12)),
    end: isoFromDate(new Date(date.getFullYear(), startMonth + 1, 14, 12))
  };
}
function daysInclusive(range) {
  const start = dateFromIso(range.start).getTime();
  const end = dateFromIso(range.end).getTime();
  return Math.max(0, Math.round((end - start) / 864e5) + 1);
}
function recordsInRange(records, range) {
  return records.filter((record) => record.date >= range.start && record.date <= range.end);
}
function average(values) {
  return values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
function categoryTotals(records) {
  var _a;
  const totals = /* @__PURE__ */ new Map();
  for (const record of records) {
    const value = (_a = totals.get(record.category)) != null ? _a : { cents: 0, count: 0 };
    value.cents += record.cents;
    value.count += 1;
    totals.set(record.category, value);
  }
  return totals;
}
function buildFinanceAdvisorSnapshot(records, date, salaryCents, excludedCategories) {
  var _a, _b;
  const currentRange = salaryDayRange(date);
  const fullCurrentRange = salaryCycleFullRange(date);
  const previousRanges = [salaryCycleFullRange(date, 1), salaryCycleFullRange(date, 2)];
  const elapsedDays = daysInclusive(currentRange);
  const totalDays = daysInclusive(fullCurrentRange);
  const currentAll = recordsInRange(records, currentRange);
  const currentSpentCents = currentAll.reduce((sum, record) => sum + record.cents, 0);
  const remainingSalaryCents = salaryCents - currentSpentCents;
  const previousFull = previousRanges.map((range) => recordsInRange(records, range));
  const historicalAverageSpentCents = average(previousFull.map((items) => items.reduce((sum, record) => sum + record.cents, 0)));
  const forecastCents = elapsedDays === 0 ? currentSpentCents : Math.round(currentSpentCents / elapsedDays * totalDays);
  const excluded = new Set(excludedCategories);
  const consumption = (items) => items.filter((record) => !excluded.has(record.category));
  const currentConsumption = consumption(currentAll);
  const previousProgress = previousRanges.map((range) => consumption(recordsInRange(records, {
    start: range.start,
    end: addDays(range.start, Math.min(elapsedDays, daysInclusive(range)) - 1)
  })));
  const currentTotals = categoryTotals(currentConsumption);
  const previousProgressTotals = previousProgress.map(categoryTotals);
  const previousFullTotals = previousFull.map((items) => categoryTotals(consumption(items)));
  const categories = /* @__PURE__ */ new Set([
    ...currentTotals.keys(),
    ...previousProgressTotals.flatMap((totals) => [...totals.keys()]),
    ...previousFullTotals.flatMap((totals) => [...totals.keys()])
  ]);
  const currentConsumptionTotal = currentConsumption.reduce((sum, record) => sum + record.cents, 0);
  const baselineProgressTotal = average(previousProgress.map((items) => items.reduce((sum, record) => sum + record.cents, 0)));
  const snapshots = [...categories].map((category) => {
    var _a2;
    const current = (_a2 = currentTotals.get(category)) != null ? _a2 : { cents: 0, count: 0 };
    const baselineProgressCents = average(previousProgressTotals.map((totals) => {
      var _a3, _b2;
      return (_b2 = (_a3 = totals.get(category)) == null ? void 0 : _a3.cents) != null ? _b2 : 0;
    }));
    const baselineProgressCount = average(previousProgressTotals.map((totals) => {
      var _a3, _b2;
      return (_b2 = (_a3 = totals.get(category)) == null ? void 0 : _a3.count) != null ? _b2 : 0;
    }));
    const baselineCycleCents = average(previousFullTotals.map((totals) => {
      var _a3, _b2;
      return (_b2 = (_a3 = totals.get(category)) == null ? void 0 : _a3.cents) != null ? _b2 : 0;
    }));
    return {
      category,
      currentCents: current.cents,
      currentCount: current.count,
      baselineProgressCents,
      baselineProgressCount,
      baselineCycleCents,
      remainingReferenceCents: Math.max(0, baselineCycleCents - current.cents),
      currentShare: currentConsumptionTotal === 0 ? 0 : current.cents / currentConsumptionTotal,
      baselineShare: baselineProgressTotal === 0 ? 0 : baselineProgressCents / baselineProgressTotal
    };
  }).sort((a, b) => b.baselineCycleCents - a.baselineCycleCents || b.currentCents - a.currentCents);
  const events = [];
  if (salaryCents > 0 && forecastCents > salaryCents) {
    const excess = forecastCents - salaryCents;
    events.push({
      id: "salary-pressure",
      type: "salary-pressure",
      priority: 100 + Math.min(40, Math.round(excess / Math.max(1, salaryCents) * 100)),
      title: "\u672C\u5468\u671F\u652F\u51FA\u901F\u5EA6\u504F\u5FEB",
      detail: `\u6309\u5F53\u524D\u901F\u5EA6\uFF0C\u5468\u671F\u672B\u652F\u51FA\u53EF\u80FD\u6BD4\u5DE5\u8D44\u591A ${formatCents(excess)}\u3002`
    });
  } else if (salaryCents > 0) {
    events.push({
      id: "salary-pace",
      type: "salary-pace",
      priority: 30,
      title: "\u672C\u5468\u671F\u4ECD\u5728\u5DE5\u8D44\u8303\u56F4\u5185",
      detail: `\u6309\u5F53\u524D\u901F\u5EA6\uFF0C\u5468\u671F\u672B\u9884\u8BA1\u652F\u51FA ${formatCents(forecastCents)}\u3002`
    });
  }
  for (const item of snapshots) {
    const amountDifference = item.currentCents - item.baselineProgressCents;
    const amountThreshold = Math.max(5e3, Math.round(item.baselineProgressCents * 0.25));
    if (amountDifference >= amountThreshold && (item.currentCount >= 2 || amountDifference >= 1e4)) {
      events.push({
        id: `spending-spike:${item.category}`,
        type: "spending-spike",
        priority: 70 + Math.min(25, Math.round(amountDifference / 5e3)),
        category: item.category,
        title: `${item.category}\u652F\u51FA\u660E\u663E\u589E\u52A0`,
        detail: `\u6BD4\u524D\u4E24\u4E2A\u5468\u671F\u540C\u671F\u5E73\u5747\u591A ${formatCents(amountDifference)}\u3002`
      });
    }
    const countDifference = item.currentCount - item.baselineProgressCount;
    const countThreshold = Math.max(2, Math.ceil(item.baselineProgressCount * 0.35));
    if (countDifference >= countThreshold && amountDifference >= 5e3) {
      events.push({
        id: `frequency-spike:${item.category}`,
        type: "frequency-spike",
        priority: 66 + Math.min(20, countDifference * 3),
        category: item.category,
        title: `${item.category}\u6D88\u8D39\u66F4\u9891\u7E41`,
        detail: `\u5F53\u524D\u5DF2\u6709 ${item.currentCount} \u7B14\uFF0C\u6BD4\u540C\u671F\u5E73\u5747\u591A\u7EA6 ${countDifference} \u7B14\u3002`
      });
    }
    const currentTicket = item.currentCount === 0 ? 0 : Math.round(item.currentCents / item.currentCount);
    const baselineTicket = item.baselineProgressCount === 0 ? 0 : Math.round(item.baselineProgressCents / item.baselineProgressCount);
    if (item.currentCount >= 2 && item.baselineProgressCount >= 2 && currentTicket - baselineTicket >= 2e3 && currentTicket >= baselineTicket * 1.3) {
      events.push({
        id: `ticket-spike:${item.category}`,
        type: "ticket-spike",
        priority: 62 + Math.min(18, Math.round((currentTicket - baselineTicket) / 2e3)),
        category: item.category,
        title: `${item.category}\u5355\u6B21\u82B1\u8D39\u53D8\u9AD8`,
        detail: `\u5F53\u524D\u7B14\u5747 ${formatCents(currentTicket)}\uFF0C\u540C\u671F\u5E73\u5747\u7EA6 ${formatCents(baselineTicket)}\u3002`
      });
    }
    if (item.currentCents >= 5e3 && item.currentShare - item.baselineShare >= 0.12) {
      events.push({
        id: `mix-shift:${item.category}`,
        type: "mix-shift",
        priority: 58 + Math.min(18, Math.round((item.currentShare - item.baselineShare) * 100)),
        category: item.category,
        title: `\u652F\u51FA\u91CD\u5FC3\u8F6C\u5411${item.category}`,
        detail: `\u5F53\u524D\u5360\u6D88\u8D39\u652F\u51FA\u7684 ${Math.round(item.currentShare * 100)}%\uFF0C\u540C\u671F\u5E73\u5747\u7EA6 ${Math.round(item.baselineShare * 100)}%\u3002`
      });
    }
  }
  const historicalByCategory = /* @__PURE__ */ new Map();
  for (const items of previousFull) {
    for (const record of consumption(items)) {
      const amounts = (_a = historicalByCategory.get(record.category)) != null ? _a : [];
      amounts.push(record.cents);
      historicalByCategory.set(record.category, amounts);
    }
  }
  let largeExpenseIndex = 0;
  for (const record of currentConsumption) {
    const historicalMedian = median((_b = historicalByCategory.get(record.category)) != null ? _b : []);
    const threshold = Math.max(1e4, Math.round(salaryCents * 0.05), historicalMedian * 3);
    if (record.cents >= threshold) {
      events.push({
        id: `large-expense:${largeExpenseIndex}`,
        type: "large-expense",
        priority: 78 + Math.min(20, Math.round(record.cents / Math.max(1, threshold) * 5)),
        category: record.category,
        title: `\u51FA\u73B0\u4E00\u7B14\u8F83\u5927\u7684${record.category}\u652F\u51FA`,
        detail: `\u5355\u7B14 ${formatCents(record.cents)}\uFF0C\u660E\u663E\u9AD8\u4E8E\u8BE5\u5206\u7C7B\u8FC7\u5F80\u5355\u7B14\u6C34\u5E73\u3002`
      });
      largeExpenseIndex += 1;
    }
  }
  events.push({ id: "stable", type: "stable", priority: 10, title: "\u6682\u672A\u53D1\u73B0\u660E\u663E\u53D8\u5316", detail: "\u5F53\u524D\u6D88\u8D39\u7ED3\u6784\u4E0E\u524D\u4E24\u4E2A\u5DE5\u8D44\u5468\u671F\u540C\u671F\u63A5\u8FD1\u3002" });
  events.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id, "zh-CN"));
  return {
    currentRange,
    fullCurrentRange,
    previousRanges,
    elapsedDays,
    totalDays,
    salaryCents,
    currentSpentCents,
    remainingSalaryCents,
    historicalAverageSpentCents,
    forecastCents,
    categories: snapshots,
    events
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
  defaultDatePreset: "month",
  excludedCategories: ["\u503A\u52A1/\u8FD8\u6B3E"],
  salaryCents: 0,
  financeAiEnabled: false,
  financeAiEndpoint: "https://api.openai.com/v1/chat/completions",
  financeAiModel: "",
  financeAiApiKey: "",
  financeAdviceCache: null,
  dailyBudgetCents: 0,
  budgetCategory: "",
  includeStarredInBudget: true,
  starredRecordIds: [],
  barkUrl: "",
  lastBudgetNotificationDate: ""
};
var VIEW_NAMES = {
  overview: "\u603B\u89C8",
  category: "\u5206\u7C7B",
  trend: "\u8D8B\u52BF",
  calendar: "\u65E5\u5386",
  details: "\u660E\u7EC6",
  compare: "\u5BF9\u6BD4"
};
var OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
var MIMO_CHAT_ENDPOINT = "https://api.xiaomimimo.com/v1/chat/completions";
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
    new import_obsidian2.Setting(this.containerEl).setName("\u9ED8\u8BA4\u65F6\u95F4\u7B5B\u9009").setDesc("\u4E0B\u6B21\u91CD\u65B0\u6253\u5F00\u7EDF\u8BA1\u9762\u677F\u65F6\u4F7F\u7528\u7684\u65F6\u95F4\u8303\u56F4\u3002\u5F53\u524D\u5468\u4E0E\u5F53\u524D\u5DE5\u8D44\u5468\u671F\u5747\u622A\u6B62\u4ECA\u5929\u3002").addDropdown((dropdown) => dropdown.addOption("today", "\u4ECA\u5929").addOption("week", "\u672C\u5468").addOption("month", "\u672C\u6708").addOption("salary", "\u5DE5\u8D44\u65E5").addOption("year", "\u4ECA\u5E74").setValue(this.plugin.settings.defaultDatePreset).onChange(async (value) => {
      this.plugin.settings.defaultDatePreset = value;
      await this.plugin.saveSettings(false);
    }));
    new import_obsidian2.Setting(this.containerEl).setName("\u6D88\u8D39\u53E3\u5F84\u6392\u9664\u5206\u7C7B").setDesc("\u4EE5\u4E2D\u6587\u9017\u53F7\u6216\u82F1\u6587\u9017\u53F7\u5206\u9694\u3002\u2018\u5168\u90E8\u652F\u51FA\u2019\u53E3\u5F84\u4E0D\u4F1A\u6392\u9664\u8FD9\u4E9B\u5206\u7C7B\u3002").addTextArea((text) => text.setPlaceholder("\u503A\u52A1/\u8FD8\u6B3E").setValue(this.plugin.settings.excludedCategories.join("\uFF0C")).onChange(async (value) => {
      this.plugin.settings.excludedCategories = [...new Set(value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))];
      await this.plugin.saveSettings(false);
    }));
    new import_obsidian2.Setting(this.containerEl).setName("\u6BCF\u4E2A\u5DE5\u8D44\u5468\u671F\u5230\u8D26\u5DE5\u8D44").setDesc("\u7528\u4E8E\u8D22\u52A1\u89C2\u5BDF\u5361\u7247\u3002\u4F59\u989D\u4F1A\u7528\u8FD9\u7B14\u5DE5\u8D44\u51CF\u53BB\u672C\u5DE5\u8D44\u5468\u671F\u5185\u7684\u5168\u90E8\u652F\u51FA\uFF1B\u6570\u636E\u4EC5\u4FDD\u5B58\u5728\u672C\u5730\u3002").addText((text) => {
      text.setPlaceholder("\u4F8B\u5982 8000").setValue(this.moneyValue(this.plugin.settings.salaryCents)).onChange(async (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          this.plugin.settings.salaryCents = 0;
          this.plugin.settings.financeAdviceCache = null;
          await this.plugin.saveSettings(false);
          return;
        }
        const cents = parseMoneyToCents(trimmed);
        if (cents === null || cents < 0) return;
        this.plugin.settings.salaryCents = cents;
        this.plugin.settings.financeAdviceCache = null;
        await this.plugin.saveSettings(false);
      });
      text.inputEl.setAttribute("inputmode", "decimal");
      return text;
    });
    new import_obsidian2.Setting(this.containerEl).setName("\u542F\u7528 AI \u8D22\u52A1\u5224\u65AD").setDesc("\u53EA\u53D1\u9001\u7A0B\u5E8F\u751F\u6210\u7684\u6C47\u603B\u3001\u5019\u9009\u4E8B\u4EF6\u548C\u5206\u7C7B\u53C2\u8003\u503C\uFF0C\u4E0D\u53D1\u9001\u8D26\u672C\u6587\u4EF6\u3001\u8DEF\u5F84\u6216\u6D88\u8D39\u5907\u6CE8\u3002\u6BCF\u5929\u81EA\u52A8\u8BF7\u6C42\u6700\u591A\u4E00\u6B21\uFF0C\u4E5F\u53EF\u5728\u5361\u7247\u4E2D\u624B\u52A8\u5237\u65B0\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.financeAiEnabled).onChange(async (value) => {
      this.plugin.settings.financeAiEnabled = value;
      await this.plugin.saveSettings(false);
      this.display();
    }));
    if (this.plugin.settings.financeAiEnabled) {
      new import_obsidian2.Setting(this.containerEl).setName("AI \u63A5\u53E3\u5730\u5740").setDesc("\u517C\u5BB9 OpenAI Chat Completions \u7684\u5B8C\u6574\u63A5\u53E3\u5730\u5740\uFF1B\u975E\u672C\u673A\u5730\u5740\u5FC5\u987B\u4F7F\u7528 HTTPS\u3002").addText((text) => text.setPlaceholder("https://api.openai.com/v1/chat/completions").setValue(this.plugin.settings.financeAiEndpoint).onChange(async (value) => {
        this.plugin.settings.financeAiEndpoint = value.trim();
        this.plugin.settings.financeAdviceCache = null;
        await this.plugin.saveSettings(false);
      }));
      new import_obsidian2.Setting(this.containerEl).setName("AI \u6A21\u578B").setDesc("\u586B\u5199\u63A5\u53E3\u670D\u52A1\u5546\u63D0\u4F9B\u7684\u6A21\u578B\u540D\u79F0\u3002").addText((text) => text.setPlaceholder("\u4F8B\u5982\u670D\u52A1\u5546\u63D0\u4F9B\u7684\u6A21\u578B ID").setValue(this.plugin.settings.financeAiModel).onChange(async (value) => {
        this.plugin.settings.financeAiModel = value.trim();
        if (/^mimo-/i.test(this.plugin.settings.financeAiModel)) {
          try {
            if (new URL(this.plugin.settings.financeAiEndpoint).hostname === "api.openai.com") {
              this.plugin.settings.financeAiEndpoint = MIMO_CHAT_ENDPOINT;
            }
          } catch (e) {
            if (this.plugin.settings.financeAiEndpoint === OPENAI_CHAT_ENDPOINT) this.plugin.settings.financeAiEndpoint = MIMO_CHAT_ENDPOINT;
          }
        }
        this.plugin.settings.financeAdviceCache = null;
        await this.plugin.saveSettings(false);
      }));
      new import_obsidian2.Setting(this.containerEl).setName("AI API Key").setDesc("\u4EC5\u4FDD\u5B58\u5728\u672C\u5730 data.json\uFF0C\u4E0D\u4F1A\u4E0A\u4F20 GitHub\uFF1B\u672C\u673A\u514D\u5BC6\u63A5\u53E3\u53EF\u4EE5\u7559\u7A7A\u3002").addText((text) => {
        text.setPlaceholder("sk-\u2026").setValue(this.plugin.settings.financeAiApiKey).onChange(async (value) => {
          this.plugin.settings.financeAiApiKey = value.trim();
          await this.plugin.saveSettings(false);
        });
        text.inputEl.type = "password";
        text.inputEl.setAttribute("autocomplete", "off");
        return text;
      });
    }
    new import_obsidian2.Setting(this.containerEl).setName("\u6BCF\u65E5\u9884\u7B97").setDesc("\u603B\u89C8\u4E2D\u7684\u4ECA\u65E5\u9884\u7B97\u6309\u4E0B\u65B9\u9884\u7B97\u5206\u7C7B\u7EDF\u8BA1\u3002\u7559\u7A7A\u53EF\u5173\u95ED\uFF0C\u6700\u591A\u4FDD\u7559\u4E24\u4F4D\u5C0F\u6570\u3002").addText((text) => {
      text.setPlaceholder("\u4F8B\u5982 100").setValue(this.budgetValue()).onChange(async (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          this.plugin.settings.dailyBudgetCents = 0;
          await this.plugin.saveSettings(false);
          return;
        }
        const cents = parseMoneyToCents(trimmed);
        if (cents === null || cents < 0) return;
        this.plugin.settings.dailyBudgetCents = cents;
        await this.plugin.saveSettings(false);
      });
      text.inputEl.setAttribute("inputmode", "decimal");
      return text;
    });
    new import_obsidian2.Setting(this.containerEl).setName("\u9884\u7B97\u5206\u7C7B").setDesc("\u9ED8\u8BA4\u7EDF\u8BA1\u5168\u90E8\u5206\u7C7B\uFF1B\u9009\u62E9\u540E\uFF0C\u4ECA\u65E5\u9884\u7B97\u3001\u5F53\u524D\u652F\u51FA\u548C Bark \u63D0\u9192\u53EA\u7EDF\u8BA1\u8BE5\u5206\u7C7B\u3002").addDropdown((dropdown) => {
      dropdown.addOption("", "\u5168\u90E8\u5206\u7C7B");
      const categories = this.budgetCategories();
      for (const category of categories) dropdown.addOption(category, category);
      const current = this.plugin.settings.budgetCategory;
      if (current && !categories.includes(current)) dropdown.addOption(current, `${current}\uFF08\u5F53\u524D\u65E0\u8BB0\u5F55\uFF09`);
      dropdown.setValue(current).onChange(async (value) => {
        this.plugin.settings.budgetCategory = value;
        this.plugin.settings.lastBudgetNotificationDate = "";
        await this.plugin.saveSettings(false);
      });
    });
    new import_obsidian2.Setting(this.containerEl).setName("\u4ECA\u65E5\u9884\u7B97\u661F\u6807\u53E3\u5F84").setDesc("\u63A7\u5236\u4ECA\u65E5\u5DF2\u82B1\u3001\u5F53\u524D\u5DE5\u8D44\u5468\u671F\u652F\u51FA\u548C Bark \u63D0\u9192\u662F\u5426\u7EDF\u8BA1\u5DF2\u6807\u661F\u8BB0\u5F55\u3002").addDropdown((dropdown) => dropdown.addOption("include", "\u5305\u542B\u661F\u6807\u652F\u51FA").addOption("exclude", "\u4E0D\u5305\u542B\u661F\u6807\u652F\u51FA").setValue(this.plugin.settings.includeStarredInBudget ? "include" : "exclude").onChange(async (value) => {
      this.plugin.settings.includeStarredInBudget = value === "include";
      this.plugin.settings.lastBudgetNotificationDate = "";
      await this.plugin.saveSettings(false);
    }));
    new import_obsidian2.Setting(this.containerEl).setName("Bark \u63A8\u9001\u5730\u5740").setDesc("\u7C98\u8D34 Bark \u5730\u5740\uFF0C\u4F8B\u5982 https://api.day.app/\u4F60\u7684Key\uFF1B\u8FBE\u5230\u6216\u8D85\u8FC7\u4ECA\u65E5\u9884\u7B97\u65F6\u6BCF\u5929\u63D0\u9192\u4E00\u6B21\u3002\u5730\u5740\u53EA\u4FDD\u5B58\u5728\u672C\u5730\uFF0C\u4E0D\u4F1A\u4E0A\u4F20 GitHub\u3002").addText((text) => {
      text.setPlaceholder("https://api.day.app/\u4F60\u7684Key").setValue(this.plugin.settings.barkUrl).onChange(async (value) => {
        this.plugin.settings.barkUrl = value.trim();
        this.plugin.settings.lastBudgetNotificationDate = "";
        await this.plugin.saveSettings(false);
      });
      text.inputEl.type = "password";
      text.inputEl.setAttribute("autocomplete", "off");
      return text;
    });
    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u63D2\u4EF6\u4E0D\u4F1A\u4FEE\u6539\u8D26\u76EE\u3002\u6B63\u6587\u9010\u7B14\u8BB0\u5F55\u662F\u7EDF\u8BA1\u6765\u6E90\uFF0Cfrontmatter total \u4EC5\u7528\u4E8E\u6838\u5BF9\u3002"
    });
  }
  budgetValue() {
    return this.moneyValue(this.plugin.settings.dailyBudgetCents);
  }
  moneyValue(cents) {
    if (!Number.isFinite(cents) || cents <= 0) return "";
    return (cents / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }
  budgetCategories() {
    return [...new Set([...this.plugin.repository.files.values()].flatMap((file) => file.records.map((record) => record.category)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }
};

// src/view.ts
var import_obsidian5 = require("obsidian");

// src/ai.ts
var import_obsidian3 = require("obsidian");
var FINANCE_AI_PROFILE = `\u4F60\u662F\u4E00\u540D\u514B\u5236\u3001\u53EF\u9760\u7684\u4E2A\u4EBA\u8D22\u52A1\u89C2\u5BDF\u5458\u3002

\u4F60\u7684\u804C\u8D23\u4E0D\u662F\u91CD\u65B0\u8BA1\u7B97\u8D26\u76EE\uFF0C\u800C\u662F\u4ECE\u7A0B\u5E8F\u63D0\u4F9B\u7684\u201C\u8D22\u52A1\u4E8B\u4EF6\u5019\u9009\u6C60\u201D\u4E2D\uFF0C\u5224\u65AD\u5F53\u524D\u6700\u503C\u5F97\u7528\u6237\u77E5\u9053\u7684\u53D8\u5316\uFF0C\u5E76\u628A\u5B83\u8868\u8FBE\u6E05\u695A\u3002

\u7A0B\u5E8F\u5DF2\u7ECF\u8D1F\u8D23\uFF1A
- \u8BA1\u7B97\u5DE5\u8D44\u5468\u671F\u3001\u652F\u51FA\u3001\u4F59\u989D\u548C\u9884\u6D4B\u91D1\u989D
- \u5BF9\u6BD4\u524D\u4E24\u4E2A\u5B8C\u6574\u5DE5\u8D44\u5468\u671F
- \u626B\u63CF\u5168\u90E8\u6D88\u8D39\u5206\u7C7B
- \u8BC6\u522B\u91D1\u989D\u5F02\u5E38\u3001\u9891\u7387\u53D8\u5316\u3001\u7B14\u5747\u91D1\u989D\u53D8\u5316\u3001\u5927\u989D\u5355\u7B14\u548C\u6D88\u8D39\u7ED3\u6784\u53D8\u5316
- \u751F\u6210\u5206\u7C7B\u53C2\u8003\u4F59\u91CF

\u4F60\u5FC5\u987B\u9075\u5B88\uFF1A
1. \u53EA\u80FD\u4F7F\u7528\u8F93\u5165\u4E2D\u5DF2\u7ECF\u63D0\u4F9B\u7684\u4E8B\u5B9E\u3001\u91D1\u989D\u548C\u4E8B\u4EF6\u3002
2. \u4E0D\u5F97\u81EA\u884C\u8BA1\u7B97\u3001\u4FEE\u6539\u3001\u8865\u5168\u6216\u63A8\u6D4B\u4EFB\u4F55\u91D1\u989D\u3002
3. \u4E0D\u5F97\u865A\u6784\u5546\u5BB6\u3001\u6D88\u8D39\u539F\u56E0\u3001\u7528\u6237\u610F\u56FE\u3001\u6536\u5165\u6765\u6E90\u6216\u751F\u6D3B\u72B6\u51B5\u3002
4. \u4E0D\u8981\u56FA\u5B9A\u5173\u6CE8\u9910\u996E\u6216\u8D2D\u7269\uFF0C\u5E94\u5728\u5168\u90E8\u5019\u9009\u5206\u7C7B\u4E2D\u5224\u65AD\u3002
5. \u4F18\u5148\u9009\u62E9\u540C\u65F6\u5177\u5907\u4EE5\u4E0B\u7279\u5F81\u7684\u4E8B\u4EF6\uFF1A\u5BF9\u5DE5\u8D44\u4F59\u989D\u5F71\u54CD\u8F83\u5927\u3001\u4E0E\u524D\u4E24\u4E2A\u5468\u671F\u76F8\u6BD4\u53D8\u5316\u660E\u663E\u3001\u6837\u672C\u6570\u91CF\u8DB3\u591F\u3001\u5BF9\u7528\u6237\u63A5\u4E0B\u6765\u7684\u6D88\u8D39\u51B3\u7B56\u6709\u5E2E\u52A9\u3002
6. \u964D\u4F4E\u4EE5\u4E0B\u4E8B\u4EF6\u7684\u4F18\u5148\u7EA7\uFF1A\u53EA\u6709\u767E\u5206\u6BD4\u53D8\u5316\u4F46\u5B9E\u9645\u91D1\u989D\u5F88\u5C0F\u3001\u53EA\u591A\u4E00\u7B14\u6216\u6837\u672C\u8FC7\u5C11\u3001\u4E0E\u66F4\u91CD\u8981\u4E8B\u4EF6\u91CD\u590D\u8868\u8FBE\u3001\u5DE5\u8D44\u5468\u671F\u521A\u5F00\u59CB\u4E14\u6682\u65F6\u65E0\u6CD5\u5F62\u6210\u53EF\u9760\u5224\u65AD\u3002
7. \u5982\u679C\u6CA1\u6709\u660E\u663E\u4E14\u53EF\u9760\u7684\u53D8\u5316\uFF0C\u76F4\u63A5\u8BF4\u660E\u201C\u76EE\u524D\u6CA1\u6709\u503C\u5F97\u7279\u522B\u63D0\u9192\u7684\u53D8\u5316\u201D\uFF0C\u4E0D\u8981\u4E3A\u4E86\u663E\u5F97\u6709\u7528\u800C\u5236\u9020\u95EE\u9898\u3002
8. \u201C\u5206\u7C7B\u53C2\u8003\u4F59\u91CF\u201D\u53EA\u662F\u6839\u636E\u524D\u4E24\u4E2A\u5468\u671F\u5E73\u5747\u5F97\u51FA\u7684\u53C2\u8003\uFF0C\u4E0D\u662F\u9884\u7B97\uFF0C\u4E5F\u4E0D\u4EE3\u8868\u7528\u6237\u4E00\u5B9A\u53EF\u4EE5\u82B1\u5B8C\u3002\u4F7F\u7528\u201C\u6309\u8FC7\u5F80\u5468\u671F\u53C2\u8003\uFF0C\u8FD8\u53EF\u5B89\u6392\u2026\u2026\u201D\u4E00\u7C7B\u8868\u8FF0\uFF0C\u4E0D\u5F97\u4F7F\u7528\u4FDD\u8BC1\u6027\u63AA\u8F9E\u3002
9. \u4E0D\u63D0\u4F9B\u6295\u8D44\u3001\u501F\u8D37\u3001\u7A0E\u52A1\u6216\u9AD8\u98CE\u9669\u8D22\u52A1\u5EFA\u8BAE\u3002
10. \u4E0D\u63D0\u53CA AI\u3001\u6A21\u578B\u3001\u63D0\u793A\u8BCD\u6216\u5185\u90E8\u8BA1\u7B97\u8FC7\u7A0B\u3002

\u8F93\u51FA\u8981\u6C42\uFF1A
- \u53EA\u9009\u62E9\u4E00\u4E2A\u6700\u503C\u5F97\u5173\u6CE8\u7684\u4E3B\u4E8B\u4EF6\u3002
- \u5206\u7C7B\u5EFA\u8BAE\u6700\u591A\u9009\u62E9\u4E09\u4E2A\u771F\u6B63\u76F8\u5173\u7684\u5206\u7C7B\u3002
- \u6807\u9898\u4E0D\u8D85\u8FC7 16 \u4E2A\u4E2D\u6587\u5B57\u7B26\u3002
- \u603B\u7ED3\u6700\u591A\u4E24\u53E5\u8BDD\uFF0C\u907F\u514D\u7A7A\u8BDD\u548C\u8BF4\u6559\u3002
- \u8BED\u6C14\u76F4\u63A5\u3001\u514B\u5236\u3001\u5177\u4F53\uFF0C\u4E0D\u5236\u9020\u7126\u8651\u3002
- \u6240\u6709\u4E8B\u4EF6\u548C\u5206\u7C7B\u5FC5\u987B\u5F15\u7528\u8F93\u5165\u4E2D\u5B58\u5728\u7684 ID \u6216\u540D\u79F0\u3002

\u4E25\u683C\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u4F7F\u7528 Markdown \u4EE3\u7801\u5757\uFF1A
{
  "primary_event_id": "\u5019\u9009\u4E8B\u4EF6ID\uFF1B\u6CA1\u6709\u660E\u663E\u53D8\u5316\u65F6\u586B\u5199 stable",
  "headline": "\u7B80\u77ED\u6807\u9898",
  "summary": "\u5BF9\u53D8\u5316\u7684\u5177\u4F53\u8BF4\u660E\uFF0C\u4EE5\u53CA\u7528\u6237\u63A5\u4E0B\u6765\u6700\u503C\u5F97\u6CE8\u610F\u7684\u4E8B\u60C5",
  "category_lines": [
    {
      "category": "\u8F93\u5165\u4E2D\u5B58\u5728\u7684\u5206\u7C7B\u540D\u79F0",
      "text": "\u57FA\u4E8E\u8FC7\u5F80\u5468\u671F\u53C2\u8003\u7684\u7B80\u77ED\u8BF4\u660E"
    }
  ],
  "tone": "normal \u6216 warning"
}`;
var FINANCE_AI_TIMEOUT_MS = 6e4;
function compactText(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}
function jsonTextFromResponse(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const text = value.filter((item) => typeof item === "object" && item !== null).map((item) => typeof item.text === "string" ? item.text : "").join("");
  return text || null;
}
function parseFinanceAdvice(raw, snapshot) {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed;
  try {
    parsed = JSON.parse(unfenced);
  } catch (e) {
    throw new Error("AI \u8FD4\u56DE\u7684\u5185\u5BB9\u4E0D\u662F\u6709\u6548 JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("AI \u8FD4\u56DE\u683C\u5F0F\u4E0D\u6B63\u786E");
  const value = parsed;
  const primaryEventId = compactText(value.primary_event_id, 160);
  const headline = compactText(value.headline, 16);
  const summary = compactText(value.summary, 140);
  const tone = value.tone === "warning" ? "warning" : value.tone === "normal" ? "normal" : null;
  const allowedEvents = new Set(snapshot.events.map((event) => event.id));
  if (!primaryEventId || !allowedEvents.has(primaryEventId)) throw new Error("AI \u9009\u62E9\u4E86\u4E0D\u5B58\u5728\u7684\u5019\u9009\u4E8B\u4EF6");
  if (!headline || !summary || !tone) throw new Error("AI \u8FD4\u56DE\u7F3A\u5C11\u6807\u9898\u3001\u603B\u7ED3\u6216\u8BED\u6C14");
  const allowedCategories = new Set(snapshot.categories.map((item) => item.category));
  const categoryLines = [];
  if (Array.isArray(value.category_lines)) {
    for (const item of value.category_lines.slice(0, 3)) {
      if (typeof item !== "object" || item === null) continue;
      const row = item;
      const category = compactText(row.category, 80);
      const text = compactText(row.text, 100);
      if (category && text && allowedCategories.has(category) && !categoryLines.some((line) => line.category === category)) {
        categoryLines.push({ category, text });
      }
    }
  }
  return { primaryEventId, headline, summary, categoryLines, tone };
}
function financeSnapshotFingerprint(snapshot) {
  const source = JSON.stringify({
    date: snapshot.currentRange.end,
    salary: snapshot.salaryCents,
    spent: snapshot.currentSpentCents,
    remaining: snapshot.remainingSalaryCents,
    events: snapshot.events.map((event) => [event.id, event.priority, event.detail]),
    categories: snapshot.categories.map((item) => [item.category, item.currentCents, item.baselineCycleCents, item.remainingReferenceCents])
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function financeAiInput(snapshot) {
  return JSON.stringify({
    period: {
      start: snapshot.currentRange.start,
      end: snapshot.currentRange.end,
      elapsed_days: snapshot.elapsedDays,
      total_days: snapshot.totalDays
    },
    salary_summary: {
      salary: formatCents(snapshot.salaryCents),
      current_spent: formatCents(snapshot.currentSpentCents),
      remaining_salary: formatCents(snapshot.remainingSalaryCents),
      previous_two_cycles_average: formatCents(snapshot.historicalAverageSpentCents),
      current_pace_forecast: formatCents(snapshot.forecastCents)
    },
    candidate_events: snapshot.events.map((event) => {
      var _a;
      return {
        id: event.id,
        type: event.type,
        priority: event.priority,
        category: (_a = event.category) != null ? _a : null,
        title: event.title,
        detail: event.detail
      };
    }),
    category_references: snapshot.categories.map((item) => ({
      category: item.category,
      current_spent: formatCents(item.currentCents),
      previous_two_cycles_average: formatCents(item.baselineCycleCents),
      reference_remaining: formatCents(item.remainingReferenceCents)
    }))
  });
}
function validateEndpoint(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch (e) {
    throw new Error("AI \u63A5\u53E3\u5730\u5740\u65E0\u6548");
  }
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (url.protocol !== "https:" && !localHttp) throw new Error("AI \u63A5\u53E3\u5FC5\u987B\u4F7F\u7528 HTTPS\uFF0C\u672C\u673A\u63A5\u53E3\u53EF\u4F7F\u7528 HTTP");
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  if (trimmedPath === "/v1") url.pathname = `${trimmedPath}/chat/completions`;
  return url.toString();
}
async function requestFinanceAdvice(config, snapshot) {
  var _a, _b, _c;
  const endpoint = validateEndpoint(config.endpoint);
  const model = config.model.trim();
  if (!model) throw new Error("\u8BF7\u5148\u586B\u5199 AI \u6A21\u578B\u540D\u79F0");
  const endpointHost = new URL(endpoint).hostname;
  if (/^mimo-/i.test(model) && endpointHost === "api.openai.com") {
    throw new Error("MiMo \u6A21\u578B\u4E0D\u80FD\u4F7F\u7528 OpenAI \u5B98\u65B9\u63A5\u53E3\uFF0C\u8BF7\u6539\u4E3A MiMo \u670D\u52A1\u5730\u5740");
  }
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  const requestBody = {
    model,
    messages: [
      { role: "system", content: FINANCE_AI_PROFILE },
      { role: "user", content: financeAiInput(snapshot) }
    ],
    max_completion_tokens: 1200
  };
  if (/^mimo-/i.test(model) && endpointHost.endsWith("xiaomimimo.com")) {
    requestBody.thinking = { type: "disabled" };
  }
  let timeoutId = 0;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("AI \u8BF7\u6C42\u8D85\u8FC7 60 \u79D2\uFF0C\u5DF2\u505C\u6B62\u7B49\u5F85")), FINANCE_AI_TIMEOUT_MS);
  });
  let response;
  try {
    response = await Promise.race([(0, import_obsidian3.requestUrl)({
      url: endpoint,
      method: "POST",
      headers,
      contentType: "application/json",
      body: JSON.stringify(requestBody),
      throw: true
    }), timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
  const responseBody = response.json;
  const content = jsonTextFromResponse((_c = (_b = (_a = responseBody == null ? void 0 : responseBody.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content);
  if (!content) throw new Error("AI \u63A5\u53E3\u6CA1\u6709\u8FD4\u56DE\u53EF\u7528\u5185\u5BB9");
  return parseFinanceAdvice(content, snapshot);
}

// src/ui.ts
var import_obsidian4 = require("obsidian");
var SVG_NS = "http://www.w3.org/2000/svg";
var INK = "#1F1E1C";
var PAPER = "#F0F0EE";
var MUTED = "#8F8E86";
var FAINT = "#C0BFB7";
var GRID = "#DBDAD3";
var HERO = "#F5572F";
var LADDER = ["#22211F", "#4A4945", "#6E6D66", "#8F8E86", "#AAA9A2", "#C0BFB7", "#DBDAD3"];
var MONTH_ESTIMATE_DAYS = 31;
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
function trendTooltip(x, y, chartWidth, value, mobile = false) {
  const width = Math.max(mobile ? 72 : 64, value.length * (mobile ? 7.2 : 6.4) + 20);
  const centerX = Math.max(width / 2 + 4, Math.min(chartWidth - width / 2 - 4, x));
  const textY = Math.max(18, y - 14);
  const tooltip = svgEl("g", { class: "ledger-trend-tooltip", "aria-hidden": "true" });
  tooltip.append(
    svgEl("rect", {
      x: centerX - width / 2,
      y: textY - (mobile ? 16 : 14),
      width,
      height: mobile ? 22 : 20,
      rx: mobile ? 11 : 10,
      class: "ledger-trend-tooltip-bg"
    })
  );
  const label = svgEl("text", {
    x: centerX,
    y: textY,
    "text-anchor": "middle",
    class: mobile ? "ledger-trend-tooltip-text is-mobile" : "ledger-trend-tooltip-text"
  });
  label.textContent = value;
  tooltip.append(label);
  return tooltip;
}
function interactiveTrendTarget(svg, group, target, label, activate, previewOnFirstActivation = false) {
  target.setAttribute("tabindex", "0");
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", label);
  target.classList.add("ledger-chart-target", "ledger-trend-hit-target");
  target.addEventListener("click", (event) => {
    if (previewOnFirstActivation && !group.classList.contains("is-active")) {
      event.preventDefault();
      event.stopPropagation();
      svg.querySelectorAll(".ledger-trend-point.is-active").forEach((point) => point.classList.remove("is-active"));
      group.classList.add("is-active");
      return;
    }
    activate();
  });
  target.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
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
  const width = 820;
  const height = Math.max(330, data.length * 44 + 58);
  const rowHeight = (height - 58) / data.length;
  const x0 = 126;
  const plotWidth = 520;
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
        stroke: index === 0 ? HERO : LADDER[Math.min(index, 4)],
        "stroke-width": index === 0 ? 1.8 : 1,
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
    const count = svgEl("text", { x: 780, y: y + 3, "text-anchor": "end", class: "ledger-count-label" });
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
        stroke: categoryIndex === 0 ? HERO : LADDER[Math.min(categoryIndex, LADDER.length - 1)],
        "stroke-width": categoryIndex === 0 ? 1.8 : 1,
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
    if (isLine) {
      const group = svgEl("g", { class: "ledger-trend-point" });
      group.append(svgEl("circle", { cx: x, cy: y, r: index === peakIndex ? 4.8 : 3, fill: index === peakIndex ? HERO : INK, class: "ledger-pop ledger-trend-dot" }));
      if (index === peakIndex) {
        const peak = svgEl("text", { x, y: Math.max(19, y - 11), "text-anchor": "middle", class: "ledger-mobile-value-label ledger-peak-label ledger-persistent-peak" });
        peak.textContent = formatCents(point.cents);
        group.append(peak);
      }
      group.append(trendTooltip(x, y, width, formatCents(point.cents), true));
      const hit = svgEl("circle", { cx: x, cy: y, r: 22, fill: "transparent" });
      interactiveTrendTarget(svg, group, hit, `${point.label} ${formatCents(point.cents)}\uFF0C${point.count} \u7B14`, () => onClick(point), true);
      group.append(hit);
      svg.append(group);
    } else {
      const hitWidth = Math.max(slot, 24);
      const hit = svgEl("rect", { x: x - hitWidth / 2, y: top, width: hitWidth, height: plotHeight + 30, fill: "transparent" });
      accessibleTarget(hit, `${point.label} ${formatCents(point.cents)}\uFF0C${point.count} \u7B14`, () => onClick(point));
      svg.append(hit);
    }
    if (!isLine && index === peakIndex) {
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
  foot.textContent = isLine ? points.length > 10 ? "\u5DE6\u53F3\u6ED1\u52A8 \xB7 \u8F7B\u70B9\u9876\u70B9\u663E\u793A\u91D1\u989D" : "\u8F7B\u70B9\u9876\u70B9\u663E\u793A\u91D1\u989D \xB7 \u518D\u70B9\u4E00\u6B21\u67E5\u770B\u660E\u7EC6" : points.length > 10 ? "\u5DE6\u53F3\u6ED1\u52A8\u67E5\u770B\u5B8C\u6574\u65F6\u95F4\u8303\u56F4" : "\u70B9\u51FB\u6570\u636E\u70B9\u67E5\u770B\u5BF9\u5E94\u660E\u7EC6";
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
    if (isLine) {
      const group = svgEl("g", { class: "ledger-trend-point" });
      group.append(svgEl("circle", { cx: x, cy: y, r: peaks.includes(index) ? 4.2 : 2.2, fill: peaks.includes(index) ? HERO : index % 7 >= 5 ? PAPER : INK, stroke: peaks.includes(index) ? HERO : INK, "stroke-width": 1, class: "ledger-pop ledger-trend-dot" }));
      if (index === peaks[0]) {
        const peak = svgEl("text", { x, y: Math.max(18, y - 12), "text-anchor": "middle", class: "ledger-value-label ledger-peak-label ledger-persistent-peak" });
        peak.textContent = formatCents(point.cents);
        group.append(peak);
      }
      group.append(trendTooltip(x, y, width, formatCents(point.cents)));
      const hit = svgEl("circle", { cx: x, cy: y, r: 14, fill: "transparent" });
      interactiveTrendTarget(svg, group, hit, `${point.label} ${formatCents(point.cents)}\uFF0C${point.count} \u7B14`, () => onClick(point));
      group.append(hit);
      svg.append(group);
    } else {
      const hit = svgEl("rect", { x: left + slot * index, y: top, width: slot, height: plotHeight, fill: "transparent" });
      accessibleTarget(hit, `${point.label} ${formatCents(point.cents)}\uFF0C${point.count} \u7B14`, () => onClick(point));
      svg.append(hit);
    }
    if (!isLine && peaks.includes(index)) {
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
  foot.textContent = isLine ? "HOVER A DOT \xB7 REVEAL THE EXACT AMOUNT" : "ONE HAIRLINE = ONE PERIOD, FLOOR TO PEAK";
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
function renderFinanceAdvisor(parent, snapshot, state, onRefresh) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  const card = parent.createDiv({ cls: "ledger-advisor-card ledger-reveal" });
  const heading = card.createDiv({ cls: "ledger-advisor-heading" });
  const copy = heading.createDiv({ cls: "ledger-advisor-heading-copy" });
  copy.createDiv({ cls: "ledger-advisor-badge", text: "AI FINANCE BRIEF \xB7 SALARY CYCLE" });
  copy.createEl("h3", { text: "\u8D22\u52A1\u89C2\u5BDF" });
  copy.createDiv({ cls: "ledger-advisor-period", text: `${snapshot.currentRange.start.replace(/-/g, ".")} \u2014 ${snapshot.currentRange.end.replace(/-/g, ".")}` });
  if (state.canRefresh) {
    const refresh = heading.createEl("button", { cls: "ledger-advisor-refresh", attr: { type: "button", "aria-label": "\u91CD\u65B0\u751F\u6210\u8D22\u52A1\u5224\u65AD" } });
    (0, import_obsidian4.setIcon)(refresh, state.status === "loading" ? "loader-circle" : "refresh-cw");
    refresh.createSpan({ text: state.status === "loading" ? "\u5206\u6790\u4E2D" : "\u5237\u65B0\u5224\u65AD" });
    refresh.disabled = state.status === "loading";
    refresh.addEventListener("click", onRefresh);
  }
  if (snapshot.salaryCents <= 0) {
    card.addClass("is-empty");
    const empty = card.createDiv({ cls: "ledger-advisor-empty" });
    empty.createEl("strong", { text: state.canRefresh ? "AI \u5DF2\u914D\u7F6E\uFF0C\u8FD8\u5DEE\u5DE5\u8D44\u91D1\u989D" : "\u586B\u5199\u5DE5\u8D44\u540E\u542F\u7528\u8D22\u52A1\u89C2\u5BDF" });
    empty.createSpan({ text: "\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u201C\u6BCF\u4E2A\u5DE5\u8D44\u5468\u671F\u5230\u8D26\u5DE5\u8D44\u201D\u3002\u4F59\u989D\u3001\u5468\u671F\u9884\u6D4B\u548C AI \u5224\u65AD\u90FD\u4F9D\u8D56\u8FD9\u9879\u6570\u636E\u3002" });
    if (state.message) empty.createDiv({ cls: `ledger-advisor-ai-status is-${state.status}`, text: state.message });
    card.createDiv({ cls: "ledger-advisor-source", text: "SALARY CYCLE \xB7 TWO-CYCLE BASELINE \xB7 LOCAL LEDGER" });
    return;
  }
  const remaining = heading.createDiv({ cls: `ledger-advisor-remaining${snapshot.remainingSalaryCents < 0 ? " is-negative" : ""}` });
  remaining.createSpan({ text: snapshot.remainingSalaryCents < 0 ? "\u5DF2\u8D85\u51FA\u5DE5\u8D44" : "\u76EE\u524D\u8FD8\u5269" });
  remaining.createEl("strong", { text: formatCents(Math.abs(snapshot.remainingSalaryCents)) });
  const summary = card.createDiv({ cls: "ledger-advisor-summary" });
  const spent = summary.createDiv({ cls: "ledger-advisor-summary-item" });
  spent.createSpan({ text: "\u672C\u6B21\u81EA\u5DE5\u8D44\u65E5\u652F\u51FA" });
  spent.createEl("strong", { text: formatCents(snapshot.currentSpentCents) });
  const average2 = summary.createDiv({ cls: "ledger-advisor-summary-item" });
  average2.createSpan({ text: "\u524D\u4E24\u4E2A\u5B8C\u6574\u5468\u671F\u5E73\u5747" });
  average2.createEl("strong", { text: formatCents(snapshot.historicalAverageSpentCents) });
  const forecast = summary.createDiv({ cls: "ledger-advisor-summary-item" });
  forecast.createSpan({ text: "\u7167\u5F53\u524D\u901F\u5EA6\u5468\u671F\u672B\u7EA6" });
  forecast.createEl("strong", { text: formatCents(snapshot.forecastCents) });
  const event = snapshot.events[0];
  const observation = card.createDiv({ cls: `ledger-advisor-observation is-${event.type}${((_a = state.advice) == null ? void 0 : _a.tone) === "warning" ? " is-warning" : ""}` });
  observation.createDiv({ cls: "ledger-advisor-observation-label", text: state.advice ? "AI \u8D22\u52A1\u5224\u65AD" : "\u672C\u5730\u5019\u9009\u5224\u65AD" });
  observation.createEl("h4", { text: (_c = (_b = state.advice) == null ? void 0 : _b.headline) != null ? _c : event.title });
  observation.createEl("p", { text: (_e = (_d = state.advice) == null ? void 0 : _d.summary) != null ? _e : event.detail });
  if (state.message) observation.createDiv({ cls: `ledger-advisor-ai-status is-${state.status}`, text: state.message });
  const adviceCategories = new Map((_g = (_f = state.advice) == null ? void 0 : _f.categoryLines.map((line) => [line.category, line.text])) != null ? _g : []);
  const references = state.advice && adviceCategories.size > 0 ? snapshot.categories.filter((item) => adviceCategories.has(item.category)).slice(0, 3) : snapshot.categories.filter((item) => item.baselineCycleCents > 0 || item.currentCents > 0).sort((a, b) => b.remainingReferenceCents - a.remainingReferenceCents || b.baselineCycleCents - a.baselineCycleCents).slice(0, 3);
  if (references.length > 0) {
    const section = card.createDiv({ cls: "ledger-advisor-categories" });
    const sectionHeading = section.createDiv({ cls: "ledger-advisor-section-heading" });
    sectionHeading.createSpan({ text: "\u5206\u7C7B\u53C2\u8003\u4F59\u91CF" });
    sectionHeading.createEl("small", { text: `\u5DF2\u626B\u63CF ${snapshot.categories.length} \u4E2A\u5206\u7C7B` });
    const list = section.createDiv({ cls: "ledger-advisor-category-list" });
    for (const item of references) {
      const row = list.createDiv({ cls: "ledger-advisor-category" });
      row.createSpan({ text: item.category });
      const value = row.createDiv();
      value.createEl("strong", { text: formatCents(item.remainingReferenceCents) });
      value.createEl("small", { text: (_h = adviceCategories.get(item.category)) != null ? _h : `\u8FC7\u5F80\u5468\u671F\u5747\u503C ${formatCents(item.baselineCycleCents)}` });
    }
  }
  card.createDiv({ cls: "ledger-advisor-source", text: "CURRENT SALARY CYCLE \xB7 PREVIOUS 2 FULL CYCLES \xB7 ALL CATEGORIES SCANNED \xB7 LOCAL LEDGER" });
}
function renderLiquidBudget(parent, spentCents, budgetCents, dateLabel, currentCycleCents, budgetCategory, includeStarred) {
  const card = parent.createDiv({ cls: "ledger-budget-card ledger-reveal" });
  const heading = card.createDiv({ cls: "ledger-budget-heading" });
  const title = heading.createDiv();
  const starredScope = includeStarred ? "\u542B\u661F\u6807" : "\u4E0D\u542B\u661F\u6807";
  title.createDiv({ cls: "ledger-budget-badge", text: `TODAY \xB7 ${budgetCategory || "ALL SPENDING"} \xB7 ${starredScope}` });
  title.createEl("h3", { text: "\u4ECA\u65E5\u9884\u7B97" });
  title.createDiv({ cls: "ledger-budget-date", text: dateLabel });
  const progress = budgetProgress(spentCents, budgetCents);
  if (budgetCents > 0) {
    const status = heading.createDiv({ cls: `ledger-budget-status${progress.overBudgetCents > 0 ? " is-over" : ""}` });
    status.createEl("strong", { text: `${Math.round(progress.ratio * 100)}%` });
    status.createSpan({ text: progress.overBudgetCents > 0 ? "\u5DF2\u8D85\u652F" : "\u5DF2\u4F7F\u7528" });
  }
  const values = card.createDiv({ cls: "ledger-budget-values" });
  const spent = values.createDiv({ cls: "ledger-budget-spent" });
  spent.createSpan({ cls: "ledger-budget-label", text: "\u4ECA\u65E5\u5DF2\u82B1" });
  spent.createEl("strong", { text: formatCents(spentCents) });
  if (budgetCents > 0) {
    values.createSpan({ cls: "ledger-budget-divider", attr: { "aria-hidden": "true" } });
    const target = values.createDiv({ cls: "ledger-budget-target" });
    target.createSpan({ cls: "ledger-budget-label", text: "\u6BCF\u65E5\u9884\u7B97" });
    target.createEl("strong", { text: formatCents(budgetCents) });
    target.createDiv({ cls: "ledger-budget-monthly", text: `\u6309\u6BCF\u5929 ${formatCents(budgetCents)} \u4F30\u7B97\uFF0C\u6708\u652F\u51FA\u7EA6 ${formatCents(budgetCents * MONTH_ESTIMATE_DAYS)}` });
    target.createDiv({ cls: "ledger-budget-current", text: `\u5F53\u524D\u652F\u51FA ${formatCents(currentCycleCents)}` });
  }
  if (budgetCents <= 0) {
    card.createDiv({ cls: "ledger-budget-empty", text: "\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199\u6BCF\u65E5\u9884\u7B97" });
    return;
  }
  const track = card.createDiv({
    cls: "ledger-budget-track",
    attr: {
      role: "progressbar",
      "aria-label": `${budgetCategory || "\u5168\u90E8\u5206\u7C7B"}\u4ECA\u65E5\u9884\u7B97\uFF08${starredScope}\uFF09\uFF0C\u5DF2\u82B1 ${formatCents(spentCents)}\uFF0C\u9884\u7B97 ${formatCents(budgetCents)}`,
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(Math.round(progress.percent))
    }
  });
  const fill = track.createDiv({ cls: `ledger-budget-fill${progress.overBudgetCents > 0 ? " is-over" : ""}` });
  fill.style.setProperty("--budget-progress", `${progress.percent}%`);
  const detail = card.createDiv({ cls: `ledger-budget-detail${progress.overBudgetCents > 0 ? " is-over" : ""}` });
  if (progress.overBudgetCents > 0) {
    detail.createSpan({ text: `\u5DF2\u8D85\u652F ${formatCents(progress.overBudgetCents)}` });
    detail.createSpan({ cls: "ledger-budget-ratio", text: `${Math.round(progress.ratio * 100)}%` });
  } else {
    detail.createSpan({ text: `\u5269\u4F59 ${formatCents(progress.remainingCents)}` });
    detail.createSpan({ cls: "ledger-budget-ratio", text: `${Math.round(progress.ratio * 100)}%` });
  }
  card.createDiv({ cls: "ledger-budget-source", text: `TODAY \xB7 ${budgetCategory || "ALL CATEGORIES"} \xB7 ${includeStarred ? "WITH STARRED" : "EXCLUDING STARRED"} \xB7 LOCAL LEDGER` });
}
function renderStarredExpenses(parent, records, onClick) {
  const card = parent.createDiv({ cls: "ledger-starred-card ledger-reveal" });
  const heading = card.createDiv({ cls: "ledger-starred-heading" });
  const headingCopy = heading.createDiv({ cls: "ledger-starred-heading-copy" });
  headingCopy.createDiv({ cls: "ledger-mono-badge", text: "STARRED EXPENSES \xB7 MANUAL CURATION" });
  headingCopy.createEl("h3", { text: "\u5927\u989D\u652F\u51FA" });
  headingCopy.createDiv({ cls: "ledger-mono-sub", text: "\u4EC5\u6C47\u603B\u6240\u9009\u65F6\u95F4\u5185\u7684\u624B\u52A8\u661F\u6807\u8BB0\u5F55\uFF0C\u4E0D\u6309\u91D1\u989D\u81EA\u52A8\u5224\u65AD\u3002" });
  const totalCents = records.reduce((sum, record) => sum + record.cents, 0);
  const summary = heading.createDiv({ cls: "ledger-starred-summary" });
  summary.createEl("strong", { text: formatCents(totalCents) });
  summary.createSpan({ text: `${records.length} \u7B14\u661F\u6807` });
  if (records.length === 0) {
    card.createDiv({ cls: "ledger-starred-empty", text: "\u6682\u65E0\u661F\u6807\u652F\u51FA \xB7 \u5728\u660E\u7EC6\u4E2D\u53F3\u952E\u6216\u957F\u6309\u4E00\u7B14\u8BB0\u5F55\u5373\u53EF\u6807\u8BB0" });
  } else {
    const list = card.createDiv({ cls: "ledger-starred-list" });
    for (const record of records) {
      const item = list.createEl("button", {
        cls: "ledger-starred-item",
        attr: { type: "button", "aria-label": `${record.category} ${formatCents(record.cents)}\uFF0C${record.date}` }
      });
      const icon = item.createSpan({ cls: "ledger-starred-item-icon" });
      (0, import_obsidian4.setIcon)(icon, "star");
      const copy = item.createDiv({ cls: "ledger-starred-copy" });
      const top = copy.createDiv({ cls: "ledger-starred-item-top" });
      top.createEl("strong", { text: record.category });
      top.createSpan({ text: `${record.date} \xB7 ${record.time}` });
      copy.createDiv({ cls: "ledger-starred-note", text: record.note || "\u65E0\u5907\u6CE8" });
      item.createEl("strong", { cls: "ledger-starred-amount", text: formatCents(record.cents) });
      item.addEventListener("click", () => onClick(record));
    }
  }
  card.createDiv({ cls: "ledger-mono-source", text: "STARRED RECORDS \xB7 LOCAL LEDGER \xB7 MANUAL ONLY" });
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
var AUTO_ADVANCE_SWIPE_DISTANCE = 100;
function todayIso() {
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function daysInclusive2(range) {
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
var LedgerStatisticsView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.periodOffset = 0;
    this.categoryChart = "bar";
    this.categorySort = "amount";
    this.trendChart = "line";
    this.trendUnit = "day";
    this.detailSort = "newest";
    this.compareMode = "auto";
    this.showDiagnostics = false;
    this.budgetNotificationInFlight = false;
    this.financeAdviceLoading = false;
    this.financeAdviceError = "";
    this.financeAdviceAttemptedDate = "";
    this.filtersExpanded = !import_obsidian5.Platform.isMobile;
    this.drillContext = null;
    this.pullEligible = false;
    this.pullDistance = 0;
    this.touchStartY = 0;
    this.touchStartX = 0;
    this.pullPeakDistance = 0;
    this.pullHint = null;
    this.settleTimer = null;
    this.filterResizeObserver = null;
    this.activeView = plugin.settings.defaultView;
    this.preset = plugin.settings.defaultDatePreset;
    const range = this.rangeForPreset(this.preset, /* @__PURE__ */ new Date(), 0);
    this.filter = {
      range,
      scope: "consumption",
      excludedCategories: [...plugin.settings.excludedCategories],
      categories: [],
      keyword: ""
    };
    this.customCurrent = { ...range };
    const previousEnd = addDays(range.start, -1);
    this.customPrevious = { start: addDays(previousEnd, -daysInclusive2(range) + 1), end: previousEnd };
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
    this.registerDomEvent(this.contentEl, "touchstart", (event) => this.handleAutoAdvanceTouchStart(event), { passive: true });
    this.registerDomEvent(this.contentEl, "touchmove", (event) => this.handleAutoAdvanceTouchMove(event), { passive: false });
    this.registerDomEvent(this.contentEl, "touchend", () => this.finishPull(false));
    this.registerDomEvent(this.contentEl, "touchcancel", () => this.finishPull(true));
    this.render();
  }
  requestRender() {
    this.filter.excludedCategories = [...this.plugin.settings.excludedCategories];
    this.render();
  }
  async onClose() {
    var _a;
    (_a = this.filterResizeObserver) == null ? void 0 : _a.disconnect();
    this.filterResizeObserver = null;
    this.resetAutoAdvanceArm();
  }
  refreshSettings() {
    this.filter.excludedCategories = [...this.plugin.settings.excludedCategories];
    this.render();
  }
  render() {
    const root = this.contentEl;
    this.resetAutoAdvanceArm();
    this.pullHint = null;
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
    const next = VIEW_NAMES2[VIEW_NAMES2.findIndex(([id]) => id === this.activeView) + 1];
    if (import_obsidian5.Platform.isMobile && next) {
      this.pullHint = root.createDiv({ cls: "ledger-pull-hint" });
      this.pullHint.setText(`\u7EE7\u7EED\u4E0A\u62C9\uFF0C\u67E5\u770B${next[1]}`);
    }
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
    var _a, _b, _c;
    (_a = this.filterResizeObserver) == null ? void 0 : _a.disconnect();
    const panel = root.createDiv({ cls: `ledger-filter-panel${this.filtersExpanded ? " is-open" : ""}` });
    const summary = panel.createEl("button", {
      cls: "ledger-filter-summary",
      attr: { type: "button", "aria-expanded": String(this.filtersExpanded) }
    });
    const summaryIcon = summary.createSpan({ cls: "ledger-filter-summary-icon" });
    (0, import_obsidian5.setIcon)(summaryIcon, "sliders-horizontal");
    const summaryCopy = summary.createSpan({ cls: "ledger-filter-summary-copy" });
    summaryCopy.createEl("strong", { text: "\u7B5B\u9009\u6761\u4EF6" });
    const categoryLabel = (_b = this.filter.categories[0]) != null ? _b : "\u5168\u90E8\u5206\u7C7B";
    const scopeLabel = this.filter.scope === "consumption" ? "\u6D88\u8D39\u652F\u51FA" : "\u5168\u90E8\u652F\u51FA";
    const dateLabel = this.filter.range.start === this.filter.range.end ? this.filter.range.start.slice(5).replace("-", ".") : `${this.filter.range.start.slice(5).replace("-", ".")}\u2013${this.filter.range.end.slice(5).replace("-", ".")}`;
    summaryCopy.createSpan({ text: `${dateLabel} \xB7 ${scopeLabel} \xB7 ${categoryLabel}` });
    const summaryChevron = summary.createSpan({ cls: "ledger-filter-summary-chevron" });
    (0, import_obsidian5.setIcon)(summaryChevron, "chevron-down");
    const filterContent = panel.createDiv({ cls: "ledger-filter-content" });
    filterContent.toggleAttribute("inert", !this.filtersExpanded);
    const toolbar = filterContent.createDiv({ cls: "ledger-toolbar" });
    const timeControls = toolbar.createDiv({ cls: "ledger-time-controls" });
    addSelect(timeControls, "\u65F6\u95F4", this.preset, [["today", "\u4ECA\u5929"], ["week", "\u672C\u5468"], ["month", "\u672C\u6708"], ["previous", "\u4E0A\u6708"], ["salary", "\u5DE5\u8D44\u65E5"], ["year", "\u4ECA\u5E74"], ["custom", "\u81EA\u5B9A\u4E49"]], (value) => {
      this.applyPreset(value);
      this.render();
    });
    const periodName = this.preset === "today" ? "\u5929" : this.preset === "week" ? "\u5468" : this.preset === "year" ? "\u5E74" : this.preset === "salary" ? "\u5DE5\u8D44\u5468\u671F" : "\u6708";
    const previousPeriod = timeControls.createEl("button", {
      cls: "ledger-button ledger-period-button",
      attr: { type: "button", title: `\u5207\u6362\u5230\u4E0A\u4E00\u4E2A${periodName}`, "aria-label": `\u5207\u6362\u5230\u4E0A\u4E00\u4E2A${periodName}` }
    });
    const previousPeriodIcon = previousPeriod.createSpan({ cls: "ledger-period-icon" });
    (0, import_obsidian5.setIcon)(previousPeriodIcon, "chevron-left");
    previousPeriod.disabled = this.preset === "custom";
    previousPeriod.addEventListener("click", () => this.shiftPeriod(1));
    const nextPeriod = timeControls.createEl("button", {
      cls: "ledger-button ledger-period-button",
      attr: { type: "button", title: `\u8FD4\u56DE\u4E0B\u4E00\u4E2A${periodName}`, "aria-label": `\u8FD4\u56DE\u4E0B\u4E00\u4E2A${periodName}` }
    });
    const nextPeriodIcon = nextPeriod.createSpan({ cls: "ledger-period-icon" });
    (0, import_obsidian5.setIcon)(nextPeriodIcon, "chevron-right");
    nextPeriod.disabled = this.preset === "custom";
    nextPeriod.addEventListener("click", () => this.shiftPeriod(-1));
    const dates = toolbar.createDiv({ cls: "ledger-date-range", attr: { "aria-label": "\u65E5\u671F\u8303\u56F4" } });
    addDateInput(dates, "\u5F00\u59CB", this.filter.range.start, (value) => {
      if (isValidIsoDate(value) && value <= this.filter.range.end) {
        this.clearDrillContext();
        this.preset = "custom";
        this.periodOffset = 0;
        this.filter.range.start = value;
        this.render();
      }
    });
    addDateInput(dates, "\u7ED3\u675F", this.filter.range.end, (value) => {
      if (isValidIsoDate(value) && value >= this.filter.range.start) {
        this.clearDrillContext();
        this.preset = "custom";
        this.periodOffset = 0;
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
    addSelect(toolbar, "\u5206\u7C7B", (_c = this.filter.categories[0]) != null ? _c : "", [["", "\u5168\u90E8\u5206\u7C7B"], ...categories.map((category) => [category, category])], (value) => {
      this.clearDrillContext();
      this.filter.categories = value ? [value] : [];
      this.render();
    });
    const refresh = toolbar.createEl("button", { cls: "ledger-button ledger-refresh-button" });
    const refreshIcon = refresh.createSpan({ cls: "ledger-refresh-icon" });
    (0, import_obsidian5.setIcon)(refreshIcon, "refresh-cw");
    refresh.createSpan({ cls: "ledger-refresh-text", text: "\u5237\u65B0\u6570\u636E" });
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      refresh.addClass("is-refreshing");
      try {
        await this.plugin.repository.rescan();
        new import_obsidian5.Notice("\u8BB0\u8D26\u7EDF\u8BA1\u5DF2\u5237\u65B0");
      } finally {
        refresh.disabled = false;
        refresh.removeClass("is-refreshing");
      }
    });
    const syncFilterHeight = () => {
      filterContent.style.setProperty("--ledger-filter-height", `${toolbar.scrollHeight}px`);
    };
    syncFilterHeight();
    this.filterResizeObserver = new ResizeObserver(() => {
      if (this.filtersExpanded) syncFilterHeight();
    });
    this.filterResizeObserver.observe(toolbar);
    summary.addEventListener("click", () => {
      this.filtersExpanded = !this.filtersExpanded;
      panel.classList.toggle("is-open", this.filtersExpanded);
      if (this.filtersExpanded) syncFilterHeight();
      summary.setAttribute("aria-expanded", String(this.filtersExpanded));
      filterContent.toggleAttribute("inert", !this.filtersExpanded);
    });
  }
  renderTabs(root) {
    const nav = root.createDiv({ cls: "ledger-tabs", attr: { role: "tablist", "aria-label": "\u7EDF\u8BA1\u89C6\u56FE" } });
    for (const [id, name] of VIEW_NAMES2) {
      const button = createButton(nav, name, id === this.activeView);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(id === this.activeView));
      button.addEventListener("click", () => {
        if (this.activeView === id) return;
        this.activeView = id;
        this.resetAutoAdvanceArm();
        this.render();
        this.contentEl.scrollTop = 0;
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
    (0, import_obsidian5.setIcon)(back.createSpan({ cls: "ledger-drill-back-icon" }), "arrow-left");
    back.addEventListener("click", () => this.restoreDrillContext());
  }
  renderOverview(parent) {
    var _a;
    const files = [...this.plugin.repository.files.values()];
    const records = filteredRecords(files, this.filter);
    const stats = summarize(files, records, this.filter.range);
    const today = todayIso();
    const budgetCategory = this.plugin.settings.budgetCategory;
    const includeStarred = this.plugin.settings.includeStarredInBudget;
    const todayRecords = budgetScopedRecords(filteredRecords(files, {
      range: { start: today, end: today },
      scope: "all",
      excludedCategories: [],
      categories: budgetCategory ? [budgetCategory] : [],
      keyword: ""
    }), includeStarred, this.plugin.settings.starredRecordIds);
    const todayCents = todayRecords.reduce((sum, record) => sum + record.cents, 0);
    const currentCycle = salaryDayRange(/* @__PURE__ */ new Date());
    const currentCycleRecords = budgetScopedRecords(filteredRecords(files, {
      range: currentCycle,
      scope: "all",
      excludedCategories: [],
      categories: budgetCategory ? [budgetCategory] : [],
      keyword: ""
    }), includeStarred, this.plugin.settings.starredRecordIds);
    const currentCycleCents = currentCycleRecords.reduce((sum, record) => sum + record.cents, 0);
    this.maybeNotifyBudget(today, todayCents, this.plugin.settings.dailyBudgetCents, budgetCategory, includeStarred);
    const financeSnapshot = buildFinanceAdvisorSnapshot(
      flattenRecords(files),
      /* @__PURE__ */ new Date(),
      this.plugin.settings.salaryCents,
      this.plugin.settings.excludedCategories
    );
    const cached = ((_a = this.plugin.settings.financeAdviceCache) == null ? void 0 : _a.date) === financeSnapshot.currentRange.end ? this.plugin.settings.financeAdviceCache.advice : null;
    const configured = this.plugin.settings.financeAiEnabled && Boolean(this.plugin.settings.financeAiEndpoint.trim()) && Boolean(this.plugin.settings.financeAiModel.trim());
    let financeState;
    if (!this.plugin.settings.financeAiEnabled) {
      financeState = { status: "local", advice: null, message: "AI \u5224\u65AD\u672A\u542F\u7528\uFF0C\u5F53\u524D\u663E\u793A\u672C\u5730\u5019\u9009\u7ED3\u679C\u3002", canRefresh: false };
    } else if (!configured) {
      financeState = { status: "unconfigured", advice: null, message: "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199 AI \u63A5\u53E3\u548C\u6A21\u578B\u3002", canRefresh: false };
    } else if (this.financeAdviceLoading) {
      financeState = { status: "loading", advice: cached, message: "\u6B63\u5728\u5224\u65AD\u6700\u503C\u5F97\u5173\u6CE8\u7684\u53D8\u5316\uFF0C\u6700\u957F\u7B49\u5F85 60 \u79D2\u2026", canRefresh: true };
    } else if (cached) {
      financeState = { status: "ready", advice: cached, message: "\u4ECA\u65E5\u7ED3\u679C\u5DF2\u7F13\u5B58\uFF1B\u8D26\u76EE\u53D8\u5316\u540E\u53EF\u624B\u52A8\u91CD\u65B0\u5224\u65AD\u3002", canRefresh: true };
    } else if (this.financeAdviceError) {
      financeState = { status: "error", advice: null, message: `${this.financeAdviceError}\uFF0C\u5DF2\u56DE\u9000\u4E3A\u672C\u5730\u5224\u65AD\u3002`, canRefresh: true };
    } else {
      financeState = { status: "local", advice: null, message: "\u70B9\u51FB\u201C\u5237\u65B0\u5224\u65AD\u201D\u751F\u6210\u9996\u6B21\u7ED3\u679C\uFF1B\u4EE5\u540E\u6BCF\u5929\u81EA\u52A8\u66F4\u65B0\u4E00\u6B21\u3002", canRefresh: true };
    }
    renderFinanceAdvisor(parent, financeSnapshot, financeState, () => void this.loadFinanceAdvice(financeSnapshot, true));
    if (configured && financeSnapshot.salaryCents > 0 && this.plugin.settings.financeAdviceCache && !cached && !this.financeAdviceLoading && this.financeAdviceAttemptedDate !== financeSnapshot.currentRange.end) {
      this.financeAdviceAttemptedDate = financeSnapshot.currentRange.end;
      window.setTimeout(() => void this.loadFinanceAdvice(financeSnapshot, false), 0);
    }
    renderLiquidBudget(parent, todayCents, this.plugin.settings.dailyBudgetCents, today.replace(/-/g, "."), currentCycleCents, budgetCategory, includeStarred);
    const metrics = parent.createDiv({ cls: "ledger-metrics" });
    this.metric(metrics, "\u6240\u9009\u671F\u95F4\u603B\u989D", formatCents(stats.cents), `${stats.count} \u7B14`, () => this.goDetails());
    this.metric(metrics, "\u7B14\u6570", String(stats.count), "\u70B9\u51FB\u67E5\u770B\u5168\u90E8\u660E\u7EC6", () => this.goDetails());
    this.metric(metrics, "\u65E5\u5747", formatCents(stats.averagePerRecordedDayCents), `\u5206\u6BCD\uFF1A${stats.recordedDays} \u4E2A\u6709\u65E5\u8BB0\u8D26\u6587\u4EF6\u7684\u65E5\u671F`, () => this.goDetails());
    this.metric(metrics, "\u6700\u5927\u5355\u7B14", stats.maxRecord ? formatCents(stats.maxRecord.cents) : "\u2014", stats.maxRecord ? `${stats.maxRecord.category} \xB7 ${stats.maxRecord.date}` : "\u6682\u65E0\u8BB0\u5F55", () => this.goDetails());
    if (records.length === 0) {
      renderEmpty(parent, "\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u4E0B\u6CA1\u6709\u8BB0\u5F55\u3002\u7F3A\u5C11\u6587\u4EF6\u7684\u65E5\u671F\u4E0D\u4F1A\u6309\u96F6\u6D88\u8D39\u5904\u7406\u3002");
    } else {
      const grid = parent.createDiv({ cls: "ledger-overview-grid" });
      renderHorizontalBars(grid, categorySummaries(records).slice(0, 8), (category) => this.drillCategory(category));
      renderTrendChart(grid, trendPoints(records, this.rangeTrendUnit()), "line", (point) => this.drillRange({ start: point.start, end: point.end }));
    }
    renderStarredExpenses(parent, this.starredRecords(), (record) => void this.openRecord(record));
  }
  async loadFinanceAdvice(snapshot, manual) {
    if (this.financeAdviceLoading) return;
    if (snapshot.salaryCents <= 0) {
      if (manual) new import_obsidian5.Notice("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u6BCF\u4E2A\u5DE5\u8D44\u5468\u671F\u5230\u8D26\u5DE5\u8D44");
      return;
    }
    this.financeAdviceLoading = true;
    this.financeAdviceError = "";
    this.render();
    try {
      const advice = await requestFinanceAdvice({
        endpoint: this.plugin.settings.financeAiEndpoint,
        apiKey: this.plugin.settings.financeAiApiKey,
        model: this.plugin.settings.financeAiModel
      }, snapshot);
      this.plugin.settings.financeAdviceCache = {
        date: snapshot.currentRange.end,
        fingerprint: financeSnapshotFingerprint(snapshot),
        advice,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await this.plugin.saveSettings(false, false);
      if (manual) new import_obsidian5.Notice("\u8D22\u52A1\u5224\u65AD\u5DF2\u66F4\u65B0");
    } catch (error) {
      this.financeAdviceError = error instanceof Error ? error.message : "AI \u8BF7\u6C42\u5931\u8D25";
      if (manual) new import_obsidian5.Notice(this.financeAdviceError);
    } finally {
      this.financeAdviceLoading = false;
      this.render();
    }
  }
  maybeNotifyBudget(today, spentCents, budgetCents, budgetCategory, includeStarred) {
    const barkUrl = this.plugin.settings.barkUrl.trim();
    if (!barkUrl || budgetCents <= 0 || spentCents < budgetCents || this.plugin.settings.lastBudgetNotificationDate === today || this.budgetNotificationInFlight) return;
    const overBudgetCents = spentCents - budgetCents;
    const title = overBudgetCents > 0 ? "\u4ECA\u65E5\u9884\u7B97\u5DF2\u8D85\u652F" : "\u4ECA\u65E5\u9884\u7B97\u5DF2\u7528\u5C3D";
    const scopeLabel = budgetCategory || "\u5168\u90E8\u5206\u7C7B";
    const starredScope = includeStarred ? "\u542B\u661F\u6807" : "\u4E0D\u542B\u661F\u6807";
    const body = overBudgetCents > 0 ? `\u4ECA\u65E5${scopeLabel}\u652F\u51FA\uFF08${starredScope}\uFF09${formatCents(spentCents)}\uFF0C\u6BCF\u65E5\u9884\u7B97 ${formatCents(budgetCents)}\uFF0C\u8D85\u652F ${formatCents(overBudgetCents)}` : `\u4ECA\u65E5${scopeLabel}\u652F\u51FA\uFF08${starredScope}\uFF09${formatCents(spentCents)}\uFF0C\u5DF2\u8FBE\u5230\u6BCF\u65E5\u9884\u7B97 ${formatCents(budgetCents)}`;
    const url = barkPushUrl(barkUrl, title, body);
    if (!url) return;
    this.budgetNotificationInFlight = true;
    void (0, import_obsidian5.requestUrl)({ url, method: "GET", throw: true }).then(async () => {
      this.plugin.settings.lastBudgetNotificationDate = today;
      try {
        await this.plugin.saveSettings(false, false);
      } catch (e) {
      }
    }).catch(() => {
      new import_obsidian5.Notice("Bark \u63D0\u9192\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u63A8\u9001\u5730\u5740\u548C\u7F51\u7EDC");
    }).finally(() => {
      this.budgetNotificationInFlight = false;
    });
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
    ["\u661F\u6807", "\u65E5\u671F", "\u65F6\u95F4", "\u5206\u7C7B", "\u91D1\u989D", "\u5907\u6CE8", "\u6765\u6E90"].forEach((text) => head.createEl("th", { text }));
    const body = table.createTBody();
    for (const record of records) {
      const row = body.insertRow();
      row.dataset.ledgerRecordId = record.id;
      row.toggleClass("is-starred", this.isStarred(record));
      this.bindRecordInteractions(row, record);
      const starCell = row.createEl("td", { cls: "ledger-detail-star" });
      const starButton = starCell.createEl("button", {
        cls: `ledger-star-toggle${this.isStarred(record) ? " is-active" : ""}`,
        attr: { type: "button", "aria-label": this.isStarred(record) ? "\u53D6\u6D88\u661F\u6807" : "\u6807\u8BB0\u4E3A\u661F\u6807" }
      });
      (0, import_obsidian5.setIcon)(starButton, "star");
      starButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.toggleStar(record);
      });
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
      card.dataset.ledgerRecordId = record.id;
      card.toggleClass("is-starred", this.isStarred(record));
      this.bindRecordInteractions(card, record);
      const top = card.createDiv({ cls: "ledger-detail-card-top" });
      top.createSpan({ text: `${record.date} \xB7 ${record.time}` });
      const amount = top.createDiv({ cls: "ledger-detail-card-amount" });
      amount.createEl("strong", { text: formatCents(record.cents) });
      const starButton = amount.createEl("button", {
        cls: `ledger-star-toggle${this.isStarred(record) ? " is-active" : ""}`,
        attr: { type: "button", "aria-label": this.isStarred(record) ? "\u53D6\u6D88\u661F\u6807" : "\u6807\u8BB0\u4E3A\u661F\u6807" }
      });
      (0, import_obsidian5.setIcon)(starButton, "star");
      starButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.toggleStar(record);
      });
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
    this.periodOffset = 0;
    const now = /* @__PURE__ */ new Date();
    this.filter.range = this.rangeForPreset(preset, now, this.periodOffset);
  }
  shiftPeriod(direction) {
    if (this.preset === "custom") return;
    this.clearDrillContext();
    this.periodOffset += direction;
    this.filter.range = this.rangeForPreset(this.preset, /* @__PURE__ */ new Date(), this.periodOffset);
    this.render();
  }
  rangeForPreset(preset, now, offset) {
    if (preset === "today") {
      const date = addDays(todayIso(), -offset);
      return { start: date, end: date };
    }
    if (preset === "week") return weekRange(now, offset);
    if (preset === "month") return monthRange(now.getFullYear(), now.getMonth() - offset);
    if (preset === "previous") return monthRange(now.getFullYear(), now.getMonth() - 1 - offset);
    if (preset === "salary") return salaryDayRange(now, offset);
    if (preset === "year") {
      const year = now.getFullYear() - offset;
      return { start: `${year}-01-01`, end: offset === 0 ? todayIso() : `${year}-12-31` };
    }
    return { ...this.filter.range };
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
    this.periodOffset = 0;
    this.activeView = "details";
    this.render();
  }
  rangeTrendUnit() {
    const days = daysInclusive2(this.filter.range);
    return days <= 45 ? "day" : days <= 240 ? "week" : "month";
  }
  setCalendarMonth(year, month) {
    this.clearDrillContext();
    this.filter.range = monthRange(year, month);
    this.preset = "custom";
    this.periodOffset = 0;
    this.render();
  }
  captureDrillContext() {
    if (this.drillContext) return;
    this.drillContext = {
      filter: cloneFilter(this.filter),
      preset: this.preset,
      periodOffset: this.periodOffset,
      view: this.activeView
    };
  }
  restoreDrillContext() {
    if (!this.drillContext) return;
    const context = this.drillContext;
    this.filter = cloneFilter(context.filter);
    this.preset = context.preset;
    this.periodOffset = context.periodOffset;
    this.activeView = context.view;
    this.drillContext = null;
    this.render();
  }
  clearDrillContext() {
    this.drillContext = null;
  }
  handleAutoAdvanceTouchStart(event) {
    this.resetAutoAdvanceArm();
    if (!import_obsidian5.Platform.isMobile || event.touches.length !== 1 || !this.pullHint) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, select, textarea, a, svg, .ledger-mobile-trend-scroll, .ledger-tabs, .ledger-header, .ledger-toolbar, .ledger-filter-panel")) {
      this.pullEligible = false;
      return;
    }
    this.touchStartY = event.touches[0].clientY;
    this.touchStartX = event.touches[0].clientX;
    const maxScroll = this.contentEl.scrollHeight - this.contentEl.clientHeight;
    if (maxScroll > 6) {
      this.pullEligible = maxScroll - this.contentEl.scrollTop <= 6;
    } else {
      const rect = this.contentEl.getBoundingClientRect();
      const relativeY = event.touches[0].clientY - rect.top;
      this.pullEligible = relativeY > rect.height * 0.6;
    }
  }
  handleAutoAdvanceTouchMove(event) {
    if (!this.pullEligible) return;
    if (event.touches.length !== 1) {
      this.resetAutoAdvanceArm();
      return;
    }
    const dy = this.touchStartY - event.touches[0].clientY;
    const dx = Math.abs(this.touchStartX - event.touches[0].clientX);
    this.pullPeakDistance = Math.max(this.pullPeakDistance, dy);
    if (dy < -8 || this.pullPeakDistance - dy > 8 || dx > Math.max(18, Math.abs(dy))) {
      this.resetAutoAdvanceArm();
      return;
    }
    this.pullDistance = Math.max(0, dy);
    if (this.pullDistance > 8 && event.cancelable) event.preventDefault();
    const next = VIEW_NAMES2[VIEW_NAMES2.findIndex(([id]) => id === this.activeView) + 1];
    if (!next || !this.pullHint) return;
    this.contentEl.addClass("ledger-is-pulling");
    this.contentEl.style.setProperty("--ledger-pull", `${-Math.min(48, this.pullDistance * 0.32)}px`);
    this.pullHint.style.setProperty("--pull-progress", String(Math.min(1, this.pullDistance / AUTO_ADVANCE_SWIPE_DISTANCE)));
    this.pullHint.setText(this.pullDistance >= AUTO_ADVANCE_SWIPE_DISTANCE ? `\u677E\u624B\u5207\u6362\u5230${next[1]}` : `\u7EE7\u7EED\u4E0A\u62C9\uFF0C\u67E5\u770B${next[1]}`);
  }
  finishPull(cancelled) {
    var _a;
    if (this.settleTimer !== null) return;
    const next = VIEW_NAMES2[VIEW_NAMES2.findIndex(([id]) => id === this.activeView) + 1];
    const advance = !cancelled && this.pullEligible && this.pullDistance >= AUTO_ADVANCE_SWIPE_DISTANCE;
    this.resetAutoAdvanceArm();
    if (advance && next) {
      (_a = this.pullHint) == null ? void 0 : _a.setText(`\u56DE\u5F39\u540E\u8FDB\u5165${next[1]}`);
      this.settleTimer = window.setTimeout(() => {
        this.settleTimer = null;
        this.activeView = next[0];
        this.render();
        this.contentEl.scrollTop = 0;
      }, 360);
    }
  }
  resetAutoAdvanceArm() {
    if (this.settleTimer !== null) {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.pullEligible = false;
    this.pullDistance = 0;
    this.pullPeakDistance = 0;
    this.contentEl.removeClass("ledger-is-pulling");
    this.contentEl.style.setProperty("--ledger-pull", "0px");
    if (this.pullHint) {
      const next = VIEW_NAMES2[VIEW_NAMES2.findIndex(([id]) => id === this.activeView) + 1];
      this.pullHint.style.setProperty("--pull-progress", "0");
      if (next) this.pullHint.setText(`\u7EE7\u7EED\u4E0A\u62C9\uFF0C\u67E5\u770B${next[1]}`);
    }
  }
  sortDetails(records) {
    const copy = [...records];
    if (this.detailSort === "amount-desc") return copy.sort((a, b) => b.cents - a.cents || b.date.localeCompare(a.date));
    if (this.detailSort === "amount-asc") return copy.sort((a, b) => a.cents - b.cents || b.date.localeCompare(a.date));
    return copy.sort((a, b) => b.date.localeCompare(a.date) || b.line - a.line);
  }
  starredRecords() {
    const starred = new Set(this.plugin.settings.starredRecordIds);
    const { start, end } = this.filter.range;
    return [...this.plugin.repository.files.values()].flatMap((file) => file.records).filter((record) => starred.has(record.id) && record.date >= start && record.date <= end).sort((a, b) => b.cents - a.cents || b.date.localeCompare(a.date) || b.line - a.line);
  }
  isStarred(record) {
    return this.plugin.settings.starredRecordIds.includes(record.id);
  }
  async toggleStar(record) {
    const starred = new Set(this.plugin.settings.starredRecordIds);
    const wasStarred = starred.has(record.id);
    if (wasStarred) starred.delete(record.id);
    else starred.add(record.id);
    this.plugin.settings.starredRecordIds = [...starred];
    await this.plugin.saveSettings(false, false);
    this.updateStarState(record, !wasStarred);
    new import_obsidian5.Notice(wasStarred ? "\u5DF2\u53D6\u6D88\u661F\u6807" : "\u5DF2\u6807\u8BB0\u4E3A\u661F\u6807");
  }
  updateStarState(record, starred) {
    const elements = Array.from(this.contentEl.querySelectorAll("[data-ledger-record-id]"));
    for (const element of elements) {
      if (element.dataset.ledgerRecordId !== record.id) continue;
      element.toggleClass("is-starred", starred);
      const button = element.querySelector(".ledger-star-toggle");
      button == null ? void 0 : button.toggleClass("is-active", starred);
      button == null ? void 0 : button.setAttribute("aria-label", starred ? "\u53D6\u6D88\u661F\u6807" : "\u6807\u8BB0\u4E3A\u661F\u6807");
    }
  }
  bindRecordInteractions(element, record) {
    let longPressTimer = null;
    let longPressTriggered = false;
    const clearLongPress = () => {
      if (longPressTimer !== null) window.clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      this.showRecordMenu(record, event);
    });
    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      clearLongPress();
      longPressTriggered = false;
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        longPressTriggered = true;
        this.showRecordMenu(record, { x: event.clientX, y: event.clientY });
      }, 560);
    });
    element.addEventListener("pointerup", clearLongPress);
    element.addEventListener("pointercancel", clearLongPress);
    element.addEventListener("pointerleave", clearLongPress);
  }
  showRecordMenu(record, event) {
    const starred = this.isStarred(record);
    const menu = new import_obsidian5.Menu();
    menu.addItem((item) => item.setTitle(starred ? "\u53D6\u6D88\u661F\u6807" : "\u6807\u8BB0\u4E3A\u661F\u6807").setIcon("star").onClick(() => void this.toggleStar(record)));
    menu.addItem((item) => item.setTitle("\u6253\u5F00\u6765\u6E90").setIcon("file-text").onClick(() => void this.openRecord(record)));
    if (event instanceof MouseEvent) menu.showAtMouseEvent(event);
    else menu.showAtPosition(event);
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
      previous: { start: addDays(previousEnd, -daysInclusive2(current) + 1), end: previousEnd },
      description: "\u6309\u76F8\u540C\u5929\u6570\u7684\u7D27\u90BB\u4E0A\u4E00\u671F\u95F4\u6BD4\u8F83"
    };
  }
  async openRecord(record) {
    await this.openPath(record.path, record.line);
  }
  async openPath(path, line) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian5.TFile)) {
      new import_obsidian5.Notice(`\u627E\u4E0D\u5230\u6765\u6E90\u6587\u4EF6\uFF1A${path}`);
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
    if (line) {
      window.requestAnimationFrame(() => {
        const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
        if (view) {
          view.editor.setCursor({ line: Math.max(0, line - 1), ch: 0 });
          view.editor.scrollIntoView({ from: { line: Math.max(0, line - 2), ch: 0 }, to: { line, ch: 0 } }, true);
        }
      });
    }
  }
};

// src/main.ts
var LedgerStatisticsPlugin = class extends import_obsidian6.Plugin {
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
  async saveSettings(rescan, refresh = true) {
    await this.saveData(this.settings);
    if (rescan) await this.repository.setFolder(this.settings.ledgerFolder);
    if (refresh) this.refreshViews();
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
