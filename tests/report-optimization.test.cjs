const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../dist/core.cjs'),R=require('../dist/report.cjs'),P=require('../dist/report-presentation.cjs'),S=require('../dist/report-statistics.cjs');
const {ReportPanel}=require('../dist/report-ui.cjs');
const now=new Date(2026,9,4),prefs=R.defaultReportPreferences(now);
function ledgers(start,end,entries=()=>[]){const files=[];for(let d=start;d<=end;d=C.addDays(d,1)){const rs=entries(d);files.push(C.parseLedgerFile(`synthetic/${d}.md`,`---\ndate: ${d}\ntotal: ${rs.reduce((n,r)=>n+r[1],0)/100}\n---\n# 今日消费记录\n${rs.map(r=>`- 12:00｜${r[0]}｜￥${(r[1]/100).toFixed(2)} (${r[2]})`).join('\n')}\n`));}return files;}
const snap=(files,options={},p=prefs,date=now)=>R.buildReportSnapshot(files,p,date,[],[],options);
const regular=()=>ledgers('2026-07-13','2026-10-04',()=>[['饮品',800,'咖啡']]);

test('rule version, threshold values and dictionary changes invalidate snapshots automatically',()=>{
 const f=regular(),s=snap(f);assert.equal(s.ruleVersion,'3');
 assert.notEqual(s.fingerprint,snap(f,{thresholds:{countDelta:7}}).fingerprint);
 assert.notEqual(s.fingerprint,snap(f,{objectRules:'咖啡=咖啡\n打车=打车'}).fingerprint);
});
test('only short trailing gaps in ongoing cycles are trimmed, and previous elapsed days follow cutoff',()=>{
 const f=regular();for(const count of [1,2,3]){const missing=new Set(Array.from({length:count},(_,i)=>C.addDays('2026-10-04',-i))),s=snap(f.filter(r=>!missing.has(r.date)));
 assert.equal(s.trimmedDates.length,count<=2?count:0);assert.equal(s.comparable,count<=2);
 if(count<=2){assert.equal(R.reportDays(s.effectiveRange),20-count);assert.equal(R.reportDays(s.previousRange),20-count);assert.match(P.reportProgress(s),/最近 .* 天未记账/);}
 }
 const c=R.reportCoverage(f.filter(r=>r.date!=='2026-09-20'),{start:'2026-09-15',end:'2026-10-04'});assert.equal(R.trimTrailingGap(c,'2026-10-04',2),null);
 const historical=snap(f.filter(r=>r.date!=='2026-09-14'),{}, {...prefs,offset:1,anchorDate:'2026-08-15'});assert.equal(historical.trimmedDates.length,0);assert.equal(historical.comparable,false);
});
test('one internal missing day is visibly degraded, uses observed days and cannot erase the gap',()=>{
 const f=regular(),s=snap(f.filter(r=>r.date!=='2026-09-20'));assert.equal(s.comparable,true);assert.equal(s.degraded,true);assert.deepEqual(s.observedDays,[19,20]);
 assert.equal(s.overview.facts.current_missing_days.value,1);assert.equal(s.overview.facts.previous_amount_scaled.value,152);
 assert.match(P.reportProgress(s),/部分日期缺失/);assert.ok(s.overview.limits.some(l=>l.includes('不能推断完整周期总额')));
 assert.equal(snap(f.filter(r=>!['2026-09-20','2026-09-21'].includes(r.date))).comparable,false);
 assert.equal(snap(f.filter(r=>r.date!=='2026-09-15')).comparable,false);
});
test('short windows cannot use a one-day gap exceeding the coverage ratio',()=>{
 const p={...prefs,mode:'custom',customRange:{start:'2026-09-15',end:'2026-09-24'}};
 assert.equal(snap(regular().filter(r=>r.date!=='2026-09-20'),{},p).comparable,false);
});
test('31 versus 28 days does not invent growth when daily record rates and amounts are identical',()=>{
 const f=ledgers('2026-02-15','2026-04-14',()=>Array.from({length:3},()=>['饮品',800,'咖啡']));
 const p={...prefs,offset:1,anchorDate:'2026-03-15'},s=snap(f,{},p,new Date(2026,3,16));
 assert.equal(s.overview.facts.current_count.value,93);assert.equal(s.overview.facts.previous_count.value,84);assert.equal(s.overview.facts.previous_count_scaled.value,93);
 assert.equal(s.overview.facts.frequency_contribution.value,0);assert.equal(s.overview.facts.ticket_contribution.value,0);assert.ok(!s.findings.some(f=>f.type==='comparison'));
});
test('complete weeks remain usable despite unrelated missing dates elsewhere in the salary period',()=>{
 const f=regular().filter(r=>r.date!=='2026-07-20'),s=snap(f);
 assert.ok(s.temporalRange.start>'2026-07-20');assert.ok(s.evidence.some(e=>e.id.startsWith('repeat:')));
});
test('a broken latest week falls back only one week and labels the older time window',()=>{
 const f=regular().filter(r=>r.date!=='2026-10-03'),s=snap(f);
 assert.equal(s.temporalRange.end,'2026-09-27');assert.equal(s.temporalLagDays,7);assert.ok(s.evidence.some(e=>e.limits.some(l=>l.includes('最近1周账本不完整'))));
 const old=snap(f.filter(r=>r.date!=='2026-09-26'));assert.equal(old.temporalRange,undefined);
});
test('big decreases and falling means with rising medians retain separate signals and numeric evidence',()=>{
 const f=ledgers('2026-08-15','2026-10-04',d=>[['餐饮',d<'2026-09-15'?(d==='2026-08-20'?60000:1000):1300,'餐食']]);
 const s=snap(f),e=s.evidence.find(e=>e.id.startsWith('comparison:')&&e.facts.top3_contribution);
 assert.ok(e);assert.ok(e.facts.top3_difference.value<0);assert.ok(e.facts.current_mean.value<e.facts.previous_mean.value);assert.ok(e.facts.current_median.value>e.facts.previous_median.value);
 const finding=s.findings.find(f=>f.evidenceIds.includes(e.id));assert.match(finding.title,/典型单笔金额上升/);assert.ok(finding.signals.some(s=>/下降主要/.test(s.title)));
});
test('brand, object and fully overlapping category observations share one report slot',()=>{
 const f=ledgers('2026-08-15','2026-10-04',d=>Number(d.slice(-2))%(d<'2026-09-15'?9:2)===0?[['饮品',800,'瑞幸咖啡']]:[]),s=snap(f);
 assert.equal(s.findings.filter(f=>['object:咖啡','brand:瑞幸','category:饮品'].includes(f.subject)).length,1);
});
test('classification needs repeated movement rather than one differently classified record',()=>{
 const f=ledgers('2026-08-15','2026-10-04',d=>[['饮品',800,'咖啡']]);
 const one=structuredClone(f);one.find(f=>f.date==='2026-09-20').records[0].category='餐饮';assert.ok(!snap(one).evidence.some(e=>e.id.startsWith('classification:')));
 const many=structuredClone(f);many.filter(f=>f.date>='2026-09-15').forEach(f=>f.records[0].category='餐饮');assert.ok(snap(many).evidence.some(e=>e.id.startsWith('classification:')));
});
test('mix can detect changing amount shares despite unchanged category record shares',()=>{
 const f=ledgers('2026-08-15','2026-10-04',d=>[['购物',d<'2026-09-15'?1000:5000,'用品'],['餐饮',d<'2026-09-15'?5000:1000,'餐食']]),s=snap(f);
 const e=s.evidence.find(e=>e.id.startsWith('mix:'));assert.ok(e);assert.equal(e.facts.current_share.value,50);assert.equal(e.facts.previous_share.value,50);assert.ok(Math.abs(e.facts.current_amount_share.value-e.facts.previous_amount_share.value)>10);
});
test('low-frequency sustained increases are eligible; random small fluctuations are not forced into a trend',()=>{
 const start='2026-07-13';const f=ledgers(start,'2026-10-04',d=>{const week=Math.floor((R.reportDays({start,end:d})-1)/7),day=(new Date(d+'T12:00:00').getDay()+6)%7;return day<(week<6?1:4)?[['饮品',800,'咖啡']]:[];});
 const s=snap(f);assert.ok(s.evidence.some(e=>e.id.startsWith('trend:')||e.id.startsWith('level:')));
 assert.ok(!snap(regular()).evidence.some(e=>e.id.startsWith('trend:')||e.id.startsWith('level:')));
});
test('sustained declines to zero remain eligible even when the current cycle has no matching object',()=>{
 const start='2026-07-13',f=ledgers(start,'2026-10-04',d=>{const week=Math.floor((R.reportDays({start,end:d})-1)/7),day=(new Date(d+'T12:00:00').getDay()+6)%7;return day<(week<6?4:0)?[['饮品',800,'咖啡']]:[];}),s=snap(f);
 const trend=s.evidence.find(e=>e.id.startsWith('trend:'));assert.ok(trend);assert.equal(trend.facts.late.value,0);assert.ok(trend.facts.slope.value<0);
 assert.ok(s.findings.some(f=>f.evidenceIds.includes(trend.id)));
});
test('workday and individual weekday peaks require repetition across weeks',()=>{
 for(const mode of ['work','friday']){const f=ledgers('2026-07-13','2026-10-04',d=>{const day=(new Date(d+'T12:00:00').getDay()+6)%7;return [['餐饮',mode==='work'?(day<5?2000:500):(day===4?10000:500),'餐食']];}),s=snap(f);assert.ok(s.findings.some(f=>f.type==='rhythm'&&new RegExp(mode==='work'?'工作日':'周五').test(f.title)));}
});
test('same-row object tags do not form associations and weekday-only shared exposure is controlled',()=>{
 const start='2026-07-13';const f=ledgers(start,'2026-10-04',d=>((R.reportDays({start,end:d})-1)%2===0)?[['饮品',800,'咖啡 早餐']]:[]);
 assert.ok(!snap(f).evidence.some(e=>e.id.startsWith('association:')));
});
test('zero-spending control weekdays permit repeated peaks without fabricated infinite ratios',()=>{
 for(const mode of ['work','sunday']){const f=ledgers('2026-07-13','2026-10-04',d=>{const day=(new Date(d+'T12:00:00').getDay()+6)%7;return (mode==='work'?day<5:day===6)?[['交通',1000,'地铁']]:[];}),s=snap(f),e=s.evidence.find(e=>e.id.startsWith('rhythm:'));assert.ok(e);assert.equal(e.facts.reference_daily.value,0);assert.equal(e.facts.ratio,undefined);assert.ok(Object.values(e.facts).every(f=>Number.isFinite(f.value)));const finding=s.findings.find(f=>f.evidenceIds.includes(e.id));assert.match(P.findingKeyNumbers(finding,[e]),/对照日均 ¥0.00/);}
});
test('associations emit one direction per pair and use distinct rows, matched controls and corrected screening',()=>{
 const start='2026-07-13',f=ledgers(start,'2026-10-04',d=>{const n=R.reportDays({start,end:d})-1;return [...(n%2===0?[['饮品',800,'咖啡']]:[]),...(n%2===0||n%13===0?[['零食',200,'零食']]:[])];}),s=snap(f),e=s.evidence.filter(e=>e.id.startsWith('association:'));
 assert.equal(e.length,1);assert.ok(e[0].facts.lift.value>=2);assert.ok(e[0].facts.expected_together.value>0);assert.ok(e[0].facts.adjusted_p.value<5);
});
test('twelve independently generated object series do not produce spurious associations',()=>{
 let seed=7342;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const rules=Array.from({length:12},(_,i)=>`对象${i}=^item${i}$`).join('\n'),f=ledgers('2026-07-13','2026-10-04',()=>Array.from({length:12},(_,i)=>i).filter(()=>random()<.35).map(i=>['测试',100,`item${i}`]));
 assert.ok(!snap(f,{objectRules:rules}).evidence.some(e=>e.id.startsWith('association:')));
});
test('exact weekday-stratified tails match enumerable distributions and do not invent certainty',()=>{
 const one=S.stratifiedAssociationTail([{days:4,a:2,b:2}],2);assert.ok(Math.abs(one.p-1/6)<1e-12);assert.equal(one.expected,1);
 const two=S.stratifiedAssociationTail([{days:4,a:2,b:2},{days:4,a:2,b:2}],4);assert.ok(Math.abs(two.p-1/36)<1e-12);assert.equal(two.expected,2);
 assert.equal(S.stratifiedAssociationTail([{days:4,a:4,b:4}],4).p,1);
});
test('scores share a bounded scale, related signals merge, and time observations have a reserved slot',()=>{
 const f=ledgers('2026-07-13','2026-10-04',d=>Array.from({length:d<'2026-09-15'?1:4},()=>['饮品',800,'咖啡'])),s=snap(f);
 assert.ok(s.findings.every(f=>f.score>=0&&f.score<=100));assert.ok(s.findings.length<=5);assert.ok(s.findings.some(f=>f.evidenceIds.some(id=>/^(repeat|trend|level|rhythm|association):/.test(id))));
 assert.ok(s.findings.filter(f=>['comparison','classification','structure','mix','history','outlier'].includes(f.type)).length<=3);
 assert.equal(s.findings.filter(f=>f.subject==='object:咖啡').length,1);
});
test('history requires three complete cycles and outlier evidence remains local and deduplicated',()=>{
 const f=ledgers('2026-06-15','2026-10-04',d=>[['交通',d>='2026-09-15'?3000:500,'地铁']]),s=snap(f);assert.equal(s.historicalRanges.length,3);assert.ok(s.evidence.some(e=>e.id.startsWith('history:')));
 assert.ok(!snap(f.filter(f=>f.date>='2026-07-15')).evidence.some(e=>e.id.startsWith('history:')));
 const big=snap(ledgers('2026-06-15','2026-10-04',d=>[['餐饮',d==='2026-09-20'?60000:1000,'餐食']]));assert.ok(big.evidence.some(e=>e.id.startsWith('outlier:')));assert.equal(big.findings.filter(f=>f.evidenceIds.some(id=>id.startsWith('outlier:'))).length,1);
});
test('local report exposes accurate overview and key numbers without an AI request',()=>{
 const s=snap(regular()),r=R.localSpendingReport(s);assert.equal(s.overview.facts.current_amount.value,160);assert.equal(s.overview.facts.current_count.value,20);assert.match(r.summary,/160.00/);assert.ok(r.paragraphs.some(p=>/最近四周.*28/.test(p.text)));assert.ok(s.evidence.some(e=>e.id==='overview'));
});
test('merged candidates keep globally unique evidence IDs and only real local rows',()=>{
 const f=ledgers('2026-07-13','2026-10-04',d=>Array.from({length:d<'2026-09-15'?1:4},()=>['饮品',800,'瑞幸咖啡'])),s=snap(f),ids=new Set(f.flatMap(f=>f.records).map(r=>r.id));
 assert.equal(new Set(s.evidence.map(e=>e.id)).size,s.evidence.length);assert.ok(s.evidence.every(e=>e.recordIds.every(id=>ids.has(id))));
});
test('custom object rules retain model numbers, normalize known travel notes, and flag bad patterns',()=>{
 const parsed=R.parseObjectRules('打车=打车\n@品牌=品牌\n坏=[\n空=.*');assert.equal(parsed.errors.length,2);assert.equal(R.identifyReportObjects('打车回家',parsed)[0].key,'object:打车');
 assert.notEqual(R.identifyReportObjects('型号A13')[0].key,R.identifyReportObjects('型号A14')[0].key);
 assert.notEqual(R.identifyReportObjects('苹果手机')[0].key,R.identifyReportObjects('苹果')[0].key);
 assert.equal(R.identifyReportObjects('品牌',parsed)[0].kind,'brand');assert.equal(R.identifyReportObjects('品牌',parsed).length,1);
});
test('snapshot memoization invalidates for day, repository revision, filters and object rules',()=>{
 const files=regular(),plugin={settings:{reportPreferences:prefs,reportObjectRules:R.DEFAULT_REPORT_OBJECT_RULES,excludedCategories:[],starredRecordIds:[]},repository:{files:new Map(files.map(f=>[f.path,f])),contentRevision:1}};const panel=new ReportPanel(plugin,()=>{},async()=>{});
 const a=panel.snapshot(now);assert.equal(panel.snapshot(now),a);plugin.repository.contentRevision++;assert.notEqual(panel.snapshot(now),a);const b=panel.snapshot(now);plugin.settings.reportObjectRules+='\n兴趣=书籍';assert.notEqual(panel.snapshot(now),b);const c=panel.snapshot(now);plugin.settings.reportPreferences={...prefs,category:'其他'};assert.notEqual(panel.snapshot(now),c);assert.notEqual(panel.snapshot(new Date(2026,9,5)),panel.snapshot(now));
});
