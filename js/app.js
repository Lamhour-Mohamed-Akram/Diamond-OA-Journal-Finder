/* ================= App shell / tabs ================= */
/* ---- "Support this free project" footer link (Buy Me a Coffee) ----
   Rendered only when SUPPORT_LINK_ENABLED is true; otherwise nothing is
   inserted into the DOM. Currently HIDDEN everywhere (false).
   TO SHOW IT: set SUPPORT_LINK_ENABLED below to `true` (everywhere), or to
   SUPPORT_LINK_LOCAL_ONLY (localhost / 127.0.0.1 / file:// only), then bump
   ?v= for app.js in index.html and redeploy. */
const SUPPORT_LINK_URL='https://buymeacoffee.com/openaccessfinder';
const SUPPORT_LINK_LOCAL_ONLY=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)||location.protocol==='file:';
const SUPPORT_LINK_ENABLED=false;
function supportLinkHtml(){
  return '<a class="support" href="'+SUPPORT_LINK_URL+'" target="_blank" rel="noopener noreferrer">'
    +'<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/></svg>'
    +'<span data-i18n="Support this free project">'+t('Support this free project')+'</span> ↗</a>';
}
function renderSupportLink(){
  if(!SUPPORT_LINK_ENABLED) return;
  // footers (start screen + sidebar bottom)
  document.querySelectorAll('.credit').forEach(c=>{ if(!c.querySelector('.support')) c.insertAdjacentHTML('beforeend',' · '+supportLinkHtml()); });
  // sidebar header, under the tagline: "Free & non-profit · ☕ Support this free project"
  const tag=document.querySelector('aside .tagline');
  if(tag && !document.querySelector('.support-line')) tag.insertAdjacentHTML('afterend','<p class="support-line"><span data-i18n="Free & non-profit">'+t('Free & non-profit')+'</span> · '+supportLinkHtml()+'</p>');
}
renderSupportLink();

let R=[], state=null;
let S=[], sciRef=null;   // full Scopus/SCImago source list for the Scopus check tab; sciRef = reference "current" year
function covEnd(cov){ const y=(String(cov).match(/\d{4}/g)||[]).map(Number).filter(v=>v>=1900&&v<=2100); return y.length?Math.max(...y):null; }
function covActive(cov){ const e=covEnd(cov); return e!=null && sciRef!=null && e>=sciRef-1; }
const qRank={Q1:1,Q2:2,Q3:3,Q4:4,'':9};
/* ---- Official Scopus source status (data/scopus-status.csv, built monthly
   from Elsevier's source title list by scripts/build-scopus-status.py).
   SCImago only carries a coverage range, so a title Scopus dropped for quality
   reasons can still look covered; this map is the authority. ---- */
const SCOPUS_ST=new Map();   // issn -> {st:'discontinued'|'policy'|'inactive', y:'2025'}
let scopusStLoaded=false;
function scopusStatus(issns){
  for(const i of (issns||[])){ const v=i&&SCOPUS_ST.get(i); if(v) return v; }
  return null;
}
async function loadScopusStatus(){
  if(scopusStLoaded) return; scopusStLoaded=true;
  let text='';
  for(const url of [GH_DATA+'data/scopus-status.csv','data/scopus-status.csv']){
    try{ const r=await fetch(url); if(r.ok){ text=await r.text(); break; } }catch(e){}
  }
  if(!text){ scopusStLoaded=false; return; }
  for(const line of text.split('\n').slice(1)){
    const [a,b,st,y]=line.trim().split(',');
    if(!st) continue;
    if(a) SCOPUS_ST.set(a,{st,y}); if(b) SCOPUS_ST.set(b,{st,y});
  }
  if(state) render();
  if($('main-s').style.display!=='none') renderScopus();
}
/* badge + card class for a status entry (null → nothing) */
function scopusFlag(v){
  if(!v) return {cls:'',tag:''};
  if(v.st==='discontinued') return {cls:' disc',tag:'<span class="tag disc" title="'+esc(t('Removed from the Scopus index (quality or publication concerns). Its SCImago ranking is historical.'))+'">'+t('⛔ Discontinued by Scopus{y}',{y:v.y?' ('+v.y+')':''})+'</span>'};
  if(v.st==='policy') return {cls:' disc',tag:'<span class="tag disc" title="'+esc(t('Removed from the Scopus index after a journal policy change.'))+'">'+t('⛔ Removed from Scopus{y}',{y:v.y?' ('+v.y+')':''})+'</span>'};
  return {cls:' ended',tag:'<span class="tag fee">'+t('⚠ Scopus coverage ended{y}',{y:v.y?' ('+v.y+')':''})+'</span>'};
}
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
/* SCImago "Categories" → one chip per category, coloured by that category's own quartile
   ("Food Science (Q4); History (Q2)" → [Q4 Food Science] [Q2 History]) */
function catTags(cats){
  return (cats||'').split(';').map(s=>s.trim()).filter(Boolean).map(c=>{
    const m=c.match(/^(.*?)\s*\((Q[1-4])\)\s*$/);
    return m?'<span class="tag cat cq-'+m[2]+'"><b>'+m[2]+'</b>'+esc(m[1])+'</span>':'<span class="tag cat">'+esc(c)+'</span>';
  }).join('');
}

/* ---- Shareable filter URLs: journal filters <-> location.hash ----
   Only non-default values are written, so the default view keeps a clean URL. */
function stateToHash(){
  const p=new URLSearchParams();
  if(state.q) p.set('s',state.q);
  const f=[...state.fees].sort().join(',');
  if(f!=='dia') p.set('f',f);
  const qt=[...state.quarts].map(v=>v||'none').sort().join(',');
  if(qt!=='Q1,Q2,Q3,Q4,none') p.set('qt',qt);
  if(state.idxOnly) p.set('x','1');
  if(state.extra) p.set('e','1');
  if(state.area) p.set('a',state.area);
  if(state.weeks<52) p.set('w',state.weeks);
  if(state.maxUsd<APC_MAX) p.set('p',state.maxUsd);
  if(state.country) p.set('c',state.country);
  const so=state.sorts.map(x=>x.k+(x.d<0?'-':'')).join(',');
  if(so!==DEFAULT_SORTS.map(x=>x.k+(x.d<0?'-':'')).join(',')) p.set('o',so);
  return p.toString();
}
function syncHash(){
  if(!state) return;
  const h=stateToHash();
  history.replaceState(null,'',h?'#'+h:location.pathname+location.search);
}
function applyHash(){
  const h=location.hash.slice(1);
  if(!state || !h) return;
  const p=new URLSearchParams(h);
  const hasOpt=(sel,v)=>[...$(sel).options].some(o=>o.value===v);
  if(p.has('s')){ $('q').value=p.get('s'); state.q=p.get('s').toLowerCase().trim(); classifyQuery(); }
  if(p.has('f')) state.fees=new Set(p.get('f').split(',').filter(v=>v==='dia'||v==='apc'));
  if(p.has('qt')) state.quarts=new Set(p.get('qt').split(',').filter(v=>['Q1','Q2','Q3','Q4','none'].includes(v)).map(v=>v==='none'?'':v));
  if(p.has('x')){ state.idxOnly=p.get('x')!=='0'; $('idxOnly').checked=state.idxOnly; }
  if(p.has('e')){ state.extra=p.get('e')!=='0'; $('extraOn').checked=state.extra; }
  if(p.has('a') && hasOpt('area',p.get('a'))){ state.area=p.get('a'); $('area').value=state.area; }
  if(p.has('w')){ const w=parseInt(p.get('w')); if(w>=0&&w<52){ state.weeks=w; $('weeks').value=w; $('wkVal').textContent='≤ '+w+'w'; } }
  if(p.has('p')){ const v=parseInt(p.get('p')); if(v>=0&&v<APC_MAX){ state.maxUsd=v; $('apc').value=v; $('apcVal').textContent=apcLabel(v); } }
  if(p.has('c') && hasOpt('country',p.get('c'))){ state.country=p.get('c'); $('country').value=state.country; }
  if(p.has('o')){ const ss=p.get('o').split(',').map(t=>{const m=t.match(/^([a-z]+)(-?)$/);return m&&SORT_KEYS[m[1]]?{k:m[1],d:m[2]?-1:1}:null;}).filter(Boolean);
    if(ss.length) state.sorts=ss; }
  if(p.has('s')) $('lq').value=$('q').value;
  document.querySelectorAll('#fchips .chip').forEach(ch=>ch.classList.toggle('on',state.fees.has(ch.dataset.f)));
  document.querySelectorAll('#qchips .chip').forEach(ch=>ch.classList.toggle('on',state.quarts.has(ch.dataset.q==='none'?'':ch.dataset.q)));
}

/* ---- CSV export of the current filtered view ---- */
function apcLabel(v){ return v>=APC_MAX?t('Any'):(v===0?t('Free only'):'≤ $'+v.toLocaleString()); }
const CSV_HEAD=['Title','ISSN','Fees','APC','APC approx USD','Quartile','SJR','H-index','Weeks to publication','Publisher','Country','Languages','Areas','Categories','Journal URL','DOAJ URL'];
const csvRow=r=>[r.t,r.issn,r.dia?'Diamond (free)':'Has fees',r.fee,r.usd??'',(r.idx?r.q:'')||'',r.sjr??'',r.h??'',r.w??'',r.pub,r.c,r.lang,r.areas,r.cats,r.url,r.doaj];
/* head: column names; rows: arrays of cells; name: file prefix. Shared by the Journals and AI match exports. */
function downloadCSV(head,rows,name){
  const cell=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  const lines=[head.join(','),...rows.map(r=>r.map(cell).join(','))];
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}); // BOM so Excel opens UTF-8 correctly
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name+'-'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportCSV(){ downloadCSV(CSV_HEAD,R.filter(match).sort(sortRecs).map(csvRow),'oa-journals'); }

function switchTab(tab){
  document.querySelectorAll('.tabbar button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  for(const t of ['j','a','c','s']){
    $('side-'+t).style.display = t===tab?'block':'none';
    $('main-'+t).style.display = t===tab?'block':'none';
  }
  if(tab==='c'){ if(csrc==='ma') loadMa(); else loadConfs(); }
  if(tab==='s') renderScopus();
  if(tab==='a'){ renderAI(); if(R.length) aiWarmUp(); }   // start fetching the model + vectors now, so they're ready by the time the abstract is pasted
  if((tab==='j'||tab==='a') && !R.length){
    // no journal data yet - go back to the loader to get some
    $('app').style.display='none'; document.body.classList.remove('app-open'); $('guide').style.display='';
    $('loader').classList.remove('waiting');
    $('loader').style.display='flex';
  }
}
document.querySelectorAll('.tabbar button').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

/* Sidebar link to the generated subject pages (/subjects/<area>/); follows the area filter. */
const areaSlug=a=>a.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function syncSubjLink(){
  const el=$('subjLink'); if(!el) return;
  const a=state&&state.area;
  el.href=a?'/subjects/'+areaSlug(a)+'/':'/subjects/';
  el.querySelector('b').textContent=a?t('{a}: ranked page',{a}):t('Browse journals by subject');
  el.querySelector('small').textContent=a?t('Counts, Q1/Q2 share and the top 50 free-to-publish journals'):t('27 areas, each with counts and a ranked top 50');
}
function renderSortBar(){
  document.querySelectorAll('#sortbar button[data-k]').forEach(b=>{
    const i=state.sorts.findIndex(x=>x.k===b.dataset.k);
    b.classList.toggle('on',i>=0);
    b.innerHTML=(i>=0?'<span class="pri">'+(i+1)+'</span>':'')+t(SORT_KEYS[b.dataset.k].label)+(i>=0?' <span class="dir">'+(state.sorts[i].d<0?'↓':'↑')+'</span>':'');
  });
  document.body.classList.toggle('has-sort',state.sorts.length>0);
  $('sorthint').textContent=state.sorts.length?state.sorts.map(x=>t(SORT_KEYS[x.k].label)+(x.d<0?' ↓':' ↑')).join(t(', then ')):t('default: best quartile first');
}
function startApp(data,stamp,tab){
  document.body.classList.add('app-open'); $('guide').style.display='none';
  $('loader').style.display='none';
  $('app').style.display='block';
  if(data){
    R=data.records;
    S=data.sci||[];
    // reference "current" year = the newest coverage-end year reached by a
    // meaningful share of journals (ignores a handful of stray future years)
    const endCounts={};
    for(const s of S){ const e=covEnd(s.cov); if(e!=null) endCounts[e]=(endCounts[e]||0)+1; }
    const thresh=Math.max(20,S.length*0.01);
    sciRef=Math.max(...Object.keys(endCounts).filter(y=>endCounts[y]>=thresh).map(Number));
    $('sciStamp').textContent=stamp;
    $('dataStamp').textContent=stamp;
    renderStats();

    const areaSel=$('area'); areaSel.innerHTML='<option value="" data-i18n>'+t('All areas')+'</option>';
    data.areas.forEach(a=>{const o=document.createElement('option');o.value=a;o.textContent=a;areaSel.appendChild(o);});
    const aSel=$('aiArea'); aSel.innerHTML='<option value="" data-i18n>'+t('Any subject area')+'</option>';
    data.areas.forEach(a=>{const o=document.createElement('option');o.value=a;o.textContent=a;aSel.appendChild(o);});
    const cSel=$('country'); cSel.innerHTML='<option value="" data-i18n>'+t('All countries')+'</option>';
    const cc={}; R.forEach(r=>{if(r.c)cc[r.c]=(cc[r.c]||0)+1;});
    Object.keys(cc).sort((a,b)=>cc[b]-cc[a]).forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c+' ('+cc[c]+')';cSel.appendChild(o);});

    state={q:'',fees:new Set(['dia']),quarts:new Set(['Q1','Q2','Q3','Q4','']),idxOnly:false,extra:false,area:'',weeks:52,maxUsd:APC_MAX,country:'',sorts:DEFAULT_SORTS.map(x=>({...x})),limit:60};
    applyHash();   // restore filters from a shared link, if any
    syncSubjLink(); renderSortBar();
  }
  bindOnce();
  // #tab=c / #tab=s in the URL (links from the subject pages) wins over the default tab
  const hashTab=new URLSearchParams(location.hash.slice(1)).get('tab');
  switchTab(tab||(['j','a','c','s'].includes(hashTab)?hashTab:'j'));
  if(data) render();
  loadScopusStatus();
}

/* sidebar counters (Journals + Scopus tabs); re-run on language switch so the number format follows the language */
function renderStats(){
  if(!R.length) return;
  $('s-src').textContent=S.length.toLocaleString();
  $('s-act').textContent=S.filter(s=>covActive(s.cov)).length.toLocaleString();
  $('s-total').textContent=R.length.toLocaleString();
  $('s-idx').textContent=R.filter(r=>r.dia).length.toLocaleString();
  $('s-q12').textContent=R.filter(r=>r.q==='Q1'||r.q==='Q2').length.toLocaleString();
  setExtraCount(R.filter(r=>r.src).length);
}
/* count + visibility of the "Include journals not in DOAJ" toggles (Journals and AI sidebars) */
function setExtraCount(n){
  document.querySelectorAll('.s-extra').forEach(el=>el.textContent=n.toLocaleString());
  document.querySelectorAll('.extraGrp').forEach(el=>el.style.display=n?'':'none');
}
let bound=false;
function bindOnce(){
  if(bound) return; bound=true;
  document.querySelectorAll('#qchips .chip').forEach(ch=>{
    ch.addEventListener('click',()=>{
      const key=ch.dataset.q==='none'?'':ch.dataset.q;
      ch.classList.toggle('on');
      if(ch.classList.contains('on')) state.quarts.add(key); else state.quarts.delete(key);
      state.limit=60; render();
    });
  });
  document.querySelectorAll('#fchips .chip').forEach(ch=>{
    ch.addEventListener('click',()=>{
      ch.classList.toggle('on');
      if(ch.classList.contains('on')) state.fees.add(ch.dataset.f); else state.fees.delete(ch.dataset.f);
      state.limit=60; render();
    });
  });
  const setQuery=(v,src)=>{ if(src!=='q') $('q').value=v; if(src!=='lq') $('lq').value=v; state.q=v.toLowerCase().trim(); classifyQuery(); state.limit=60; render(); };
  $('q').addEventListener('input',e=>setQuery(e.target.value,'q'));
  $('lq').addEventListener('input',e=>setQuery(e.target.value,'lq'));
  $('idxOnly').addEventListener('change',e=>{state.idxOnly=e.target.checked;state.limit=60;render();});
  $('extraOn').addEventListener('change',e=>{state.extra=e.target.checked;state.limit=60;render();});
  $('area').addEventListener('change',e=>{state.area=e.target.value;state.limit=60;render();syncSubjLink();});
  $('country').addEventListener('change',e=>{state.country=e.target.value;state.limit=60;render();});
  $('sortClear').addEventListener('click',()=>{ state.sorts=[]; renderSortBar(); render(); });
  // Sidebar: collapsible on desktop (preference remembered); off-canvas drawer on mobile (closed by default)
  const mobile=()=>window.matchMedia('(max-width:860px)').matches;
  $('sideToggle').addEventListener('click',()=>{
    const hid=document.body.classList.toggle('side-hidden');
    if(!mobile()){ try{ localStorage.setItem('sideHidden',hid?'1':''); }catch(e){} }
  });
  $('sideBackdrop').addEventListener('click',()=>document.body.classList.add('side-hidden'));
  if(mobile()) document.body.classList.add('side-hidden');
  else{ try{ if(localStorage.getItem('sideHidden')==='1') document.body.classList.add('side-hidden'); }catch(e){} }
  // switching tabs keeps the drawer open on mobile: the user usually wants to set filters next
  $('sortbar').addEventListener('click',e=>{
    const b=e.target.closest('button[data-k]'); if(!b) return;
    const k=b.dataset.k, i=state.sorts.findIndex(x=>x.k===k);
    if(i<0) state.sorts.push({k,d:SORT_KEYS[k].def});               // 1st click: add with its natural direction
    else if(state.sorts[i].d===SORT_KEYS[k].def) state.sorts[i].d*=-1;   // 2nd: reverse
    else state.sorts.splice(i,1);                                    // 3rd: remove
    renderSortBar(); render();
  });
  $('weeks').addEventListener('input',e=>{
    state.weeks=+e.target.value;
    $('wkVal').textContent=state.weeks>=52?t('Any'):'≤ '+state.weeks+'w';
    state.limit=60; render();
  });
  $('apc').addEventListener('input',e=>{
    state.maxUsd=+e.target.value;
    $('apcVal').textContent=apcLabel(state.maxUsd);
    state.limit=60; render();
  });
  $('resetBtn').addEventListener('click',()=>{
    state={q:'',fees:new Set(['dia']),quarts:new Set(['Q1','Q2','Q3','Q4','']),idxOnly:false,extra:false,area:'',weeks:52,maxUsd:APC_MAX,country:'',sorts:DEFAULT_SORTS.map(x=>({...x})),limit:60};
    $('q').value='';$('lq').value='';renderSortBar();$('idxOnly').checked=false;$('extraOn').checked=false;$('area').value='';syncSubjLink();$('country').value='';
    $('weeks').value=52;$('wkVal').textContent=t('Any');
    $('apc').value=APC_MAX;$('apcVal').textContent=t('Any');
    document.querySelectorAll('#qchips .chip').forEach(ch=>ch.classList.add('on'));
    document.querySelectorAll('#fchips .chip').forEach(ch=>ch.classList.toggle('on',ch.dataset.f==='dia'));
    render();
  });
  $('reload').addEventListener('click',()=>{
    files.doaj=files.sci=null;
    ['slot-doaj','slot-sci'].forEach(id=>$(id).classList.remove('ok'));
    $('slot-doaj-s').textContent=t('waiting…'); $('slot-sci-s').textContent=t('waiting…');
    status('');
    $('app').style.display='none'; document.body.classList.remove('app-open'); $('guide').style.display=''; $('loader').classList.remove('waiting'); $('loader').style.display='flex';
    $('cacheNote').style.display='none';
    $('backToApp').style.display='inline-block';   // current data stays loaded - one click back
  });
  $('exportBtn').addEventListener('click',exportCSV);
  $('shareBtn').addEventListener('click',async()=>{
    syncHash();
    const btn=$('shareBtn'), old=btn.textContent;
    try{ await navigator.clipboard.writeText(location.href); }
    catch(e){ prompt(t('Copy this link:'),location.href); return; }
    btn.textContent=t('✓ Link copied'); btn.classList.add('done');
    setTimeout(()=>{ btn.textContent=old; btn.classList.remove('done'); },1600);
  });
  $('sq').addEventListener('input',renderScopus);
  // per-journal Scopus popup (event delegation over the list)
  $('list').addEventListener('click',e=>{
    const btn=e.target.closest('.scopus-btn');
    if(btn) openScopusModal(btn.dataset.issn,btn.dataset.title);
  });
  $('modalX').addEventListener('click',closeModal);
  $('modal').addEventListener('click',e=>{ if(e.target===$('modal')) closeModal(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && $('modal').style.display!=='none') closeModal(); });
  bindConfsOnce();
  bindAI();
  // language switch: re-render everything JS generates
  I18N.onChange(()=>{
    renderStats();
    if(state){ renderSortBar(); syncSubjLink(); $('wkVal').textContent=state.weeks>=52?t('Any'):'≤ '+state.weeks+'w'; $('apcVal').textContent=apcLabel(state.maxUsd); render(); }
    if(typeof setSrc==='function' && $('main-c').style.display!=='none') setSrc(csrc);
    else if(typeof applyStats==='function') applyStats();
    if($('main-s').style.display!=='none') renderScopus();
    if($('main-a').style.display!=='none') renderAI();
  });
}
