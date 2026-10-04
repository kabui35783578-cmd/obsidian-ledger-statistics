import type { LedgerRecord } from './core';
import type { ReportEvidence, ReportFact, ReportReading } from './report';

const fact = (label: string, value: number, unit: ReportFact['unit']): ReportFact => ({ label, value, unit });
const sum = (values: number[]) => values.reduce((s, n) => s + n, 0);
function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p, low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}

/** Facts are always available, even when the sample is too small to nominate a finding. */
export function distributionEvidence(current: LedgerRecord[], previous: LedgerRecord[], scale: number, comparable: boolean, topCount: number, binRoundCents: number): Record<string, ReportFact> {
  const a = current.map(r => r.cents).sort((x, y) => x - y), b = previous.map(r => r.cents).sort((x, y) => x - y);
  const facts: Record<string, ReportFact> = {};
  for (const [name, values] of [['current', a], ['previous', b]] as const) {
    if (values.length) for (const p of [25, 75, 90]) facts[`${name}_p${p}`] = fact(`${name === 'current' ? '本期' : '上期'}单笔金额P${p}`, quantile(values, p / 100) / 100, '元');
    const top = values.slice(Math.max(0, values.length - topCount)), rest = values.slice(0, Math.max(0, values.length - topCount));
    facts[`top3_${name}_n`] = fact(`${name === 'current' ? '本期' : '上期'}最贵记录实际取样笔数`, top.length, '笔');
    facts[`top3_${name}_amount`] = fact(`${name === 'current' ? '本期' : '上期'}最贵${topCount}笔合计`, sum(top) / 100, '元');
    facts[`remaining_${name}_n`] = fact(`${name === 'current' ? '本期' : '上期'}扣除各自最贵${topCount}笔后的笔数`, rest.length, '笔');
    facts[`remaining_${name}_amount`] = fact(`${name === 'current' ? '本期' : '上期'}扣除各自最贵${topCount}笔后的金额`, sum(rest) / 100, '元');
  }
  if (comparable) {
    const delta = (sum(a) - sum(b) * scale) / 100;
    const topDelta = facts.top3_current_amount.value - facts.top3_previous_amount.value * scale;
    facts.amount_difference = fact('已记录金额差额（上期按观察日折算）', delta, '元');
    facts.top3_difference = fact('两期各自最贵记录合计差额（已折算）', topDelta, '元');
    facts.remaining_difference = fact('扣除各自最贵记录后的金额差额（已折算）', facts.remaining_current_amount.value - facts.remaining_previous_amount.value * scale, '元');
    if (scale !== 1) {
      facts.top3_previous_scaled = fact('上期最贵记录合计按观察日折算', facts.top3_previous_amount.value * scale, '元');
      facts.remaining_previous_scaled = fact('上期扣除最贵记录后金额按观察日折算', facts.remaining_previous_amount.value * scale, '元');
    }
    // Signed accounting ratio, not a probability or a matched-transaction causal attribution.
    if (Math.abs(delta) > 1e-9) facts.top3_contribution = fact('最贵记录差额 / 总金额差额（可为负或超过100%）', topDelta / delta * 100, '%');
  }
  const pooled = [...a, ...b].sort((x, y) => x - y);
  const edges = [0, ...[.25, .5, .75].map(p => Math.round(quantile(pooled, p) / binRoundCents) * binRoundCents), Infinity].filter((n, i, all) => !i || n > all[i - 1]);
  for (let i = 0; i < edges.length - 1; i++) {
    const low = edges[i], high = edges[i + 1], label = high === Infinity ? `${low / 100}元及以上` : `${low / 100}～${high / 100}元（不含上界）`;
    facts[`current_bin_${i}`] = fact(`本期${label}笔数`, a.filter(n => n >= low && n < high).length, '笔');
    facts[`previous_bin_${i}`] = fact(`上期${label}笔数`, b.filter(n => n >= low && n < high).length, '笔');
    if (scale !== 1 && comparable) facts[`previous_bin_${i}_scaled`] = fact(`上期${label}笔数按观察日折算`, facts[`previous_bin_${i}`].value * scale, '笔');
  }
  return facts;
}

/** Describe both directions of evidence without deciding that every payment changed. */
export function evidenceReadings(e: ReportEvidence, comparable: boolean): NonNullable<ReportEvidence['readings']> {
  const supporting: ReportReading[] = [], counter: ReportReading[] = [], f = e.facts;
  const add = (list: ReportReading[], text: string, ...keys: string[]) => list.push({ text, factKeys: keys.filter(k => k in f) });
  if (comparable && f.current_mean && f.previous_mean) {
    const mean = f.current_mean.value - f.previous_mean.value, median = f.current_median.value - f.previous_median.value;
    const count = f.current_count.value - (f.previous_count_scaled ?? f.previous_count).value;
    if (Math.abs(count) < 1e-9) add(supporting, '两期按观察日对齐后笔数相同，总额差对应平均每笔金额变化；这是计算关系。', 'current_count', 'previous_count', 'previous_count_scaled', 'ticket_contribution');
    if (median !== 0) add(supporting, `单笔中位数${median > 0 ? '上涨' : '下降'}，反映分布中间位置变化，不代表每一笔都变化。`, 'current_median', 'previous_median');
    if (mean !== 0 && mean * median <= 0) add(counter, '平均数与中位数没有同向变化，不能用平均数代表典型付款。', 'current_mean', 'previous_mean', 'current_median', 'previous_median');
    if (f.top3_difference && Math.abs(f.top3_difference.value) > 1e-9) add(supporting, '两期各自最贵记录的合计在比较口径下有差额，需要与扣除后的其余记录一起判断。', 'top3_current_amount', 'top3_previous_amount', 'top3_previous_scaled', 'top3_difference', 'top3_contribution', 'remaining_difference');
    if (f.top3_contribution && f.top3_contribution.value >= 50) add(counter, '最贵记录的差额占总差额至少一半；即使中位数同向变化，也不能排除少数大额记录的影响。', 'top3_contribution', 'top3_difference', 'remaining_difference', 'current_median', 'previous_median');
    if (f.top3_difference && f.remaining_difference && f.top3_difference.value * f.remaining_difference.value < 0) add(counter, '最贵记录与其余记录的金额变化方向相反，存在抵消，不能推广为普遍上涨或下降。', 'top3_difference', 'remaining_difference');
    if (f.current_p25 && f.previous_p25 && mean * (f.current_p25.value - f.previous_p25.value) < 0) add(counter, '较低金额位置与平均数变化方向相反，金额分布并非一致移动。', 'current_p25', 'previous_p25', 'current_mean', 'previous_mean');
    add(counter, '平均数、中位数或金额分解都不能单独证明商品涨价、每笔付款都变贵或生活原因。', 'current_mean', 'previous_mean', 'current_median', 'previous_median');
  }
  if (e.categories && comparable) {
    const changes = e.categories.filter(c => c.difference !== undefined && Math.abs(c.difference) > 1e-9);
    if (changes.some(c => c.difference! > 0) && changes.some(c => c.difference! < 0)) add(counter, '分类金额有增有减；总额方向不代表所有类别都同向变化。');
    if (changes.some(c => c.status === 'new')) add(counter, '存在上期未记录金额、本期有记录的分类；需区分新增支出与原有付款金额变化。');
  }
  if (f.early && f.late) add(supporting, '前后完整周的记录频次不同，可核对周中位数与趋势方向。', 'early', 'late', 'slope');
  if (f.before && f.after) add(supporting, '候选分界前后周笔数中位数不同，分界仍是探索性结果。', 'before', 'after');
  if (f.together) add(supporting, '不同账目在同日共同出现，并有星期匹配对照数据。', 'together', 'lift', 'adjusted_p');
  if (f.count && f.days) add(supporting, '这组记录的笔数与出现天数可核对；记录笔数不代表购买数量。', 'count', 'days', 'concentration');
  if (f.together) add(counter, '星期匹配仍不能控制所有生活情境和连续日期依赖；同日关联不代表先后、触发或因果。', 'together', 'adjusted_p');
  if (f.count && f.days) add(counter, '几个完整周重复出现不代表已形成长期习惯或固定支出，仍需后续周期核对。', 'count', 'days');
  if (f.early || f.before) add(counter, '记录频次与候选周分界只能描述变化，不能据此确定某一天或生活原因。', 'early', 'late', 'before', 'after', 'slope');
  if (f.peak_daily) {
    add(supporting, '高峰和对照的日均金额、重复周占比可一起核对，不只依赖某一次付款。', 'peak_daily', 'reference_daily', 'repeat_share');
    add(counter, '星期高峰不代表消费失控，也不能直接断言工作、通勤或休闲原因。', 'peak_daily', 'reference_daily');
  }
  if (f.history_median) {
    add(supporting, '本期日均金额可与多个完整历史周期的日均中位数比较。', 'current_daily', 'history_median', 'periods_used');
    add(counter, '完整历史周期与本期已过阶段可能包含不同固定付款日期；偏离历史日均不等于消费需求改变。', 'current_daily', 'history_median');
  }
  if (f.outlier_amount) {
    add(supporting, '本期这笔付款高于该分类完整历史期的金额参考，属于可核对的大额线索。', 'outlier_amount', 'history_p90', 'outlier_share');
    add(counter, '同分类可能包含不同用途；单笔金额较高不能直接判断浪费、交易异常或商品涨价。', 'outlier_amount', 'history_p90');
  }
  if (f.classification_variation) add(counter, '分类归属变化可能来自记账方式，不能将其直接当成消费需求变化。', 'classification_variation');
  if (f.current_amount_share) add(counter, '占比变化也可能来自其他分类减少；需要同时核对绝对金额和笔数。', 'current_amount_share', 'previous_amount_share', 'current_amount', 'previous_amount');
  return { supporting, counter };
}

export function overviewSections(facts: Record<string, ReportFact>): NonNullable<ReportEvidence['sections']> {
  const used = new Set<string>(), section = (label: string, keys: string[], expanded = false) => {
    keys = keys.filter(k => k in facts); keys.forEach(k => used.add(k)); return { label, keys, expanded };
  };
  const result = [
    section('总量与典型单笔', ['current_amount', 'previous_amount', 'previous_amount_scaled', 'amount_difference', 'current_count', 'previous_count', 'previous_count_scaled', 'current_mean', 'previous_mean', 'current_median', 'previous_median'], true),
    section('最贵几笔与其余付款', Object.keys(facts).filter(k => k.startsWith('top3_') || k.startsWith('remaining_')), true),
    section('金额分布与档位', Object.keys(facts).filter(k => /_p(25|75|90)$|_bin_/.test(k))),
    section('总额的计算分解', ['frequency_contribution', 'ticket_contribution']),
  ];
  result.push(section('日期覆盖与消费频次', Object.keys(facts).filter(k => !used.has(k))));
  return result.filter(s => s.keys.length);
}
