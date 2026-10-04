const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../dist/core.cjs'),R=require('../dist/report.cjs'),AI=require('../dist/report-ai.cjs');
const {ReportEvidenceModal,renderReportArticle}=require('../dist/report-ui.cjs');
const now=new Date(2026,9,4),prefs=R.defaultReportPreferences(now);
function ledgers(entries){const files=[];for(let d='2026-08-15';d<='2026-10-04';d=C.addDays(d,1)){const rs=entries(d);files.push(C.parseLedgerFile(`synthetic/${d}.md`,`---\ndate: ${d}\ntotal: ${rs.reduce((s,r)=>s+r[1],0)/100}\n---\n# 今日消费记录\n${rs.map(r=>`- 12:00｜${r[0]}｜￥${(r[1]/100).toFixed(2)} (${r[2]})`).join('\n')}\n`));}return files;}
const snap=(files,p=prefs,date=now)=>R.buildReportSnapshot(files,p,date,[],[]);
const pair=(a,b)=>ledgers(d=>d==='2026-09-15'?a:d==='2026-08-15'?b:[]);
const rows=values=>values.map(v=>['购物',v,'测试用途']);
function misleadingMedian(){return snap(pair(rows([...Array(10).fill(400),...Array(10).fill(1600),40000]),rows([...Array(10).fill(500),...Array(10).fill(1500),10000])));}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('rising medians retain contradictory large-payment and remainder facts in whole-ledger evidence',()=>{
 const s=misleadingMedian(),f=s.overview.facts;assert.equal(f.current_count.value,21);assert.equal(f.previous_count.value,21);
 assert.ok(f.current_median.value>f.previous_median.value);assert.ok(f.current_mean.value>f.previous_mean.value);
 assert.ok(f.top3_contribution.value>100);assert.ok(f.remaining_difference.value<0);
 near(f.top3_difference.value+f.remaining_difference.value,f.amount_difference.value);
 assert.ok(s.overview.readings.counter.some(c=>c.text.includes('不能排除少数大额')));
 assert.ok(s.overview.readings.counter.some(c=>c.text.includes('存在抵消')));
 assert.ok(s.overview.readings.counter.some(c=>c.text.includes('并非一致移动')));
});
test('base evidence is supplied without candidate thresholds or any finding',()=>{
 const s=snap(pair(rows([750,850]),rows([700,800])));assert.equal(s.findings.length,0);
 assert.ok(s.overview.facts.top3_current_amount);assert.ok(s.overview.facts.current_p25);
 assert.ok(Object.keys(s.overview.facts).some(k=>k.startsWith('current_bin_')));
 assert.equal(s.overview.facts.remaining_current_n.value,0);assert.equal(s.overview.facts.top3_current_n.value,2);
});
test('bins exhaust records and both periods use identical amount intervals',()=>{
 const s=misleadingMedian(),f=s.overview.facts;
 for(const side of ['current','previous'])assert.equal(Object.entries(f).filter(([k])=>new RegExp(`^${side}_bin_\\d+$`).test(k)).reduce((s,[,v])=>s+v.value,0),21);
 const bins=Object.keys(f).filter(k=>/^current_bin_\d+$/.test(k));bins.forEach(k=>assert.equal(f[k].label.replace('本期',''),f[k.replace('current','previous')].label.replace('上期','')));
});
test('zero net changes omit ratio instead of inventing a zero or infinite contribution',()=>{
 const s=snap(pair(rows([1000,1000,1000,1000,30000]),rows([4000,4000,4000,4000,18000]))),f=s.overview.facts;
 near(f.amount_difference.value,0);assert.equal(f.top3_contribution,undefined);
 assert.ok(f.top3_difference.value>0);assert.ok(f.remaining_difference.value<0);assert.ok(Object.values(f).every(v=>Number.isFinite(v.value)));
});
test('signed ratios can be negative and both amount directions are retained',()=>{
 const s=snap(pair(rows([5000,5000,5000,5000,10000]),rows([1000,1000,1000,1000,20000]))),f=s.overview.facts;
 assert.ok(f.amount_difference.value>0);assert.ok(f.top3_difference.value<0);assert.ok(f.top3_contribution.value<0);
 const reverse=snap(pair(rows([1000,1000,1000,1000,20000]),rows([5000,5000,5000,5000,10000])));assert.ok(reverse.overview.facts.amount_difference.value<0);
});
test('complete classification deltas add up to overall net change and include new and ceased categories',()=>{
 const s=snap(pair([['新用途',30000,'新增'],['小类',100,'小类'],['餐饮',2000,'餐食']],[['交通',3000,'出行'],['小类',100,'小类'],['餐饮',1000,'餐食']])),cs=s.overview.categories;
 assert.equal(cs.length,4);assert.equal(cs.find(c=>c.label==='新用途').status,'new');assert.equal(cs.find(c=>c.label==='交通').status,'ceased');
 near(cs.reduce((n,c)=>n+c.current,0),s.overview.facts.current_amount.value);near(cs.reduce((n,c)=>n+c.previous,0),s.overview.facts.previous_amount.value);near(cs.reduce((n,c)=>n+c.difference,0),s.overview.facts.amount_difference.value);
 assert.ok(s.overview.readings.counter.some(c=>c.text.includes('分类金额有增有减')));assert.ok(s.overview.readings.counter.some(c=>c.text.includes('新增支出')));
});
test('missing data keeps raw amounts but does not supply comparative conclusions or new-category status',()=>{
 const files=pair(rows([50000]),rows([1000])).filter(f=>!['2026-09-20','2026-09-21'].includes(f.date)),s=snap(files),f=s.overview.facts;
 assert.equal(s.comparable,false);assert.equal(f.top3_difference,undefined);assert.equal(f.top3_contribution,undefined);assert.equal(f.ticket_contribution,undefined);
 assert.ok(s.overview.categories.every(c=>c.status==='unknown'&&c.difference===undefined));assert.equal(s.overview.readings.supporting.length,0);
});
test('empty periods have zero totals without fabricated mean, median or quantiles',()=>{
 const s=snap(pair([],[])),f=s.overview.facts;assert.equal(f.current_amount.value,0);assert.equal(f.current_mean,undefined);assert.equal(f.current_median,undefined);assert.equal(f.current_p25,undefined);assert.equal(f.top3_contribution,undefined);
 const newlyRecorded=snap(pair(rows([1000]),[]));assert.equal(newlyRecorded.overview.facts.previous_mean,undefined);assert.equal(newlyRecorded.overview.facts.ticket_contribution,undefined);
});
test('31 versus 28 days uses the same baseline scale in top, remainder, bins and categories',()=>{
 const files=[];for(let d='2026-02-15';d<='2026-04-14';d=C.addDays(d,1))files.push(C.parseLedgerFile(`synthetic/${d}.md`,`---\ndate: ${d}\ntotal: 6\n---\n# 今日消费记录\n- 12:00｜购物｜￥6 (用品)\n`));
 const s=snap(files,{...prefs,offset:1,anchorDate:'2026-03-15'},new Date(2026,3,16)),f=s.overview.facts;
 near(f.amount_difference.value,0);near(f.top3_difference.value+f.remaining_difference.value,0);assert.equal(f.top3_contribution,undefined);
 near(f.top3_previous_scaled.value,18*31/28);near(s.overview.categories[0].difference,0);
 assert.ok(Object.keys(f).some(k=>/^previous_bin_\d+_scaled$/.test(k)));
});
test('filters apply to the scope, all statistics and categories; no hidden excluded totals leak',()=>{
 const files=pair([['餐饮',1000,'午饭'],['购物',99900,'商品']],[['餐饮',500,'午饭'],['购物',99800,'商品']]);
 const s=snap(files,{...prefs,category:'餐饮',keyword:'午饭'});assert.equal(s.overview.facts.current_amount.value,10);assert.deepEqual(s.overview.categories.map(c=>c.label),['餐饮']);assert.equal(s.overview.facts.top3_current_amount.value,10);
 assert.ok(s.evidence.every(e=>e.scope?.accounting==='consumption'));
});
test('AI receives whole-ledger counterevidence and scope without raw rows, paths or extra sample budgets',()=>{
 const s=misleadingMedian(),input=JSON.parse(AI.reportAiInput(s)),e=input.evidence_catalog.find(e=>e.id==='overview');
 assert.equal(e.scope.kind,'all');assert.ok(e.counter.some(c=>c.text.includes('不能排除少数大额')));assert.ok(e.category_changes.length);
 assert.equal(input.numeric_facts['overview.top3_contribution'].value,s.overview.facts.top3_contribution.value);
 assert.ok(input.samples.every(g=>g.untrusted_transaction_samples.length<=5));assert.ok(!JSON.stringify(input).includes('synthetic/'));assert.ok(!JSON.stringify(input).includes('recordIds'));
 for(const evidence of s.evidence)for(const reading of [...evidence.readings.supporting,...evidence.readings.counter])assert.ok(reading.factKeys.every(k=>k in evidence.facts));
});
test('finding IDs never silently become paragraph citations and incorrect prose is still retained',()=>{
 const s=misleadingMedian(),text='并非少数付款拉高，每一笔都变贵99999块。',r=AI.parseSpendingReport(JSON.stringify({paragraphs:[{text,finding_ids:[s.findings[0].id]}]}),s);
 assert.equal(r.paragraphs[0].text,text);assert.deepEqual(r.paragraphs[0].evidenceIds,[]);assert.deepEqual(r.paragraphs[0].findingIds,[s.findings[0].id]);
});
test('mock Chat Completions transport receives both sides and never blocks an unsupported narrative',async()=>{
 const s=misleadingMedian();let input;
 global.__ledgerTestRequest=request=>{input=JSON.parse(JSON.parse(request.body).messages[1].content);return {status:200,json:{choices:[{message:{content:JSON.stringify({paragraphs:[{text:'每一笔都变贵了。',evidence_ids:['overview']}]})}}]}};};
 try{const r=await AI.requestSpendingReport({endpoint:'https://example.test/v1',model:'mock',apiKey:''},s);assert.equal(r.paragraphs[0].text,'每一笔都变贵了。');assert.ok(input.evidence_catalog.find(e=>e.id==='overview').counter.some(c=>c.text.includes('不能排除少数大额')));assert.ok(input.numeric_facts['overview.remaining_difference']);}
 finally{delete global.__ledgerTestRequest;}
});

class Element{
 constructor(tag='div',o={}){this.tag=tag;this.textContent=o.text??'';this.children=[];this.listeners={};this.classes=new Set((o.cls??'').split(' '));this.classList={add:c=>this.classes.add(c)};}
 createEl(tag,o={}){const e=new Element(tag,o);this.children.push(e);return e;}createDiv(o){return this.createEl('div',o);}createSpan(o){return this.createEl('span',o);}addClass(c){this.classes.add(c);}addEventListener(k,f){this.listeners[k]=f;}empty(){this.children=[];}all(){return[this,...this.children.flatMap(e=>e.all())];}
}
test('citations show actual scope and ignore conflicting finding hints without changing prose',()=>{
 const s=misleadingMedian(),r=AI.parseSpendingReport(JSON.stringify({paragraphs:[{text:'全部付款都涨了。',finding_ids:[s.findings[0].id],evidence_ids:['overview','unknown']}]}),s),root=new Element();let clicked;
 renderReportArticle(root,r,s,ids=>clicked=ids);const section=root.all().find(e=>e.tag==='section');assert.ok(section.all().some(e=>e.textContent.includes('引用对象：全部筛选后支出')));assert.ok(section.all().some(e=>e.textContent.includes('部分引用未对应')));
 section.all().find(e=>e.classes.has('ledger-report-citation')).listeners.click();assert.deepEqual(clicked,['overview']);assert.equal(r.paragraphs[0].text,'全部付款都涨了。');
});
test('uncited paragraphs label independent local analysis instead of manufacturing a proof',()=>{
 const s=misleadingMedian(),r=AI.parseSpendingReport('完整保留的普通报告。',s),root=new Element();renderReportArticle(root,r,s,()=>{});
 const section=root.all().find(e=>e.tag==='section');assert.ok(section.all().some(e=>e.textContent.includes('本段未指定有效证据引用')));assert.ok(!section.all().some(e=>e.classes.has('ledger-report-citation')));
 assert.ok(root.all().some(e=>e.textContent.includes('不自动作为未指定引用段落的证明')));
});
test('overview popup groups all metrics and displays both interpretations, categories and source records',()=>{
 const s=misleadingMedian(),modal=Object.create(ReportEvidenceModal.prototype);modal.snapshot=s;modal.evidenceIds=['overview'];modal.contentEl=new Element();modal.setTitle=()=>{};modal.close=()=>{};modal.openRecord=async()=>{};modal.onOpen();
 const all=modal.contentEl.all();assert.ok(all.some(e=>e.textContent.includes('分析对象：全部筛选后支出')));assert.ok(all.some(e=>e.textContent==='需要同时考虑'));assert.ok(all.some(e=>e.textContent==='最贵几笔与其余付款'));
 assert.equal(all.filter(e=>e.tag==='dt').length,Object.keys(s.overview.facts).length+3*s.overview.categories.length);
 assert.ok(all.some(e=>e.tag==='details'&&e.open===true));assert.ok(all.some(e=>e.classes.has('ledger-report-record')));
});
