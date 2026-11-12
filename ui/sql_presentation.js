/* Colored mirror keeps the native editor's selection, IME and keyboard behavior. */
'use strict';
let sqlPaintFrame, sqlPaintValue, sqlFormatStyle='vertical', sqlFormatWidth='auto', sqlMeasure;
const sqlFormatStyles={vertical:'Vertical',compact:'Compact',aligned:'Aligned'};
function scheduleSQLHighlight() {
  if (sqlPaintFrame) return;
  sqlPaintFrame = requestAnimationFrame(() => {
    sqlPaintFrame = 0;
    const area = $('sql-editor'), mirror = $('sql-highlight');
    if (!mirror) return;
    if (area.value !== sqlPaintValue) {
      sqlPaintValue = area.value;
      const tokens = SQLAssist.lex(area.value), fragment = document.createDocumentFragment();
      let line=document.createElement('div');line.className='sql-code-line';fragment.append(line);
      const append=(text,kind)=>{
        text.split('\n').forEach((part,index)=>{
          if(index){line=document.createElement('div');line.className='sql-code-line';fragment.append(line);}
          if(!part)return;
          if(kind){const span=document.createElement('span');span.className='sql-'+kind;span.textContent=part;line.append(span);}
          else line.append(document.createTextNode(part));
        });
      };
      let end = 0;
      tokens.forEach((token, index) => {
        append(area.value.slice(end, token.start));
        const text = area.value.slice(token.start, token.end);
        let kind = token.kind;
        if (kind === 'word') {
          kind = SQLAssist.keywords.includes(text.toUpperCase()) ? 'keyword' : 'name';
          if (tokens[index + 1]?.value === '(' && !['SELECT','FROM','WHERE','IN','EXISTS','AS','OVER','FILTER','WITH'].includes(text.toUpperCase())) kind = 'function';
          if (['TRUE','FALSE','NULL'].includes(text.toUpperCase())) kind = 'literal';
        }
        append(text,kind);
        end = token.end;
      });
      append(area.value.slice(end));
      mirror.replaceChildren(fragment);
    }
    // Match the textarea's content width, including when its scrollbar appears.
    mirror.style.width=area.clientWidth+'px';
    const gutter=$('line-numbers');
    if($('sql-pane').classList.contains('sql-wrap')){
      const numbers=[...mirror.children].map((line,index)=>{
        const number=document.createElement('div');number.textContent=index+1;
        number.style.height=line.getBoundingClientRect().height+'px';return number;
      });
      gutter.replaceChildren(...numbers);gutter.dataset.wrapped='true';
    }else if(gutter.dataset.wrapped){
      gutter.textContent=area.value.split('\n').map((_,index)=>index+1).join('\n');delete gutter.dataset.wrapped;
    }
    mirror.scrollTop = area.scrollTop;
    mirror.scrollLeft = area.scrollLeft;
    gutter.scrollTop=area.scrollTop;
  });
}
function sqlLineWidth(){
  const area=$('sql-editor'),style=getComputedStyle(area);
  sqlMeasure ||= document.createElement('canvas').getContext('2d');
  sqlMeasure.font=style.font;
  const available=area.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-12;
  const fit=Math.max(16,Math.floor(available/sqlMeasure.measureText('M').width));
  return sqlFormatWidth==='auto'?fit:Math.min(fit,Number(sqlFormatWidth));
}
function sqlCaretPosition(area){
  if(sqlPaintValue!==area.value)return null;
  const prefix=area.value.slice(0,area.selectionStart),row=prefix.split('\n').length-1;
  const line=$('sql-highlight')?.children[row];if(!line)return null;
  let offset=prefix.length-prefix.lastIndexOf('\n')-1;
  const walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let text;
  while((text=walker.nextNode())){
    if(offset<=text.length){const range=document.createRange();range.setStart(text,offset);range.collapse(true);const rect=range.getBoundingClientRect();if(rect.height)return rect;break;}
    offset-=text.length;
  }
  return line.getBoundingClientRect();
}
function preserveSQLStringBreaks(source,formatted){
  // Adjacent string literals concatenate only across a newline in DuckDB.
  const original=SQLAssist.lex(source),output=SQLAssist.lex(formatted);
  const strings=original.filter(token=>token.kind==='string'),formattedStrings=output.filter(token=>token.kind==='string');
  if(strings.length!==formattedStrings.length)return formatted;
  const originalIndex=new Map(original.map((token,index)=>[token,index])),outputIndex=new Map(output.map((token,index)=>[token,index]));
  for(let index=strings.length-1;index>0;index--){
    const current=strings[index],previous=strings[index-1],next=formattedStrings[index],prior=formattedStrings[index-1];
    if(originalIndex.get(current)!==originalIndex.get(previous)+1||outputIndex.get(next)!==outputIndex.get(prior)+1)continue;
    if(source.slice(previous.end,current.start).includes('\n')&&!formatted.slice(prior.end,next.start).includes('\n')){
      formatted=formatted.slice(0,next.start)+'\n'+formatted.slice(next.start);
    }
  }
  return formatted;
}
// Reflow only whitespace between complete SQL atoms. Literals, identifiers,
// comments and adjacent operator characters remain byte-for-byte intact.
function compactSQL(formatted,width){
  const tokens=SQLAssist.lex(formatted),atoms=[];
  for(const token of tokens){
    const text=formatted.slice(token.start,token.end),last=atoms.at(-1);
    if(last&&last.end===token.start){last.text+=text;last.end=token.end;last.lastKind=token.kind;last.lineComment=token.kind==='comment'&&text.startsWith('--');continue;}
    const prefix=formatted.slice(formatted.lastIndexOf('\n',token.start-1)+1,token.start);
    atoms.push({text,end:token.end,kind:token.kind,lastKind:token.kind,lineComment:token.kind==='comment'&&text.startsWith('--'),
      stringContinuation:last?.lastKind==='string'&&token.kind==='string'&&formatted.slice(last.end,token.start).includes('\n'),indent:/^ *$/.test(prefix)?prefix.length:0,
      clause:/^ *$/.test(prefix)&&/^(SELECT|FROM|WHERE|GROUP|ORDER|HAVING|QUALIFY|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|WITH|JOIN|LEFT|RIGHT|FULL|INNER|CROSS|RETURNING|VALUES|SET|INSERT|UPDATE|DELETE|CREATE)\b/i.test(text)});
  }
  let output='',line='',lineComment=false;
  const flush=()=>{if(line){output+=line.trimEnd()+'\n';line='';}lineComment=false;};
  for(const atom of atoms){
    if(lineComment||atom.stringContinuation||atom.clause&&line.trim()||line.trim()&&line.length+1+atom.text.split('\n')[0].length>width)flush();
    if(!line)line=' '.repeat(Math.min(atom.indent,Math.floor(width/3)));
    else if(line.trim())line+=' ';
    line+=atom.text;
    if(atom.text.includes('\n')){const parts=line.split('\n');line=parts.pop();output+=parts.join('\n')+'\n';}
    lineComment=atom.lineComment;
  }
  flush();return output.trimEnd();
}
function applySQLFormatStyle(){
  $('sql-pane').classList.toggle('sql-wrap',sqlFormatStyle==='compact');
  $('sql-editor').wrap=sqlFormatStyle==='compact'?'soft':'off';
  $('beautify-query').title='Beautify '+sqlFormatStyles[sqlFormatStyle]+' · selected SQL or the whole query';
  document.querySelectorAll('[data-sql-format]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.sqlFormat===sqlFormatStyle)));
  scheduleSQLHighlight();
}
function setupBeautify(){
  try{const saved=JSON.parse(localStorage.getItem('bedazzle-sql-format')||'null');if(saved&&sqlFormatStyles[saved.style])sqlFormatStyle=saved.style;if(['auto','80','100','120'].includes(saved?.width))sqlFormatWidth=saved.width;}catch{}
  const button=$('beautify-options'),menu=$('beautify-menu'),width=$('beautify-width');
  if(!button||!menu)return;
  width.value=sqlFormatWidth;
  const save=()=>{try{localStorage.setItem('bedazzle-sql-format',JSON.stringify({style:sqlFormatStyle,width:sqlFormatWidth}));}catch{}};
  const open=()=>{
    $('beautify-width-hint').textContent='Compact: up to '+sqlLineWidth()+' characters per line. Long values wrap visually.';
    menu.showPopover();
    const rect=button.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,rect.right-menu.offsetWidth))+'px';
    menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,rect.bottom+6))+'px';
  };
  button.addEventListener('click',()=>menu.matches(':popover-open')?menu.hidePopover():open());
  button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();open();menu.querySelector('[data-sql-format]').focus();}});
  menu.addEventListener('toggle',()=>button.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
  menu.addEventListener('keydown',event=>{
    const items=[...menu.querySelectorAll('[data-sql-format]')],index=items.indexOf(document.activeElement);
    if(index>=0&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
    }
    if(event.key==='Escape'){menu.hidePopover();button.focus();}
  });
  menu.querySelectorAll('[data-sql-format]').forEach(item=>item.addEventListener('click',()=>{
    sqlFormatStyle=item.dataset.sqlFormat;save();menu.hidePopover();applySQLFormatStyle();beautifySQL();
  }));
  width.addEventListener('change',()=>{sqlFormatWidth=width.value;save();$('beautify-width-hint').textContent='Compact: up to '+sqlLineWidth()+' characters per line. Long values wrap visually.';});
  const observer=new ResizeObserver(()=>{scheduleSQLHighlight();if(menu.matches(':popover-open'))menu.hidePopover();});observer.observe($('sql-editor'));
  applySQLFormatStyle();
}
function beautifySQL() {
  const area = $('sql-editor'), start = area.selectionStart, end = area.selectionEnd;
  const selected = start !== end, source = selected ? area.value.slice(start, end) : area.value;
  if (!source.trim()) return;
  try {
    let formatted = sqlFormatter.format(source, {language:'duckdb', tabWidth:2, keywordCase:'upper', linesBetweenQueries:2,
      expressionWidth:sqlFormatStyle==='vertical'?50:Math.max(10,sqlLineWidth()-16),
      indentStyle:sqlFormatStyle==='aligned'?'tabularRight':'standard'});
    formatted=preserveSQLStringBreaks(source,formatted);
    if(sqlFormatStyle==='compact')formatted=compactSQL(formatted,sqlLineWidth());
    if (formatted === source) return;
    const scrollTop = area.scrollTop, scrollLeft = area.scrollLeft;
    area.focus();
    area.setSelectionRange(selected ? start : 0, selected ? end : area.value.length);
    // Native insertion makes the complete format a single Ctrl+Z step.
    if (!document.execCommand('insertText', false, formatted)) {
      area.setRangeText(formatted, area.selectionStart, area.selectionEnd, 'end');
    }
    if (selected) area.setSelectionRange(start, start + formatted.length);
    else area.setSelectionRange(Math.min(start, formatted.length), Math.min(start, formatted.length));
    area.scrollTop = scrollTop; area.scrollLeft = scrollLeft;
    closeCompletion(); updateLines(); flushDrafts();
    $('editor-status').textContent = (selected?'Selection':'SQL')+' beautified · '+sqlFormatStyles[sqlFormatStyle]+'. Ctrl+Z to undo.';
  } catch (error) {
    toast('Could not beautify this SQL. Check for unfinished strings or statements.');
  }
}
