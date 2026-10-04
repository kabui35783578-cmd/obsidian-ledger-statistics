import { addDays, budgetScopedRecords, DateRange, FilterState, flattenRecords, isoFromDate, LedgerRecord, ParsedLedgerFile, recordMatches } from './core';
import { identifyReportObjects, cosine, reportCoverageIndexed, reportDays, reportHash, reportMedian, reportPeriods, REPORT_RULE_VERSION, symmetricDecomposition, theilSen } from './report';
import type { ReportAnalysisOptions, ReportCoverage, ReportEvidence, ReportFact, ReportFinding, ReportObject, ReportPreferences, ReportSnapshot } from './report';
import { DEFAULT_REPORT_OBJECT_RULES, parseObjectRules, REPORT_THRESHOLDS } from './report-config';
import { stratifiedAssociationTail } from './report-statistics';
import { distributionEvidence, evidenceReadings, overviewSections } from './report-evidence';

const total = (r: LedgerRecord[]) => r.reduce((s, t) => s + t.cents, 0);
const unique = (r: LedgerRecord[]) => [...new Map(r.map(t => [t.id, t])).values()];
const dates = (r: DateRange) => Array.from({ length: reportDays(r) }, (_, i) => addDays(r.start, i));
const weekday = (d: string) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> { const out = new Map<string, T[]>(); for (const item of items) { const k = key(item), a = out.get(k) ?? []; a.push(item); out.set(k, a); } return out; }
function stats(r: LedgerRecord[]) { return { n: r.length, cents: total(r), mean: r.length ? total(r) / r.length : 0, median: reportMedian(r.map(t => t.cents)), days: new Set(r.map(t => t.date)).size }; }
const fact = (label: string, value: number, unit: ReportFact['unit']): ReportFact => ({ label, value, unit });
const quantile = (values: number[], p: number) => { const a = [...values].sort((x, y) => x - y); if (!a.length) return 0; const pos = (a.length - 1) * p, lo = Math.floor(pos); return a[lo] + (a[Math.ceil(pos)] - a[lo]) * (pos - lo); };
export function trimTrailingGap(c: ReportCoverage, today: string, max: number): DateRange | null {
  if (c.range.end !== today || c.problems.length || !c.missingDates.length || c.missingDates.length > max || c.missingDates.length >= reportDays(c.range)) return null;
  const missing = new Set(c.missingDates);
  if (!dates({ start: c.missingDates[0], end: c.range.end }).every(d => missing.has(d))) return null;
  return { ...c.range, end: addDays(c.missingDates[0], -1) };
}
const FAMILY: Record<string, 'change' | 'time'> = { comparison:'change', classification:'change', structure:'change', mix:'change', history:'change', outlier:'change', repeat:'time', trend:'time', level:'time', rhythm:'time', association:'time' };
const WEIGHT: Record<string, number> = { comparison:70, classification:60, structure:65, mix:55, history:75, outlier:70, repeat:55, trend:75, level:70, rhythm:65, association:55 };

export function analyzeReport(files: ParsedLedgerFile[], preferences: ReportPreferences, now: Date, excludedCategories: string[], starredIds: string[], options: ReportAnalysisOptions): ReportSnapshot {
  const T = { ...REPORT_THRESHOLDS, ...options.thresholds }, rules = parseObjectRules(options.objectRules ?? DEFAULT_REPORT_OBJECT_RULES);
  const periods = reportPeriods(preferences, now), today = isoFromDate(now), index = group(files.filter(f => !!f.date), f => f.date!);
  const cover = (range: DateRange) => reportCoverageIndexed(index, range);
  const initial = cover(periods.range), trimmed = periods.fullRange.end > today ? trimTrailingGap(initial, today, T.maxTrailingGap) : null;
  const effectiveRange = trimmed ?? periods.range, trimmedDates = trimmed ? initial.missingDates : [];
  let previousRange = periods.previous;
  if (trimmed) previousRange = { start: periods.previous.start, end: addDays(periods.previous.start, Math.min(reportDays(trimmed), reportDays(periods.history[0])) - 1) };
  const coverage = [effectiveRange, previousRange, ...periods.history].map(cover), undatedPaths = files.filter(f => !f.date).map(f => f.path);
  const firstDate = [...index.keys()].sort()[0] ?? today;
  const eligible = (c: ReportCoverage) => c.complete || (!c.problems.length && c.range.start >= firstDate && c.missingDates.length <= T.maxInteriorGap && c.missingDates.length <= reportDays(c.range) * T.maxInteriorGapRatio && c.missingDates.every(d => d > c.range.start && d < c.range.end));
  const comparable = !undatedPaths.length && eligible(coverage[0]) && eligible(coverage[1]);
  const degraded = comparable && (!coverage[0].complete || !coverage[1].complete);
  const observed = coverage.slice(0, 2).map(c => reportDays(c.range) - c.missingDates.length) as [number, number];
  const k = observed[1] ? observed[0] / observed[1] : 1;
  const flattened = unique(flattenRecords(files));
  const selected = (range: DateRange) => budgetScopedRecords(flattened.filter(r => recordMatches(r, { range, scope:preferences.scope, excludedCategories, categories:preferences.category ? [preferences.category] : [], keyword:preferences.keyword } as FilterState)), preferences.includeStarred, starredIds);
  const allRange = { start:periods.history[5].start, end:effectiveRange.end }, all = selected(allRange), current = selected(effectiveRange), previous = selected(previousRange);
  const snapshot: ReportSnapshot = { ruleVersion:REPORT_RULE_VERSION, fingerprint:'', label:preferences.mode === 'salary' ? '工资周期支出报告' : preferences.mode === 'month' ? '自然月支出报告' : '自定义支出报告', range:periods.range, fullRange:periods.fullRange, effectiveRange, previousRange, trimmedDates, degraded, observedDays:observed, coverage, undatedPaths, comparable, historicalRanges:coverage.slice(2).filter(c => c.complete && !undatedPaths.length).map(c => c.range), records:all, preferences, excludedCategories, findings:[], evidence:[] };
  const limits = ['笔数是账目记录，不代表商品数量；每笔付款金额不是商品单价。', '备注用途识别可能受记账习惯影响，无法确认漏记或生活原因。', '总额的次数/平均每笔分解是计算关系，不代表每一笔付款变贵或商品涨价。', '最贵记录取两期各自排序后的记录，不是同一商品配对；差额占比可为负或超过100%，不代表因果或置信概率。'];
  if (degraded) limits.push(`本期缺${coverage[0].missingDates.length}天，上期缺${coverage[1].missingDates.length}天；仅比较已观察日期，不能推断完整周期总额。`);
  if (k !== 1) limits.push(`上期按${observed[0]} / ${observed[1]}个已观察日折算；原始金额与笔数保留供核对，折算不是实际付款。`);
  if (k !== 1) limits.push('周期天数不同时，固定笔数的最贵记录差额也受样本量和折算影响，应结合分位数及其余记录核对，不代表同一付款变贵。');
  if (rules.errors.length) limits.push('部分对象识别规则无效，未参与识别；请核对设置。');
  const comparisonFacts = (aa: LedgerRecord[], bb: LedgerRecord[]) => {
    const a = stats(aa), b = stats(bb), d = symmetricDecomposition(b.n * k, b.cents * k, a.n, a.cents);
    const result: Record<string, ReportFact> = {
      current_amount:fact('本期已记录金额',a.cents/100,'元'), previous_amount:fact('上期已记录金额',b.cents/100,'元'), current_count:fact('本期笔数',a.n,'笔'), previous_count:fact('上期笔数',b.n,'笔'),
      current_mean:fact('本期平均每笔',a.mean/100,'元'), previous_mean:fact('上期平均每笔',b.mean/100,'元'), current_median:fact('本期单笔中位数',a.median/100,'元'), previous_median:fact('上期单笔中位数',b.median/100,'元'),
      current_days:fact('本期出现天数',a.days,'天'), previous_days:fact('上期出现天数',b.days,'天'), current_calendar_days:fact('本期自然日数',reportDays(effectiveRange),'天'), previous_calendar_days:fact('上期自然日数',reportDays(previousRange),'天'),
      current_observed_days:fact('本期已观察日数',observed[0],'天'), previous_observed_days:fact('上期已观察日数',observed[1],'天'), current_missing_days:fact('本期缺失日数',coverage[0].missingDates.length,'天'), previous_missing_days:fact('上期缺失日数',coverage[1].missingDates.length,'天'),
      current_daily_count:fact('本期每观察日笔数',a.n/Math.max(1,observed[0]),'笔'), previous_daily_count:fact('上期每观察日笔数',b.n/Math.max(1,observed[1]),'笔'),
      current_active_day_count:fact('本期每个消费日笔数',a.days?a.n/a.days:0,'笔'), previous_active_day_count:fact('上期每个消费日笔数',b.days?b.n/b.days:0,'笔'),
      ...distributionEvidence(aa, bb, k, comparable, T.topCount, T.binRoundCents)
    };
    if (comparable && a.n && b.n) {
      result.frequency_contribution=fact('笔数变化对应的分解差额',d.frequency/100,'元');
      result.ticket_contribution=fact('平均每笔金额变化对应的分解差额',d.ticket/100,'元');
    }
    if (!a.n) { delete result.current_mean; delete result.current_median; }
    if (!b.n) { delete result.previous_mean; delete result.previous_median; }
    if (k !== 1 && comparable) { result.previous_amount_scaled=fact('上期按本期观察日折算金额',b.cents*k/100,'元'); result.previous_count_scaled=fact('上期按本期观察日折算笔数',b.n*k,'笔'); }
    return result;
  };
  const ranges = [{label:'本期实际分析',range:effectiveRange},{label:'上期比较',range:previousRange}];
  const scopeFor = (subject: string): NonNullable<ReportEvidence['scope']> => {
    const kind = subject.includes('+') ? 'multiple' : subject.split(':')[0];
    return { kind:['category','object','brand','mixed','note','multiple'].includes(kind) ? kind as NonNullable<ReportEvidence['scope']>['kind'] : 'all', label:subject.includes(':') ? subject.replace(/(?:category|object|brand|mixed|note):/g, '') : '全部筛选后支出', accounting:preferences.scope };
  };
  const add = (subject:string,type:string,title:string,observation:string,strength:number,rs:LedgerRecord[],facts:Record<string,ReportFact>,extraLimits:string[]=limits,rsRanges=ranges,signals?:ReportFinding['signals'],evidenceScope?:ReportEvidence['scope']) => {
    const id = `${type}:${reportHash(subject+title+JSON.stringify(rsRanges))}`;
    const score = (WEIGHT[type]??55)*(.6+.4*Math.max(0,Math.min(1,strength)))*(degraded && FAMILY[type]==='change' ? .85 : 1);
    snapshot.evidence.push({id,label:title,scope:evidenceScope??scopeFor(subject),ranges:rsRanges,facts,recordIds:unique(rs).map(r=>r.id),limits:[...new Set(extraLimits)]});
    snapshot.findings.push({id,subject,type,title,observation,score,evidenceIds:[id],limits:[...new Set(extraLimits)],...(signals?.length?{signals}: {})});
  };
  const objectGroups = (rs:LedgerRecord[]) => { const out = new Map<string, ReportObject & {records:LedgerRecord[]}>(); for(const r of rs) for(const o of identifyReportObjects(r.note,rules)) {const g=out.get(o.key)??{...o,records:[]};g.records.push(r);out.set(o.key,g);}return out; };
  const objectsNow=objectGroups(current),objectsPrev=objectGroups(previous),objectsAll=objectGroups(all),aCats=group(current,r=>r.category),bCats=group(previous,r=>r.category),cats=[...new Set([...aCats.keys(),...bCats.keys()])];
  const overview: ReportEvidence = {id:'overview',label:'本期概况',scope:scopeFor('overview'),ranges,facts:comparisonFacts(current,previous),recordIds:unique([...current,...previous]).map(r=>r.id),limits:[...limits,...(!comparable?['可比数据不足，原始已记录总量仅供核对，不据此判断涨跌。']:[])]};
  overview.categories=cats.map(c=>{
    const a=total(aCats.get(c)??[])/100,b=total(bCats.get(c)??[])/100;
    return {label:c,current:a,previous:b,previousScaled:comparable?b*k:b,...(comparable?{difference:a-b*k}:{}),status:(!comparable?'unknown':b===0&&a>0?'new':a===0&&b>0?'ceased':'existing') as 'new'|'ceased'|'existing'|'unknown'};
  }).sort((a,b)=>comparable?Math.abs(b.difference!)-Math.abs(a.difference!)||a.label.localeCompare(b.label):b.current-a.current||a.label.localeCompare(b.label));
  overview.sections=overviewSections(overview.facts);
  snapshot.overview=overview;snapshot.evidence.push(overview);
  const subjects = new Map<string,{label:string;kind:ReportObject['kind']|'category';a:LedgerRecord[];b:LedgerRecord[]}>();
  cats.forEach(c=>subjects.set(`category:${c}`,{label:c,kind:'category',a:aCats.get(c)??[],b:bCats.get(c)??[]}));
  for(const key of new Set([...objectsNow.keys(),...objectsPrev.keys()])){const g=objectsNow.get(key)??objectsPrev.get(key)!;subjects.set(key,{label:g.label,kind:g.kind,a:unique(objectsNow.get(key)?.records??[]),b:unique(objectsPrev.get(key)?.records??[])});}
  if(comparable) for(const [key,s] of subjects){
    const a=stats(s.a),b=stats(s.b);if(Math.max(a.n,b.n)<T.minSubjectCount)continue;
    const delta=a.cents-b.cents*k, rate=b.n*k?a.n/(b.n*k)-1:null, amountRate=b.cents*k?a.cents/(b.cents*k)-1:null;
    const minRate=degraded?T.degradedRate:T.rateDelta;
    const frequency=Math.abs(a.n-b.n*k)>=T.countDelta&&(rate===null||Math.abs(rate)>=minRate),amount=Math.abs(delta)>=T.amountDeltaCents&&(amountRate===null||Math.abs(amountRate)>=(degraded?T.degradedRate:T.amountRate));
    const top=(r:LedgerRecord[])=>[...r].sort((x,y)=>y.cents-x.cents).slice(0,T.topCount),topDelta=total(top(s.a))-total(top(s.b))*k;
    const distribution=a.n>=T.distributionMin&&b.n>=T.distributionMin;
    const big=distribution&&Math.abs(delta)>=T.amountDeltaCents&&topDelta/delta>=T.topContribution;
    const combined=[...s.a,...s.b].map(r=>r.cents),smallThreshold=Math.max(T.minSmallCents,Math.round(reportMedian(combined)*.5/T.binRoundCents)*T.binRoundCents);
    const smallA=a.n?s.a.filter(r=>r.cents<smallThreshold).length/a.n:0,smallB=b.n?s.b.filter(r=>r.cents<smallThreshold).length/b.n:0;
    const signal: Array<{kind:string;title:string;observation:string;weight:number}>=[];
    if(frequency||amount)signal.push({kind:'change',title:!b.n?`${s.label}在本期新增`:frequency?`${s.label}的记录频率${rate!>0?'增加':'减少'}`:`${s.label}的已记录金额${delta>0?'增加':'减少'}`,observation:!b.n?'上期没有这组记录，本期新增；尚不能认定长期习惯。':'金额变化同时受次数和平均每笔影响，应结合出现天数理解，不能直接判断商品涨价。',weight:20});
    if(big)signal.push({kind:'big',title:`${s.label}${delta>0?'上涨':'下降'}主要集中在最贵的几笔`,observation:'两期各自最贵的三笔，合计差额达到总金额差额的一半以上。其余支出可能有不同方向，不能推广到每一笔日常消费。',weight:40});
    if(distribution&&amount&&a.mean>b.mean&&a.median<=b.median)signal.push({kind:'distribution',title:`${s.label}平均金额上升，典型单笔没有同步变贵`,observation:'平均每笔上升，中位数却没有上升，说明金额分布内部变化，不能把平均数上升理解为每笔都更贵。',weight:45});
    if(distribution&&amount&&a.mean<b.mean&&a.median>b.median)signal.push({kind:'distribution',title:`${s.label}平均金额下降，但典型单笔金额上升`,observation:'平均每笔下降，中位数却上升，较大付款减少可能掩盖典型付款金额的提高；仍不代表商品单价上涨。',weight:45});
    if(distribution&&Math.abs(smallA-smallB)>=T.shareDelta)signal.push({kind:'small',title:`${s.label}的小额记录占比改变`,observation:'按两期合并金额确定的小额档位，占比发生变化；总额可能掩盖金额分布变化。',weight:15});
    if(['object','mixed','brand'].includes(s.kind)&&a.days-b.days*k>=T.daysDelta)signal.push({kind:'days',title:`${s.label}出现在更多日子里`,observation:'记录分布到更多已观察日期，更接近日常重复出现；是否持续仍需跨周观察。',weight:35});
    let componentFacts:Record<string,ReportFact>={},subject=key;
    if(s.kind==='category'&&(frequency||amount||Math.abs(a.n-b.n*k)>=T.countDelta)){
      const components=[...objectsNow.entries()].filter(([,g])=>['object','mixed'].includes(g.kind)).map(([key,g])=>({key,label:g.label,a:g.records.filter(r=>r.category===s.label),b:(objectsPrev.get(key)?.records??[]).filter(r=>r.category===s.label)})).sort((x,y)=>Math.abs(y.a.length-y.b.length*k)-Math.abs(x.a.length-x.b.length*k));
      const lead=components[0];
      if(lead&&Math.abs(lead.a.length-lead.b.length*k)>=T.countDelta&&Math.abs(lead.a.length-lead.b.length*k)>=Math.abs(a.n-b.n*k)*.5){
        const residual=(a.n-lead.a.length)-(b.n-lead.b.length)*k;
        signal.push({kind:'component',title:!b.n?`${s.label}本期新增，主要来自${lead.label}记录`:`${s.label}笔数变化主要来自${lead.label}记录`,observation:`分类笔数变化中，${lead.label}记录贡献明显；扣除后其余笔数${residual>0?'增加':residual<0?'减少':'不变'}，不能把分类变化泛化成每一种消费都变频繁。`,weight:50});
        componentFacts={component_current_count:fact(`${lead.label}本期笔数（该分类内）`,lead.a.length,'笔'),component_previous_count:fact(`${lead.label}上期笔数（该分类内）`,lead.b.length,'笔'),residual_current_count:fact('本期扣除对象后的笔数',a.n-lead.a.length,'笔'),residual_previous_count:fact('上期扣除对象后的笔数',b.n-lead.b.length,'笔')};
        if(!big&&Math.abs(residual)<1e-9&&total(s.a.filter(r=>!lead.a.some(l=>l.id===r.id)))===total(s.b.filter(r=>!lead.b.some(l=>l.id===r.id)))*k)subject=lead.key;
      }
    }
    const facts={...comparisonFacts(s.a,s.b),...componentFacts,small_threshold:fact('小额档位上界（不含）',smallThreshold/100,'元'),current_small_share:fact('本期小额笔数占比',smallA*100,'%'),previous_small_share:fact('上期小额笔数占比',smallB*100,'%')};
    const ca=group(s.a,r=>r.category),cb=group(s.b,r=>r.category),cs=[...new Set([...ca.keys(),...cb.keys()])];
    const variation=cs.reduce((n,c)=>n+Math.abs((ca.get(c)?.length??0)/Math.max(1,a.n)-(cb.get(c)?.length??0)/Math.max(1,b.n)),0)/2;
    const categoryLimit=s.kind!=='category'&&variation>0?['同一用途的分类分布存在差异，跨分类合并统计；小样本不足以确认稳定的归类变化。']:[];
    if(signal.length){signal.sort((x,y)=>y.weight-x.weight);const main=signal[0];add(subject,'comparison',main.title,main.observation,(main.weight+Math.min(20,(signal.length-1)*8))/65,[...s.a,...s.b],facts,[...limits,...categoryLimit],ranges,signal.slice(1).map(s=>({type:s.kind,title:s.title})),{kind:s.kind,label:s.label,accounting:preferences.scope});}
    if(s.kind!=='category'&&a.n&&b.n&&variation>=T.classificationShare&&variation*Math.min(a.n,b.n)>=T.classificationMinMoved)add(subject,'classification',`${s.label}的分类归属发生变化`,`本期记录在${[...ca.keys()].join('、')}，上期在${[...cb.keys()].join('、')}；两期分类分布有明显变化，需跨分类合并后理解实际消费变化。`,variation,[...s.a,...s.b],{...comparisonFacts(s.a,s.b),classification_variation:fact('分类分布变动幅度',variation*100,'%')},limits);
  }
  if(comparable){
    const changes=cats.map(c=>({c,a:total(aCats.get(c)??[]),b:total(bCats.get(c)??[])*k})).sort((x,y)=>Math.abs(y.a-y.b)-Math.abs(x.a-x.b));
    const rising=changes.find(c=>c.a-c.b>=T.amountDeltaCents),falling=changes.find(c=>c.b-c.a>=T.amountDeltaCents);
    if(rising&&falling&&Math.abs(total(current)-total(previous)*k)<=Math.max(total(previous)*k*T.shareDelta,T.amountDeltaCents))add('structure','structure','总额相近，内部支出重心却在变化',`${rising.c}增加与${falling.c}减少在金额上相互抵消。总额稳定掩盖了分类构成变化，不能据此证明两种消费存在资金转移关系。`,.9,[...current,...previous],{increase:fact(`${rising.c}增加金额`,(rising.a-rising.b)/100,'元'),decrease:fact(`${falling.c}减少金额`,(falling.b-falling.a)/100,'元'),...comparisonFacts(current,previous)},[...limits,'金额抵消不等于消费替代或因果关系。']);
    const entropy=(g:Map<string,LedgerRecord[]>,n:number)=>cats.length<=1||!n?0:-[...g.values()].reduce((s,r)=>{const p=r.length/n;return s+p*Math.log(p);},0)/Math.log(cats.length);
    const hA=entropy(aCats,current.length),hB=entropy(bCats,previous.length),shares=cats.map(c=>({c,a:(aCats.get(c)?.length??0)/Math.max(1,current.length),b:(bCats.get(c)?.length??0)/Math.max(1,previous.length),am:total(aCats.get(c)??[])/Math.max(1,total(current)),bm:total(bCats.get(c)??[])/Math.max(1,total(previous))})).sort((x,y)=>Math.max(Math.abs(y.a-y.b),Math.abs(y.am-y.bm))-Math.max(Math.abs(x.a-x.b),Math.abs(x.am-x.bm)));
    if(current.length>=T.distributionMin&&previous.length>=T.distributionMin&&shares[0]){const lead=shares[0],diff=Math.max(Math.abs(lead.a-lead.b),Math.abs(lead.am-lead.bm));if(diff>=T.shareDelta||Math.abs(hA-hB)>=T.shareDelta)add('mix','mix','消费构成改变，笔数与金额占比值得一起看',`${lead.c}的笔数或金额占比改变。占比变化可能来自该类增加，也可能来自其他类减少，不能只看一个比例判断花得更多。`,Math.min(1,diff*3),[...current,...previous],{...comparisonFacts(current,previous),current_share:fact(`${lead.c}本期笔数占比`,lead.a*100,'%'),previous_share:fact(`${lead.c}上期笔数占比`,lead.b*100,'%'),current_amount_share:fact(`${lead.c}本期金额占比`,lead.am*100,'%'),previous_amount_share:fact(`${lead.c}上期金额占比`,lead.bm*100,'%'),category_overlap:fact('类别集合重合度',cats.length?[...aCats.keys()].filter(c=>bCats.has(c)).length/cats.length*100:0,'%'),current_diversity:fact('本期类别分散程度',hA*100,'%'),previous_diversity:fact('上期类别分散程度',hB*100,'%')},[...limits,'分类调整会影响消费构成，类别熵使用两期相同类别集合。']);}
  }
  // Verify each calendar week directly, independent of whether its enclosing salary cycle is complete.
  const weekRanges:DateRange[]=[];for(let d=addDays(allRange.start,(7-weekday(allRange.start))%7);addDays(d,6)<=effectiveRange.end;d=addDays(d,7))weekRanges.push({start:d,end:addDays(d,6)});
  const runs:DateRange[][]=[];let run:DateRange[]=[];
  if(!undatedPaths.length)for(const w of weekRanges){if(cover(w).complete)run.push(w);else{if(run.length)runs.push(run);run=[];}}if(run.length)runs.push(run);
  const recent=[...runs].reverse().find(r=>r.length>=T.repeatWeeks),lag=recent&&weekRanges.length?reportDays({start:recent[recent.length-1].end,end:weekRanges[weekRanges.length-1].end})-1:0;
  const weeks=recent&&lag<=T.temporalMaxLagDays?recent.slice(-T.temporalMaxWeeks):[];
  const temporalRange=weeks.length?{start:weeks[0].start,end:weeks[weeks.length-1].end}:effectiveRange,temporal=weeks.length?selected(temporalRange):[],temporalRanges=[{label:'连续完整周',range:temporalRange}];
  snapshot.temporalRange=weeks.length?temporalRange:undefined;snapshot.temporalLagDays=lag;
  const timeLimits=[...limits.filter(t=>!t.includes('上期按')&&!t.includes('本期缺')),...(lag?[`最近${lag/7}周账本不完整，按截至${temporalRange.end}的连续完整周分析。`]:[])];
  const minDiff=(a:number,b:number)=>Math.max(T.trendAbsolute,T.trendRelative*Math.max(a,b,1));
  for(const [key,g] of objectsAll){
    if(!weeks.length)break;
    const records=unique(g.records.filter(r=>r.date>=temporalRange.start&&r.date<=temporalRange.end)),counts=weeks.map(w=>records.filter(r=>r.date>=w.start&&r.date<=w.end).length),last=weeks.slice(-T.repeatWeeks),lastRecords=records.filter(r=>r.date>=last[0].start);
    const ordinary=['object:早餐','object:午餐','object:晚餐'].includes(key),changed=snapshot.findings.some(f=>f.subject===key);
    if(last.length===T.repeatWeeks&&counts.slice(-T.repeatWeeks).filter(n=>n>0).length>=T.repeatActiveWeeks&&lastRecords.length>=T.repeatCount&&objectsNow.has(key)&&(!ordinary||changed)){
      const dd=[...new Set(lastRecords.map(r=>r.date))].sort(),intervals=dd.slice(1).map((d,i)=>reportDays({start:dd[i],end:d})-1),lastCounts=counts.slice(-T.repeatWeeks);
      add(key,'repeat',`${g.label}已经连续多周出现`,'这组记录分散在多个完整周，更接近日常重复出现，而非一次集中购买；是否长期保持仍需继续观察。',Math.min(1,lastRecords.length/(T.repeatCount*2)),lastRecords,{count:fact('最近四周笔数',lastRecords.length,'笔'),days:fact('出现天数',dd.length,'天'),interval:fact('相邻消费日间隔中位数',reportMedian(intervals),'天'),concentration:fact('最多一周笔数占比',Math.max(...lastCounts)/lastRecords.length*100,'%')},timeLimits,[{label:'最近四个完整周',range:{start:last[0].start,end:last[last.length-1].end}}]);
    }
    if(weeks.length<T.trendMinWeeks||records.length<T.temporalMinCount)continue;
    const slope=theilSen(counts),early=reportMedian(counts.slice(0,T.trendSegmentWeeks)),late=reportMedian(counts.slice(-T.trendSegmentWeeks)),difference=late-early;
    if(Math.abs(difference)>=minDiff(early,late)&&Math.abs(slope)*(weeks.length-1)>=minDiff(early,late)&&slope*difference>0)add(key,'trend',`${g.label}的周频次呈持续${slope>0?'上升':'下降'}`,'前后四周中位数和稳健趋势方向一致，提示记录频率持续变化。只能定位到周，不能据此确定生活原因。',Math.min(1,Math.abs(difference)/Math.max(1,early,late)),records,{early:fact('前四周周笔数中位数',early,'笔'),late:fact('后四周周笔数中位数',late,'笔'),slope:fact('稳健趋势每周笔数变化',slope,'笔')},timeLimits,temporalRanges);
    let split:{index:number;before:number;after:number;difference:number}|undefined;
    for(let i=T.trendSegmentWeeks;i<=counts.length-T.trendSegmentWeeks;i++){const before=reportMedian(counts.slice(0,i)),after=reportMedian(counts.slice(i)),difference=Math.abs(after-before);if(difference>=minDiff(before,after)&&(!split||difference>split.difference))split={index:i,before,after,difference};}
    if(split)add(key,'level',`${g.label}的频率在某一周前后改变`,`以${weeks[split.index].start}开始的周附近为候选分界，前后周笔数中位数不同；不能精确到某一天或断言原因。`,Math.min(1,split.difference/Math.max(1,split.before,split.after)),records,{before:fact('分界前周笔数中位数',split.before,'笔'),after:fact('分界后周笔数中位数',split.after,'笔')},[...timeLimits,'分界来自探索性扫描，不代表统计显著性。'],temporalRanges);
  }
  if(weeks.length>=T.trendMinWeeks&&temporal.length>=T.temporalMinCount){
    const byDate=group(temporal,r=>r.date),vectors=weeks.map(w=>Array.from({length:7},(_,day)=>total(byDate.get(addDays(w.start,day))??[]))),means=Array.from({length:7},(_,d)=>vectors.reduce((s,v)=>s+v[d],0)/weeks.length),work=means.slice(0,5).reduce((a,b)=>a+b,0)/5,wknd=(means[5]+means[6])/2;
    const weekdayFacts:Record<string,ReportFact>={};for(let d=0;d<7;d++){const label=['周一','周二','周三','周四','周五','周六','周日'][d];weekdayFacts[`weekday_amount_${d}`]=fact(`${label}日均金额`,means[d]/100,'元');weekdayFacts[`weekday_count_${d}`]=fact(`${label}日均笔数`,vectors.reduce((s,_v,i)=>s+(byDate.get(addDays(weeks[i].start,d))?.length??0),0)/weeks.length,'笔');}
    const rhythm:Array<{title:string;ratio:number|null;peak:number;reference:number;repeat:number;observation:string}>=[];
    const weekendRepeat=vectors.filter(v=>(v[5]+v[6])/2>=v.slice(0,5).reduce((s,n)=>s+n,0)/5*T.rhythmRatio&&v[5]+v[6]>0).length/weeks.length,workRepeat=vectors.filter(v=>v.slice(0,5).reduce((s,n)=>s+n,0)/5>=(v[5]+v[6])/2*T.rhythmRatio&&v.slice(0,5).some(n=>n>0)).length/weeks.length;
    if(wknd>0&&(!work||wknd/work>=T.rhythmRatio)&&weekendRepeat>=T.rhythmPersistence)rhythm.push({title:'周末支出高峰在多个星期重复出现',ratio:work?wknd/work:null,peak:wknd,reference:work,repeat:weekendRepeat,observation:'按每天标准化后，周末支出更高，并在多数完整周重复，提示稳定的星期节奏。'});
    if(work>0&&(!wknd||work/wknd>=T.rhythmRatio)&&workRepeat>=T.rhythmPersistence)rhythm.push({title:'工作日支出明显高于周末',ratio:wknd?work/wknd:null,peak:work,reference:wknd,repeat:workRepeat,observation:'按每天标准化后，工作日支出更高，并在多数完整周重复，不能直接断言通勤或工作原因。'});
    for(let d=0;d<7;d++){const other=reportMedian(means.filter((_n,i)=>i!==d)),repeat=vectors.filter(v=>v[d]>0&&v.filter(n=>n>v[d]).length<2).length/weeks.length;if(means[d]>0&&(!other||means[d]/other>=T.rhythmDayRatio)&&repeat>=T.rhythmPersistence)rhythm.push({title:`每${['周一','周二','周三','周四','周五','周六','周日'][d]}是重复的支出高峰`,ratio:other?means[d]/other:null,peak:means[d],reference:other,repeat,observation:'这一星期日在多数完整周处于最高或次高水平，不是单次大额付款就能解释的节奏。'});}
    rhythm.sort((a,b)=>b.repeat-a.repeat||(b.ratio??Infinity)-(a.ratio??Infinity));const best=rhythm[0],similarities=vectors.slice(1).map((v,i)=>cosine(vectors[i],v));
    if(best)add('rhythm','rhythm',best.title,best.observation,Math.min(1,best.repeat),temporal,{...weekdayFacts,...(best.ratio!==null?{ratio:fact('高峰与对照日均金额之比',best.ratio,'倍')}:{}),peak_daily:fact('高峰日均金额',best.peak/100,'元'),reference_daily:fact('对照日均金额',best.reference/100,'元'),repeat_share:fact('重复高峰的周占比',best.repeat*100,'%'),persistence:fact('相邻周分布相似度中位数',reportMedian(similarities)*100,'%')},[...timeLimits,'日均金额与重复周同时核对；相似度不代表预算合理或生活原因。'],temporalRanges);
  }
  if(weeks.length>=T.associationMinWeeks){
    const objects=objectGroups(temporal),frequent=[...objects.entries()].filter(([,g])=>g.kind==='object'&&new Set(g.records.map(r=>r.date)).size>=T.associationMinDays).sort((a,b)=>b[1].records.length-a[1].records.length||a[0].localeCompare(b[0])).slice(0,T.associationMaxObjects),dd=dates(temporalRange);
    const meal=(key:string)=>['object:早餐','object:午餐','object:晚餐'].includes(key);
    let pairs=0;for(let i=0;i<frequent.length;i++)for(let j=i+1;j<frequent.length;j++)if(!(meal(frequent[i][0])&&meal(frequent[j][0])))pairs++;
    for(let i=0;i<frequent.length;i++)for(let j=i+1;j<frequent.length;j++){
      const [aKey,a]=frequent[i],[bKey,b]=frequent[j];if([aKey,bKey].every(k=>['object:早餐','object:午餐','object:晚餐'].includes(k)))continue;
      const ar=group(a.records,r=>r.date),br=group(b.records,r=>r.date),ad=new Set(ar.keys()),bd=new Set(br.keys()),together=[...ad].filter(d=>bd.has(d)&&ar.get(d)!.some(ra=>br.get(d)!.some(rb=>ra.id!==rb.id)));
      if(together.length<T.associationTogether)continue;
      const direction=(aa:Set<string>,bb:Set<string>)=>{let expected=0;for(let day=0;day<7;day++){const exposed=[...aa].filter(d=>weekday(d)===day).length,controls=dd.filter(d=>weekday(d)===day&&!aa.has(d));if(exposed&&!controls.length)return null;if(exposed)expected+=exposed*controls.filter(d=>bb.has(d)).length/controls.length;}return expected>0?{expected,lift:together.length/expected}:null;};
      const forward=direction(ad,bd),reverse=direction(bd,ad);const chosen=forward&&(!reverse||forward.lift>=reverse.lift)?{...forward,a:a.label,b:b.label}:reverse?{...reverse,a:b.label,b:a.label}:null;
      if(!chosen||chosen.lift<T.associationLift)continue;
      const test=stratifiedAssociationTail(Array.from({length:7},(_,d)=>({days:weeks.length,a:[...ad].filter(day=>weekday(day)===d).length,b:[...bd].filter(day=>weekday(day)===d).length})),together.length);
      if(test.p>=T.associationAlpha/Math.max(1,pairs))continue;
      add([aKey,bKey].sort().join('+'),'association',`${chosen.a}与${chosen.b}经常在同一天出现`,`在有${chosen.a}记录的日期，${chosen.b}更常出现；按星期对照并控制比较对数后仍有线索。只描述同日关联，不代表先后、触发或因果。`,Math.min(1,together.length/(T.associationTogether*2)),[...a.records,...b.records],{together:fact('不同记录共同出现天数',together.length,'天'),lift:fact('星期匹配对照后的比例倍数',chosen.lift,'倍'),expected_together:fact('星期匹配对照预计共同出现天数',chosen.expected,'天'),independent_expected:fact('固定星期频率下预计共同出现天数',test.expected,'天'),tested_pairs:fact('实际比较对数',pairs,'对'),adjusted_p:fact('探索检验校正尾概率',Math.min(1,test.p*pairs)*100,'%')},[...timeLimits,'按星期分层的固定频率精确尾概率作探索筛选；连续日期依赖和未记录情境仍可能影响关联，不是可信概率。'],temporalRanges);
    }
  }
  // History uses complete salary periods only, not partially observed periods or unknown days.
  if(coverage[0].complete&&snapshot.historicalRanges.length>=T.historyPeriods)for(const [key,s] of subjects){
    if(!['category','object'].includes(s.kind)||s.a.length<T.minSubjectCount)continue;
    const historyRows=snapshot.historicalRanges.map(range=>selected(range).filter(r=>s.kind==='category'?r.category===s.label:identifyReportObjects(r.note,rules).some(o=>o.key===key)));
    const values=historyRows.map((rs,i)=>total(rs)/reportDays(snapshot.historicalRanges[i])),median=reportMedian(values),mad=reportMedian(values.map(v=>Math.abs(v-median))),daily=total(s.a)/Math.max(1,observed[0]),diff=daily-median,margin=Math.max(T.historyMadMultiplier*T.historyScale*mad,T.amountDeltaCents/Math.max(1,observed[0]));
    if(Math.abs(diff)>margin)add(key,'history',`${s.label}明显${diff>0?'高':'低'}于近${values.length}期记录常态`,'按完整历史周期的日均记录金额比较，本期偏离历史中位数；历史较少或波动很小时仍采用绝对影响门槛，不把偏离解释为原因或失控。',Math.min(1,Math.abs(diff)/Math.max(1,margin*2)),[...s.a,...historyRows.flat()],{current_daily:fact('本期每观察日金额',daily/100,'元'),history_median:fact('历史日均金额中位数',median/100,'元'),history_mad:fact('历史日均金额绝对偏差中位数',mad/100,'元'),periods_used:fact('完整历史周期数',values.length,'期')},limits,[ranges[0],...snapshot.historicalRanges.map(r=>({label:'完整历史周期',range:r}))]);
  }
  for(const c of cats){const historical=all.filter(r=>r.category===c&&snapshot.historicalRanges.some(h=>r.date>=h.start&&r.date<=h.end));if(historical.length<T.outlierHistoryCount)continue;const p90=quantile(historical.map(r=>r.cents),.9),threshold=Math.max(T.outlierP90Multiplier*p90,T.outlierFloorCents),r=[...(aCats.get(c)??[])].sort((a,b)=>b.cents-a.cents)[0];if(r&&r.cents>=threshold)add(`category:${c}`,'outlier',`${c}有一笔明显高于历史的付款`,'这笔付款明显高于该分类完整历史期的多数记录。它是可核对的大额线索，不直接判定浪费、异常交易或消费失控。',Math.min(1,r.cents/(threshold*2)),[r,...historical],{outlier_amount:fact('本期单笔金额',r.cents/100,'元'),history_p90:fact('历史单笔金额P90',p90/100,'元'),outlier_share:fact('占本期该分类金额',r.cents/Math.max(1,total(aCats.get(c)??[]))*100,'%')},limits,[ranges[0],...snapshot.historicalRanges.map(range=>({label:'完整历史周期',range}))]);}
  const evidenceById=new Map(snapshot.evidence.map(e=>[e.id,e])),recordSet=(f:ReportFinding)=>new Set(f.evidenceIds.flatMap(id=>evidenceById.get(id)?.recordIds??[]));
  const ordered=snapshot.findings.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)),merged:ReportFinding[]=[],aliases=new Map<string,string>();
  for(const candidate of ordered){
    const ids=recordSet(candidate),existing=merged.find(f=>{
      if(f.subject===candidate.subject||f.subject===aliases.get(candidate.subject))return true;
      const outlier=f.type==='outlier'?f:candidate.type==='outlier'?candidate:undefined,comparison=f.type==='comparison'?f:candidate.type==='comparison'?candidate:undefined;
      if(outlier&&comparison){const outlierEvidence=evidenceById.get(outlier.id),comparisonEvidence=evidenceById.get(comparison.id);if(outlierEvidence&&comparisonEvidence&&(comparisonEvidence.facts.top3_contribution?.value??0)>=T.topContribution*100&&comparisonEvidence.recordIds.includes(outlierEvidence.recordIds[0]))return true;}
      return f.evidenceIds.some(id=>{const type=id.split(':')[0];if(!(FAMILY[type]==='change'&&FAMILY[candidate.type]==='change')&&!(type===candidate.type&&FAMILY[type]==='time'))return false;const other=new Set(evidenceById.get(id)?.recordIds??[]),intersection=[...ids].filter(id=>other.has(id)).length;return intersection/Math.max(1,ids.size+other.size-intersection)>=T.dedupJaccard;});
    });
    if(!existing){merged.push({...candidate,evidenceIds:[...candidate.evidenceIds],limits:[...candidate.limits],signals:[...(candidate.signals??[])]});continue;}
    existing.evidenceIds=[...new Set([...existing.evidenceIds,...candidate.evidenceIds])];existing.limits=[...new Set([...existing.limits,...candidate.limits])];
    const extraSignals=[...(existing.signals??[]),{type:candidate.type,title:candidate.title},...(candidate.signals??[])];
    const oldSubject=existing.subject;
    if(candidate.subject.startsWith('object:')&&!existing.subject.startsWith('object:')) {
      existing.subject=candidate.subject;
      if(existing.type===candidate.type){extraSignals.push({type:existing.type,title:existing.title});existing.id=candidate.id;existing.title=candidate.title;existing.observation=candidate.observation;}
    }
    if(existing.type==='outlier'&&candidate.type==='comparison') {extraSignals.push({type:existing.type,title:existing.title});existing.id=candidate.id;existing.type=candidate.type;existing.subject=candidate.subject;existing.title=candidate.title;existing.observation=candidate.observation;}
    if(oldSubject!==existing.subject){for(const [key,value] of aliases)if(value===oldSubject)aliases.set(key,existing.subject);aliases.set(oldSubject,existing.subject);}
    aliases.set(candidate.subject,existing.subject);
    existing.signals=[...new Map(extraSignals.filter(s=>s.title!==existing.title).map(s=>[s.title,s])).values()];
  }
  // Merging a verified time signal into a comparison does not make that signal disappear.
  const isTime=(f:ReportFinding)=>f.evidenceIds.some(id=>FAMILY[id.split(':')[0]]==='time');
  const hasTime=merged.some(isTime);let changeCount=0;
  snapshot.findings=merged.filter(f=>{if(FAMILY[f.type]==='change'&&hasTime){if(changeCount>=T.maxComparisonFamily)return false;changeCount++;}return true;}).slice(0,T.topFindings);
  if(hasTime&&!snapshot.findings.some(isTime)){const time=merged.find(isTime)!;let base=snapshot.findings.slice(0,T.topFindings-1);if(FAMILY[time.type]==='change'&&base.filter(f=>FAMILY[f.type]==='change').length>=T.maxComparisonFamily){const last=base.map(f=>FAMILY[f.type]).lastIndexOf('change');base=base.filter((_f,i)=>i!==last);}snapshot.findings=[...base,time].sort((a,b)=>b.score-a.score);}
  const used=new Set(['overview',...snapshot.findings.flatMap(f=>f.evidenceIds)]);snapshot.evidence=snapshot.evidence.filter(e=>used.has(e.id));
  snapshot.evidence.forEach(e => { e.readings=evidenceReadings(e,comparable); });
  snapshot.fingerprint=reportHash(JSON.stringify({rule:REPORT_RULE_VERSION,thresholds:T,objectRules:rules.source,preferences,excludedCategories,periods,effectiveRange,previousRange,trimmedDates,stars:preferences.includeStarred?[]:[...starredIds].sort(),files:files.filter(f=>!f.date||(f.date>=allRange.start&&f.date<=periods.range.end)).map(f=>[f.path,f.date,f.frontmatterTotalCents,f.diagnostics,f.records.map(r=>[r.id,r.date,r.time,r.category,r.cents,r.note])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))}));
  return snapshot;
}
