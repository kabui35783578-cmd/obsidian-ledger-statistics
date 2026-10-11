const test = require('node:test');
const assert = require('node:assert/strict');
const { LedgerStatisticsView } = require('../dist/view.cjs');

class Element {
  constructor(tag='div', options={}, log=[]) {
    this.tag=tag;this.children=[];this.listeners={};this.attributes={...options.attr};this.classes=new Set((options.cls??'').split(' '));this.log=log;this.height=220;
    this.style={writes:[],setProperty:(name,value)=>this.style.writes.push([name,value])};
    this.classList={toggle:(name,enabled)=>{log.push('toggle');enabled?this.classes.add(name):this.classes.delete(name);}};
  }
  get scrollHeight(){this.log.push('measure');return this.height;}
  createEl(tag,options){const node=new Element(tag,options,this.log);this.children.push(node);return node;}
  createDiv(options){return this.createEl('div',options);}
  createSpan(options){return this.createEl('span',options);}
  setAttribute(name,value){this.attributes[name]=value;}
  toggleAttribute(name,enabled){enabled?this.attributes[name]='':delete this.attributes[name];}
  addEventListener(type,callback){this.listeners[type]=callback;}
  all(){return [this,...this.children.flatMap(node=>node.all())];}
}

for(const tab of ['overview','calendar']) test(`${tab} filter toggle measures before mutation and avoids repeated height writes`,()=>{
  const Original=global.ResizeObserver;let resize;
  global.ResizeObserver=class {constructor(callback){resize=callback;}observe(){}disconnect(){}};
  try {
    const view=new LedgerStatisticsView({}, {settings:{defaultView:tab,defaultDatePreset:'month',excludedCategories:[]},repository:{files:new Map()}});
    view.filtersExpanded=false;view.render=()=>assert.fail('Toggling filters must not rebuild the page');
    const root=new Element();view.renderToolbar(root);
    const find=cls=>root.all().find(node=>node.classes.has(cls));
    const summary=find('ledger-filter-summary'),panel=find('ledger-filter-panel'),content=find('ledger-filter-content'),toolbar=find('ledger-toolbar');
    const originalChildren=root.all();root.log.length=0;
    summary.listeners.click();
    assert.deepEqual(root.log,['measure','toggle']);assert.equal(summary.attributes['aria-expanded'],'true');assert.ok(!('inert' in content.attributes));
    for(let i=0;i<20;i++)summary.listeners.click();
    assert.equal(content.style.writes.length,1,'Unchanged toolbar height must not invalidate styles again');
    assert.deepEqual(root.all(),originalChildren);assert.ok(panel.classes.has('is-open'));
    toolbar.height=260;resize();resize();
    assert.deepEqual(content.style.writes,[['--ledger-filter-height','220px'],['--ledger-filter-height','260px']]);
    summary.listeners.click();assert.equal(summary.attributes['aria-expanded'],'false');assert.ok('inert' in content.attributes);
    toolbar.height=300;resize();assert.equal(content.style.writes.length,2);
    root.log.length=0;summary.listeners.click();assert.equal(root.log[0],'measure');assert.equal(content.style.writes.at(-1)[1],'300px');
  } finally {global.ResizeObserver=Original;}
});
