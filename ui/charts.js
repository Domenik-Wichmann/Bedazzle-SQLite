'use strict';
const chartTypes={bar:'Column',horizontal:'Horizontal bar',stacked:'Stacked column',line:'Line',smooth:'Smooth line',area:'Area','stacked-area':'Stacked area',pie:'Pie',donut:'Donut',rose:'Rose',scatter:'Scatter',histogram:'Histogram',boxplot:'Box plot',heatmap:'Heatmap',radar:'Radar',treemap:'Treemap',funnel:'Funnel'};
const chartPalettes={jewel:['#7765da','#23aaa3','#e6a243','#de668f','#4c8ed9','#8bb953','#ae77bd','#db7853'],ocean:['#1565c0','#0097a7','#26a69a','#5c6bc0','#42a5f5','#80cbc4'],sunset:['#d85b67','#ee9251','#eab94d','#b46fa5','#7c78c8'],forest:['#218570','#69a65c','#abb956','#368eaa','#b6905d']};
const chartStudio={source:null,info:null,id:null,preview:null,chart:null,cards:[],dirty:false};
const csAppearance={legend:true,legendPosition:'bottom',grid:true,tooltips:true,zoom:true,zero:true,connectGaps:false,reverse:false,
  numberStyle:'number',yScale:'linear',decimals:2,rotation:0,fontSize:12,lineWidth:3,markerSize:5,areaOpacity:.2,barWidth:65,bins:0,donutHole:42,exportScale:2};
const csNumericBounds={decimals:[0,8],rotation:[0,90],fontSize:[10,24],lineWidth:[1,8],markerSize:[0,24],areaOpacity:[0,1],barWidth:[10,95],bins:[0,100],donutHole:[10,75],exportScale:[1,4]};
function csDisplayConfig(config){const c={...csAppearance,...config};for(const [key,[min,max]] of Object.entries(csNumericBounds)){const n=Number(c[key]);c[key]=Number.isFinite(n)?Math.max(min,Math.min(max,n)):csAppearance[key];}return c;}
const csPortal={child:null,moved:[],timer:null,restoring:false,pair:null};
function csPair(){return csPortal.pair||(csPortal.pair=window.bedazzlePair||{instance:crypto.randomUUID(),colorName:'Purple',color:'#7765da'});}
function csColor(id){
  return node('button',{id,type:'button',class:'cs-link-color',onclick:event=>{
    if(csPortal.child){if(event.detail===0)csRestore();else (event.currentTarget.ownerDocument===document?csPortal.child:window).focus();}
  },ondblclick:()=>csRestore(),'aria-label':'Linked Chart Studio window','title':'Linked Chart Studio window. Double-click or press Enter to bring the chart back.'});
}
function csUpdateLink(){
  const pair=csPair();
  for(const id of ['cs-link','cs-owner-link']){const el=$(id);if(el){el.style.background=pair.color;el.title=`${pair.colorName} · Session ${pair.instance.slice(0,8)}. Double-click or press Enter to bring Chart Studio back.`;el.setAttribute('aria-label',pair.colorName+' linked Chart Studio window');}}
  if(csPortal.child&&!csPortal.child.closed){const doc=csPortal.child.document;doc.documentElement.dataset.theme=document.documentElement.dataset.theme||'light';doc.title='Chart Studio · '+(chartStudio.preview?.config.title||'New chart')+' · '+pair.colorName+' · '+pair.instance.slice(0,8);}
}
function csShow(){
  csUpdateLink();if(!$('chart-studio').open)$('chart-studio').showModal();
  if(csPortal.child&&!csPortal.child.closed)csPortal.child.focus();
}
function csRedraw(){
  if(chartStudio.preview&&$('cs-canvas'))chartStudio.chart=csDraw($('cs-canvas'),chartStudio.preview,chartStudio.preview.config);
}
function csRestore(close=true,showStudio=true){
  if(!csPortal.child||csPortal.restoring)return;
  csPortal.restoring=true;clearInterval(csPortal.timer);const previous=csPortal.child;csPortal.child=null;
  for(const {element,marker} of csPortal.moved){if(element.open)element.close();marker.replaceWith(element);}
  csPortal.moved=[];window.bedazzleChartWindow=null;
  $('cs-owner-link').classList.add('hidden');$('cs-owner-return').classList.add('hidden');
  $('cs-detach').textContent='↗';$('cs-detach').title='Open Chart Studio in a new tab';$('cs-detach').setAttribute('aria-label','Open Chart Studio in a new tab');
  csPortal.restoring=false;if(close&&!previous.closed)previous.close();
  if(showStudio){csShow();csRedraw();}
}
function csClose(){if(csPortal.child)csRestore(true,false);else $('chart-studio').close();}
function csDetach(){
  if(csPortal.child&&!csPortal.child.closed){csRestore();return;}
  const child=window.open('about:blank','bedazzle-chart-'+csPair().instance);
  if(!child){$('cs-status').textContent='Allow pop-ups for Bedazzle to open Chart Studio in a new tab.';return;}
  csPortal.child=child;
  try{
    const doc=child.document;doc.documentElement.lang='en';doc.head.replaceChildren();doc.body.replaceChildren();doc.body.className='cs-detached-window';
    doc.head.append(node('meta',{name:'viewport',content:'width=device-width,initial-scale=1'}));
    for(const link of document.querySelectorAll('link[rel="stylesheet"],link[rel="icon"]')){const copy=link.cloneNode(true);copy.href=link.href;copy.addEventListener('load',()=>chartStudio.chart?.resize());doc.head.append(copy);}
    window.bedazzleChartWindow=doc;
    for(const id of ['chart-studio','chart-dashboards']){const element=document.getElementById(id),marker=document.createComment('Chart Studio return position');if(element.open)element.close();element.before(marker);csPortal.moved.push({element,marker});doc.body.append(element);}
    $('cs-detach').textContent='↙';$('cs-detach').title='Bring Chart Studio back';$('cs-detach').setAttribute('aria-label','Bring Chart Studio back');
    $('cs-owner-link').classList.remove('hidden');$('cs-owner-return').classList.remove('hidden');
    csShow();csRedraw();
    child.addEventListener('resize',()=>chartStudio.chart?.resize());
    child.addEventListener('pagehide',()=>csRestore(false),{once:true});
    csPortal.timer=setInterval(()=>{if(csPortal.child?.closed)csRestore(false);else csUpdateLink();},300);
  }catch(error){csRestore();throw error;}
}
let quickChart=null;
function csButton(text,fn,cls='button secondary compact'){return node('button',{type:'button',class:cls,onclick:()=>Promise.resolve().then(fn).catch(report)},text);}
function csSelect(id,entries){return node('select',{id},...entries.map(([v,t])=>node('option',{value:v},t)));}
function csField(text,input){return node('label',{},text,input);}
const chartValuePickers=new WeakMap();
function csSyncValues(select){chartValuePickers.get(select)?.();}
function csValuePicker(select,title){
  select.multiple=true;select.hidden=true;select.classList.add('cs-values-native');select.setAttribute('aria-hidden','true');
  const heading=node('span',{id:select.id+'-heading',class:'cs-values-heading'},title);
  const chosen=node('span',{class:'cs-values-chosen'}),summary=node('summary',{id:select.id+'-toggle','aria-label':'Choose '+title.toLowerCase()},chosen);
  const list=node('div',{class:'cs-values-options',role:'group','aria-labelledby':heading.id});
  const picker=node('details',{id:select.id+'-picker',class:'cs-values-picker'},summary,list);
  let signature='';
  const sync=()=>{
    const options=[...select.options],next=JSON.stringify(options.map(o=>[o.value,o.textContent,o.disabled]));
    if(next!==signature){
      signature=next;picker.open=false;
      list.replaceChildren(...options.map(option=>{
        const check=node('input',{type:'checkbox',value:option.value,onchange:()=>{
          option.selected=check.checked;
          const EventType=select.ownerDocument.defaultView.Event;
          select.dispatchEvent(new EventType('input',{bubbles:true}));select.dispatchEvent(new EventType('change',{bubbles:true}));
        }});check.disabled=option.disabled;
        return node('label',{class:'cs-values-option'},check,node('span',{},option.textContent));
      }));
      if(!options.length)list.append(node('p',{class:'cs-values-empty'},'No columns available.'));
    }
    list.querySelectorAll('input').forEach((check,i)=>{check.checked=options[i].selected;});
    const selected=options.filter(o=>o.selected);
    chosen.replaceChildren(...(selected.length?selected.map(o=>node('span',{class:'cs-value-chip'},o.textContent)):[node('span',{class:'cs-values-empty'},'Choose values…')]));
  };
  chartValuePickers.set(select,sync);select.addEventListener('change',sync);
  new MutationObserver(sync).observe(select,{childList:true,subtree:true,characterData:true});
  picker.addEventListener('keydown',event=>{if(event.key==='Escape'&&picker.open){event.preventDefault();event.stopPropagation();picker.open=false;summary.focus();}});
  sync();return node('div',{class:'cs-values-field'},heading,select,picker);
}
function csNumber(v){return v===null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);}
function chartOption(data,c){
  c=csDisplayConfig(c);
  // Distinguish a missing label from literal text such as "NULL".
  const displayMap=values=>{const map=new Map(),used=new Set();for(const v of values){const key=JSON.stringify(v);if(map.has(key))continue;const base=v===null?'NULL (missing)':String(v);let label=base,n=2;while(used.has(label))label=base+' ('+(n++)+')';used.add(label);map.set(key,label);}return map;};
  const xm=displayMap(data.rows.map(r=>r[0])),gm=displayMap(data.rows.map(r=>r[1]));
  const rows=data.rows.map(r=>[c.type==='scatter'?r[0]:xm.get(JSON.stringify(r[0])),gm.get(JSON.stringify(r[1])),...r.slice(2)]),ys=c.ys,colors=chartPalettes[c.palette]||chartPalettes.jewel;
  if(!rows.length)throw new Error('No matching rows to chart.');
  const special=['pie','donut','rose','treemap','funnel','histogram','boxplot'];
  if(special.includes(c.type)&&(ys.length!==1||c.split))throw new Error('This chart uses one value column and no series split.');
  const groups=[...new Set(rows.map(r=>String(r[1]??'NULL')))];
  if(groups.length*ys.length>40)throw new Error('More than 40 series. Filter the data or remove the series split.');
  const labels=[...new Set(rows.map(r=>String(r[0]??'NULL')))];
  const option={animation:false,color:colors,backgroundColor:'#ffffff',textStyle:{fontFamily:'system-ui, sans-serif',color:'#334155'},
    title:{text:c.title||chartTypes[c.type],subtext:c.subtitle||'',left:24,top:14,textStyle:{fontSize:19,color:'#24324b'},subtextStyle:{width:750,overflow:'truncate'}},
    tooltip:{trigger:'item',renderMode:'richText',confine:true},legend:{type:'scroll',bottom:8,left:24,right:24},
    aria:{enabled:true},grid:{left:80,right:38,top:95,bottom:90,containLabel:true}};
  const values=rows.map(r=>({name:String(r[0]??'NULL'),value:csNumber(r[2])}));
  if(['pie','donut','rose','treemap','funnel','radar'].includes(c.type)&&rows.some(r=>r.slice(2).some(v=>csNumber(v)!==null&&Number(v)<0)))throw new Error('This chart requires nonnegative values. Choose a bar or line chart for signed values.');
  if(['pie','donut','rose'].includes(c.type)){
    if(!values.some(v=>v.value>0))throw new Error('Pie charts need at least one positive value.');
    option.series=[{type:'pie',radius:c.type==='donut'?[c.donutHole+'%','80%']:['0%','68%'],center:['50%','53%'],roseType:c.type==='rose'?'radius':undefined,
      avoidLabelOverlap:true,label:{show:c.showLabels!==false,formatter:'{b}: {d}%'},data:values,itemStyle:{borderColor:'#fff',borderWidth:2,borderRadius:5}}];
  }else if(c.type==='treemap'||c.type==='funnel'){
    option.series=[{type:c.type,data:values,top:90,bottom:65,left:35,right:35,label:{show:true,formatter:'{b}\n{c}'},breadcrumb:{show:false}}];
  }else if(c.type==='histogram'){
    const nums=values.map(v=>v.value).filter(v=>v!==null);if(!nums.length)throw new Error('No numeric values to bin.');
    const min=Math.min(...nums),max=Math.max(...nums),n=Math.round(c.bins)||Math.min(30,Math.max(1,Math.ceil(Math.sqrt(nums.length)))),step=(max-min)/n||1;
    const bins=Array(n).fill(0);nums.forEach(v=>bins[Math.min(n-1,Math.floor((v-min)/step))]++);
    option.xAxis={type:'category',name:c.xTitle||ys[0],data:bins.map((_,i)=>(min+i*step).toLocaleString(undefined,{maximumFractionDigits:2}))};option.yAxis={type:'value',name:'Frequency'};
    option.series=[{type:'bar',barGap:0,data:bins}];
  }else if(c.type==='boxplot'){
    const buckets=new Map();rows.forEach(r=>{const v=csNumber(r[2]);if(v!==null){const k=String(r[0]??'NULL');if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(v);}});
    if(!buckets.size)throw new Error('No numeric values to summarize.');
    const stats=[...buckets.values()].map(a=>{a.sort((a,b)=>a-b);const q=p=>{const pos=(a.length-1)*p,i=Math.floor(pos);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(pos-i);};return [a[0],q(.25),q(.5),q(.75),a.at(-1)];});
    option.xAxis={type:'category',data:[...buckets.keys()]};option.yAxis={type:'value',name:c.yTitle||ys[0]};option.series=[{type:'boxplot',data:stats}];
  }else if(c.type==='radar'){
    if(labels.length>30)throw new Error('Radar supports up to 30 categories. Reduce the category limit.');
    if(groups.some(g=>labels.some(l=>ys.some((_,j)=>csNumber(rows.find(r=>String(r[0])===l&&String(r[1])===g)?.[j+2])===null))))throw new Error('Radar needs a numeric value for every series in each category. Remove the split or fill missing groups in SQL.');
    const max=Math.max(1,...rows.flatMap(r=>r.slice(2).map(v=>csNumber(v)||0)));
    option.radar={indicator:labels.map(name=>({name,max})),radius:'58%',center:['50%','54%']};option.series=[{type:'radar',data:groups.flatMap(g=>ys.map((y,j)=>({name:(c.split?g+' · ':'')+y,value:labels.map(l=>csNumber(rows.find(r=>String(r[0]??'NULL')===l&&String(r[1]??'NULL')===g)?.[j+2])||0)})))}];
  }else if(c.type==='heatmap'){
    const seriesNames=groups.flatMap(g=>ys.map(y=>(c.split?g+' · ':'')+y));
    const points=rows.flatMap(r=>ys.map((_,j)=>[labels.indexOf(String(r[0]??'NULL')),groups.indexOf(String(r[1]??'NULL'))*ys.length+j,csNumber(r[j+2])])).filter(p=>p[2]!==null);
    option.xAxis={type:'category',data:labels};option.yAxis={type:'category',data:seriesNames};
    option.visualMap={min:Math.min(0,...points.map(p=>p[2])),max:Math.max(1,...points.map(p=>p[2])),orient:'horizontal',bottom:0,left:'center',inRange:{color:['#edf4fc',colors[0]]}};
    option.legend.show=false;option.series=[{type:'heatmap',data:points,label:{show:!!c.showLabels}}];
  }else{
    const scatter=c.type==='scatter',horizontal=c.type==='horizontal',stacked=['stacked','stacked-area'].includes(c.type),line=['line','smooth','area','stacked-area'].includes(c.type);
    option.tooltip.trigger=scatter?'item':'axis';
    const cat={type:'category',data:labels,name:c.xTitle||c.x,nameLocation:'middle',nameGap:32,axisLabel:{hideOverlap:true}},num={type:'value',name:c.yTitle||'',nameLocation:'middle',nameGap:60,splitLine:{lineStyle:{color:'#edf0f5'}}};
    option.xAxis=scatter?{type:'value',name:c.xTitle||c.x,nameLocation:'middle',nameGap:32}:horizontal?num:cat;option.yAxis=horizontal?cat:num;
    option.dataZoom=scatter?[]:[{type:'inside',xAxisIndex:horizontal?undefined:0,yAxisIndex:horizontal?0:undefined},{type:'slider',height:16,bottom:40,xAxisIndex:horizontal?undefined:0,yAxisIndex:horizontal?0:undefined}];
    option.series=groups.flatMap(g=>ys.map((y,j)=>({name:(c.split?g+' · ':'')+y,type:scatter?'scatter':line?'line':'bar',stack:stacked?'total':undefined,smooth:c.type==='smooth',
      areaStyle:['area','stacked-area'].includes(c.type)?{opacity:.2}:undefined,connectNulls:false,symbolSize:scatter?9:5,
      label:{show:!!c.showLabels,position:'top'},emphasis:{focus:'series'},
      data:scatter?rows.filter(r=>String(r[1]??'NULL')===g).map(r=>[csNumber(r[0]),csNumber(r[j+2])]).filter(p=>p.every(v=>v!==null)):
        labels.map(l=>csNumber(rows.find(r=>String(r[0]??'NULL')===l&&String(r[1]??'NULL')===g)?.[j+2]))})));
  }
  if(c.type==='scatter'&&!option.series.some(s=>s.data.length))throw new Error('Scatter needs numeric X and Y values. Choose numeric columns, or use a line chart for dates and category labels.');
  const format=value=>{const n=Number(value);if(value===null||!Number.isFinite(n))return '—';return new Intl.NumberFormat(undefined,{maximumFractionDigits:c.decimals,notation:c.numberStyle==='compact'?'compact':'standard',style:c.numberStyle==='percent'?'percent':'decimal'}).format(n);};
  option.textStyle.fontSize=c.fontSize;option.title.textStyle.fontSize=c.fontSize+7;
  option.tooltip.show=c.tooltips;option.tooltip.valueFormatter=format;
  option.legend.show=option.legend.show!==false&&c.legend;
  if(c.legendPosition==='top'){Object.assign(option.legend,{top:65,bottom:undefined});option.grid.top=110;}
  if(c.legendPosition==='right'){Object.assign(option.legend,{orient:'vertical',left:undefined,top:95,right:12,bottom:40,width:140});option.grid.right=180;}
  if(!c.zoom)option.dataZoom=[];
  for(const axis of [option.xAxis,option.yAxis].filter(Boolean)){
    if(axis.type==='category'){axis.axisLabel={...axis.axisLabel,rotate:c.rotation,hideOverlap:true};axis.inverse=c.reverse;}
    else if(axis.type==='value'){
      axis.axisLabel={...axis.axisLabel,formatter:format};axis.splitLine={show:c.grid,lineStyle:{color:'#edf0f5'}};axis.scale=!c.zero;
      if(axis===option.yAxis&&c.yScale==='log'){
        if(rows.some(r=>r.slice(2).some(v=>csNumber(v)!==null&&Number(v)<=0)))throw new Error('A logarithmic Y axis requires positive values. Choose a linear axis for zero or negative values.');
        axis.type='log';delete axis.scale;
      }
    }
  }
  for(const series of option.series){
    if(series.type==='line'){series.lineStyle={width:c.lineWidth};series.symbolSize=c.markerSize;series.showSymbol=c.markerSize>0;series.connectNulls=c.connectGaps;if(series.areaStyle)series.areaStyle.opacity=c.areaOpacity;}
    if(series.type==='scatter')series.symbolSize=Math.max(2,c.markerSize);
    if(series.type==='bar')series.barMaxWidth=c.barWidth+'%';
  }
  return option;
}
function csDraw(target,data,config){
  const existing=echarts.getInstanceByDom(target);if(existing)existing.dispose();
  target.replaceChildren();const option=chartOption(data,config),chart=echarts.init(target,null,{renderer:'svg'});chart.setOption(option);return chart;
}
function csDownload(blob,name){const url=URL.createObjectURL(blob),a=node('a',{href:url,download:name}),doc=csPortal.child&&!csPortal.child.closed?csPortal.child.document:document;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function csExport(chart,type,title,scale=2){
  if(!chart||chart.isDisposed())throw new Error('Draw a chart first.');
  const svg=chart.renderToSVGString(),name=(title||'Bedazzle chart').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
  if(type==='svg')return csDownload(new Blob([svg],{type:'image/svg+xml'}),name+'.svg');
  const img=new Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('The browser could not convert this chart to PNG.'));img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
  const canvas=document.createElement('canvas');canvas.width=chart.getWidth()*scale;canvas.height=chart.getHeight()*scale;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));csDownload(blob,name+'.png');
}
function quickPrepare(){
  if(!state.result)return;
  const previous=$('chart-label').value,selected=[...$('chart-value').selectedOptions].map(o=>o.value),cols=state.result.columns;
  fillOptions('chart-label',cols.map(c=>[c.name,c.name]));fillOptions('chart-value',cols.map(c=>[c.name,c.name]));
  if(cols.some(c=>c.name===previous))$('chart-label').value=previous;
  const numeric=cols.filter(c=>/INT|DECIMAL|DOUBLE|FLOAT|REAL/.test(c.type));
  const chosen=selected.filter(n=>cols.some(c=>c.name===n));if(!chosen.length&&numeric.length)chosen.push(numeric.at(-1).name);
  for(const opt of $('chart-value').options)opt.selected=chosen.includes(opt.value);
  csSyncValues($('chart-value'));
  if(state.view==='chart')quickRender();
}
function quickRender(){
  const el=$('chart-content');if(!el)return;
  try{
    const ys=[...$('chart-value').selectedOptions].map(o=>o.value);if(!state.result?.rows.length||!ys.length)throw new Error('Run a query and select one or more numeric values.');
    const c={type:$('chart-type').value,x:$('chart-label').value,ys,palette:'jewel',showLabels:false},ix=state.result.columns.findIndex(col=>col.name===c.x),indices=ys.map(y=>state.result.columns.findIndex(col=>col.name===y));
    const rows=state.result.rows.slice(0,100).map(r=>[r[ix],'',...indices.map(i=>csNumber(r[i]))]);
    // Quick charts combine repeated labels so a category is never overwritten.
    if(!['scatter','histogram','boxplot'].includes(c.type)){
      const grouped=new Map();for(const r of rows){const key=String(r[0]??'NULL');if(!grouped.has(key))grouped.set(key,[r[0],'',...ys.map(()=>null)]);const dest=grouped.get(key);r.slice(2).forEach((v,j)=>{if(v!==null)dest[j+2]=(dest[j+2]??0)+v;});}rows.splice(0,rows.length,...grouped.values());
    }
    quickChart=csDraw(el,{rows},c);
  }catch(e){echarts.getInstanceByDom(el)?.dispose();el.replaceChildren(node('p',{class:'chart-empty'},e.message));quickChart=null;}
}
function csConfig(){const get=id=>$('cs-'+id).value,appearance={};for(const [key,value] of Object.entries(csAppearance)){const el=$('cs-'+key);appearance[key]=typeof value==='boolean'?el.checked:typeof value==='number'?Number(el.value):el.value;}return csDisplayConfig({...appearance,type:get('type'),title:get('title'),subtitle:get('subtitle'),x:get('x'),ys:[...$('cs-ys').selectedOptions].map(o=>o.value),split:get('split'),aggregate:get('aggregate'),bucket:get('bucket'),sort:get('sort'),limit:Number(get('limit')),filter:get('filter'),dashboard:get('dashboard'),palette:get('palette'),xTitle:get('xTitle'),yTitle:get('yTitle'),showLabels:$('cs-labels').checked});}
function csSetConfig(c){c=csDisplayConfig(c);for(const key of ['type','title','subtitle','x','split','aggregate','bucket','sort','limit','filter','dashboard','palette','xTitle','yTitle'])if(c[key]!==undefined)$('cs-'+key).value=c[key];for(const [key,value] of Object.entries(csAppearance)){const el=$('cs-'+key);if(typeof value==='boolean')el.checked=!!c[key];else el.value=c[key];}for(const o of $('cs-ys').options)o.selected=c.ys.includes(o.value);csSyncValues($('cs-ys'));$('cs-labels').checked=!!c.showLabels;}
async function csJob(payload){
  try{return await runJob('chart_studio',payload);}
  catch(error){if(/Unknown operation/i.test(error.message))throw new Error('Restart Bedazzle to enable Chart studio, then reopen this page. The running server is from before the chart update.');throw error;}
}
function csBusy(value){$('cs-controls').inert=value;$('cs-save').disabled=value;$('cs-update').disabled=value;}
async function csPreview(){
  if(!chartStudio.source)throw new Error('Send query results to Chart studio first.');
  csBusy(true);$('cs-status').textContent='Reading the frozen result and building the chart…';
  try{const data=await csJob({op:'preview',source:chartStudio.source,config:csConfig()});chartStudio.preview=data;
    chartStudio.chart=csDraw($('cs-canvas'),data,data.config);chartStudio.dirty=false;
    $('cs-status').textContent=`${data.info.rows.toLocaleString()} source rows · ${data.matching_rows.toLocaleString()} match · ${data.rows.length} ${data.raw?'observations':'grouped points'}${data.truncated?' · DISPLAY LIMITED to '+data.limit+'; narrow your query/filter to include the rest':''}${data.invalid.some(n=>n)?' · Non-numeric / nonfinite values ignored: '+data.config.ys.map((y,i)=>y+' '+data.invalid[i]).join(', '):''}${data.config.type==='boxplot'?' · Whiskers show minimum and maximum':''}`;
    if(data.invalid_x)$('cs-status').textContent+=' · Missing / non-numeric X observations omitted: '+data.invalid_x;
    $('cs-source-sql').textContent=data.info.sql;inlineError('cs-error',null);
  }finally{csBusy(false);}
}
async function csOpen(){
  if(!state.result?.result_id)throw new Error('Run a query to retain results before opening Chart studio.');
  const opened=await csJob({op:'open',result_id:state.result.result_id});
  chartStudio.source=opened.source;chartStudio.info=opened.info;chartStudio.id=null;
  csPopulate(opened.info.columns);csShow();
  const cols=opened.info.columns,numeric=cols.filter(c=>/INT|DECIMAL|DOUBLE|FLOAT|REAL/.test(c.type));
  csSetConfig({type:'bar',title:'Untitled chart',subtitle:'',x:cols[0].name,ys:[(numeric.at(-1)||cols.at(-1)).name],split:'',aggregate:'sum',bucket:'',sort:'label',limit:100,filter:'',dashboard:'My dashboard',palette:'jewel',xTitle:'',yTitle:''});
  await csPreview();
}
function csPopulate(cols){for(const id of ['x','ys','split'])$('cs-'+id).replaceChildren(...(id==='split'?[node('option',{value:''},'None')]:[]),...cols.map(c=>node('option',{value:c.name},c.name)));}
async function csSave(copy=false){
  if(chartStudio.dirty||!chartStudio.preview)await csPreview();
  await csJob({op:'save',source:chartStudio.source,id:copy?null:chartStudio.id,config:csConfig()});
  // Find the last saved chart: saves append atomically in the active workspace.
  const lib=await csJob({op:'list'});chartStudio.id=lib.charts.at(-1).id;const message='Chart saved to '+(csConfig().dashboard||'My dashboard')+'.';$('cs-status').textContent=message;toast(message);
}
async function csLoad(saved){
  const data=await csJob({op:'preview',source:saved.source,config:saved.config});chartStudio.source=saved.source;chartStudio.info=data.info;chartStudio.id=saved.id;chartStudio.preview=data;
  csPopulate(data.info.columns);csSetConfig(saved.config);$('chart-dashboards').close();csShow();await csPreview();
}
async function csLibrary(){
  const data=await csJob({op:'list'});chartStudio.cards.forEach(c=>c.dispose());chartStudio.cards=[];
  const names=[...new Set(data.charts.map(c=>c.config.dashboard||'My dashboard'))];
  $('cs-dashboard-select').replaceChildren(node('option',{value:''},'All dashboards'),...names.map(n=>node('option',{value:n},n)));
  chartStudio.library=data;await csDashboard();if(!$('chart-dashboards').open)$('chart-dashboards').showModal();
  chartStudio.cards.forEach(c=>c.resize());
}
async function csDashboard(){
  chartStudio.cards.forEach(c=>c.dispose());chartStudio.cards=[];$('cs-dashboard-grid').replaceChildren();
  const selected=$('cs-dashboard-select').value,charts=chartStudio.library.charts.filter(c=>!selected||(c.config.dashboard||'My dashboard')===selected);
  if(!charts.length)$('cs-dashboard-grid').append(node('p',{},'No saved charts yet. Send query results to Chart studio, then save a chart.'));
  for(const saved of charts){
    const canvas=node('div',{class:'cs-dashboard-canvas'}),card=node('article',{class:'cs-chart-card'},node('div',{class:'cs-card-heading'},node('strong',{},saved.config.dashboard||'My dashboard'),csButton('Edit',()=>csLoad(saved)),csButton('Delete',async()=>{if(!confirm('Delete this saved chart?'))return;await csJob({op:'delete',id:saved.id});await csLibrary();})),canvas);
    $('cs-dashboard-grid').append(card);
    try{const data=await csJob({op:'preview',source:saved.source,config:saved.config});const chart=csDraw(canvas,data,saved.config);chartStudio.cards.push(chart);card.append(node('p',{class:'cs-card-note'},`${data.rows.length} ${data.raw?'observations':'grouped points'}${data.truncated?' · limited view':''}`),node('div',{class:'cs-card-actions'},csButton('PNG',()=>csExport(chart,'png',saved.config.title)),csButton('SVG',()=>csExport(chart,'svg',saved.config.title))));}catch(e){canvas.textContent=e.message;}
  }
}
function setupCharts(){
  const controls=$('chart-label').closest('.chart-controls');controls.prepend(csField('Chart type',csSelect('chart-type',Object.entries(chartTypes))));
  controls.querySelector('span').textContent='First 100 loaded rows · repeated labels summed';
  const valueSelect=$('chart-value'),valueLabel=valueSelect.closest('label');valueLabel.replaceWith(csValuePicker(valueSelect,'Values'));
  controls.append(csButton('Chart studio →',csOpen),csButton('PNG',()=>csExport(quickChart,'png','Quick chart')),csButton('SVG',()=>csExport(quickChart,'svg','Quick chart')));
  $('chart-type').addEventListener('change',quickRender);
  const nav=csButton('Chart dashboards',csLibrary,'nav-item');nav.id='chart-dashboards-nav';document.querySelector('.main-nav').append(nav);
  const section=(name,open,...fields)=>node('details',{class:'cs-settings-section',...(open?{open:''}:{})},node('summary',{},name),node('div',{class:'cs-section-fields'},...fields));
  const number=(key,step=1)=>node('input',{id:'cs-'+key,type:'number',min:csNumericBounds[key][0],max:csNumericBounds[key][1],step,value:csAppearance[key]});
  const check=(key,label)=>csField(label,node('input',{id:'cs-'+key,type:'checkbox',...(csAppearance[key]?{checked:''}:{})}));
  const controlsBox=node('aside',{id:'cs-controls',class:'cs-controls','aria-label':'Chart settings'});
  controlsBox.append(node('h3',{},'Chart settings'),section('Data & series',true,
    csField('Chart type',csSelect('cs-type',Object.entries(chartTypes))),csField('Labels / X',csSelect('cs-x',[])),
    csValuePicker(node('select',{id:'cs-ys',multiple:''}),'Values'),csField('Split into series',csSelect('cs-split',[])),
    csField('Calculation',csSelect('cs-aggregate',[['sum','Sum'],['avg','Average'],['min','Minimum'],['max','Maximum'],['count','Row count'],['raw','Raw observations']])),
    node('small',{},'Numeric text is converted explicitly. Invalid values are ignored and counted. Row count counts all rows. Scatter, histogram and box plot use bounded raw observations.'),
    csField('Date interval',csSelect('cs-bucket',[['','Original labels'],...['day','week','month','quarter','year'].map(v=>[v,v])])),
    csField('Sort',csSelect('cs-sort',[['label','Label ascending'],['desc','First value: high to low'],['asc','First value: low to high']])),
    csField('Maximum grouped points (5–500)',node('input',{id:'cs-limit',type:'number',min:5,max:500,value:100})),
    csField('Label contains',node('input',{id:'cs-filter',maxlength:200,placeholder:'Filter source labels'}))),
    section('Titles & axes',true,csField('Title',node('input',{id:'cs-title',maxlength:200})),csField('Subtitle',node('input',{id:'cs-subtitle',maxlength:500})),
    csField('X axis title',node('input',{id:'cs-xTitle',maxlength:100})),csField('Y axis title',node('input',{id:'cs-yTitle',maxlength:100})),
    csField('Y axis scale',csSelect('cs-yScale',[['linear','Linear'],['log','Logarithmic (positive values)']])),
    csField('Label rotation (degrees)',number('rotation')),check('zero','Start numeric axis at zero'),check('reverse','Reverse category order')),
    section('Appearance & interaction',false,csField('Colors',csSelect('cs-palette',Object.keys(chartPalettes).map(v=>[v,v]))),
    csField('Show value labels',node('input',{id:'cs-labels',type:'checkbox'})),check('legend','Show legend'),
    csField('Legend position',csSelect('cs-legendPosition',[['bottom','Bottom'],['top','Top'],['right','Right']])),
    check('grid','Show grid lines'),check('tooltips','Show tooltips'),check('zoom','Enable chart zoom'),
    csField('Number format',csSelect('cs-numberStyle',[['number','Number'],['compact','Compact (1.2K)'],['percent','Percent (0.25 → 25%)']])),
    csField('Decimal places',number('decimals')),csField('Font size',number('fontSize'))),
    section('Chart details',false,csField('Line width',number('lineWidth')),csField('Point size (0 hides line markers)',number('markerSize')),
    check('connectGaps','Connect missing values'),csField('Area opacity',number('areaOpacity',.05)),csField('Maximum bar width (%)',number('barWidth')),
    csField('Histogram bins (0 = automatic)',number('bins')),csField('Donut hole (%)',number('donutHole'))),
    section('Save & export',false,csField('Dashboard',node('input',{id:'cs-dashboard',maxlength:100,value:'My dashboard'})),
    csField('PNG resolution multiplier',number('exportScale')),csButton('Save a copy',()=>csSave(true)),node('small',{},'PNG exports use the selected resolution. SVG stays sharp at any size. Exports use the last drawn preview.')),
    section('Source data',false,node('p',{},'Frozen data from the original query run.'),node('pre',{id:'cs-source-sql'})));
  controlsBox.addEventListener('input',()=>{chartStudio.dirty=true;$('cs-status').textContent='Settings changed · Update preview to apply.';});
  const settingsToggle=node('button',{id:'cs-toggle-settings',type:'button',class:'button secondary compact','aria-expanded':'true','aria-controls':'cs-controls',onclick:()=>{
    const hidden=$('chart-studio').classList.toggle('cs-settings-hidden');$('cs-toggle-settings').setAttribute('aria-expanded',String(!hidden));$('cs-toggle-settings').textContent=hidden?'Show settings':'Hide settings';
  }},'Hide settings');
  const studio=node('dialog',{id:'chart-studio',class:'modal cs-modal','aria-labelledby':'cs-heading'},
    node('div',{class:'cs-toolbar'},node('h2',{id:'cs-heading'},'Chart Studio'),
    Object.assign(csButton('Update preview',csPreview,'button primary compact'),{id:'cs-update'}),Object.assign(csButton('Save chart',()=>csSave(false),'button primary compact'),{id:'cs-save'}),
    csButton('Export PNG',()=>csExport(chartStudio.chart,'png',chartStudio.preview?.config.title,csDisplayConfig(chartStudio.preview?.config||{}).exportScale)),csButton('Export SVG',()=>csExport(chartStudio.chart,'svg',chartStudio.preview?.config.title)),
    csButton('Saved dashboards',csLibrary),settingsToggle,
    node('button',{id:'cs-detach',type:'button',class:'icon-button expand-button',title:'Open Chart Studio in a new tab','aria-label':'Open Chart Studio in a new tab',onclick:()=>{try{csDetach();}catch(error){report(error);}}},'↗'),
    csButton('Close',csClose),csColor('cs-link')),
    node('div',{class:'cs-layout'},node('section',{class:'cs-preview','aria-label':'Chart preview'},node('div',{id:'cs-canvas'}),node('div',{class:'cs-preview-footer'},node('p',{id:'cs-status',role:'status','aria-live':'polite'}),node('div',{id:'cs-error',class:'modal-error hidden',role:'alert'}))),controlsBox));
  const dashboards=node('dialog',{id:'chart-dashboards',class:'modal cs-modal'},node('div',{class:'cs-toolbar'},node('h2',{},'Chart dashboards'),csSelect('cs-dashboard-select',[]),csButton('Print / PDF',()=>$('chart-dashboards').ownerDocument.defaultView.print()),csButton('Free unused sources',async()=>{if(!confirm('Remove chart sources that have no saved charts? Any unsaved studio source will also be removed.'))return;await csJob({op:'clean'});toast('Unused chart sources removed.');}),csButton('Close',()=>$('chart-dashboards').close())),node('p',{},'Saved charts use frozen data from their original query run. Edit a chart to change its dashboard name.'),node('div',{id:'cs-dashboard-grid'}));
  document.body.append(studio,dashboards);$('cs-dashboard-select').addEventListener('change',()=>csDashboard().catch(report));
  const ownerLink=csColor('cs-owner-link');ownerLink.classList.add('hidden');
  const ownerReturn=csButton('↙ Chart Studio',()=>csRestore());ownerReturn.id='cs-owner-return';ownerReturn.classList.add('hidden');document.querySelector('.topbar').append(ownerReturn,ownerLink);
  studio.addEventListener('cancel',event=>{if(csPortal.child){event.preventDefault();csClose();}});
  window.addEventListener('pagehide',()=>csRestore(true,false));
  const resize=()=>{if(quickChart&&!quickChart.isDisposed())quickChart.resize();if(chartStudio.chart&&!chartStudio.chart.isDisposed())chartStudio.chart.resize();chartStudio.cards.forEach(c=>!c.isDisposed()&&c.resize());};
  new ResizeObserver(resize).observe($('chart-content'));new ResizeObserver(resize).observe($('cs-canvas'));
  window.addEventListener('resize',resize);quickPrepare();
}
document.addEventListener('DOMContentLoaded',setupCharts);
