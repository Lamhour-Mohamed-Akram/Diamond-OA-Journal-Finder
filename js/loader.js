/* ================= Loader UI ================= */
const files={doaj:null,sci:null,extra:null};
const $=id=>document.getElementById(id);
const status=(msg,err)=>{ const el=$('status'); el.textContent=msg; el.classList.toggle('err',!!err);
  const w=$('wmsg'); if(w && msg){ w.textContent=msg; w.classList.toggle('err',!!err); } };

/* ---- Wait screen ----
   First visit: a progress page while the built-in data downloads and is
   matched. The manual-load instructions (.load-card) stay hidden unless
   the automatic load fails or the visitor asks for them. */
const EXPECT={doaj:25391034, sci:10876846};   // fallback sizes when Content-Length is missing
const wait={
  show(){ $('loader').classList.add('waiting'); $('loader').style.display='flex';
          ['doaj','sci','parse','done'].forEach(k=>{ const li=$('ws-'+k); li.classList.remove('active','done'); const n=li.querySelector('em'); if(n) n.textContent=''; });
          wait.progress(0,t('Starting…')); },
  hide(){ $('loader').classList.remove('waiting'); },
  on(){ return $('loader').classList.contains('waiting'); },
  step(k,state,note){ const li=$('ws-'+k); if(!li) return; li.classList.remove('active','done'); if(state) li.classList.add(state);
          if(note!=null){ const n=li.querySelector('em'); if(n) n.textContent=note; } },
  progress(pct,msg){ $('wfill').style.width=Math.max(0,Math.min(100,pct))+'%'; if(msg) status(msg); },
};
$('waitManual').addEventListener('click',()=>{ files.manual=true; wait.hide(); status(''); });
$('waitConf').addEventListener('click',()=>startApp(null,null,'c'));

function readFile(f){ return new Promise((res,rej)=>{ const r=new FileReader();
  r.onload=()=>res(r.result); r.onerror=()=>rej(new Error(t('Could not read {f}',{f:f.name}))); r.readAsText(f,'utf-8'); });}

/* Detect DOAJ vs SCImago from the header row and register the file.
   Shared by the drag-and-drop path and the built-in one-click load. */
function registerText(name, text){
  const nl=text.indexOf('\n');
  const firstLine=text.slice(0, nl>0?nl:Math.min(text.length,5000));
  const delim=sniffDelim(firstLine);
  const header=parseCSV(firstLine,delim)[0]||[];
  const kind=detectKind(header);
  if(kind==='doaj'){ files.doaj={name,text,delim}; $('slot-doaj').classList.add('ok'); $('slot-doaj-s').textContent=name; }
  else if(kind==='sci'){ files.sci={name,text,delim}; $('slot-sci').classList.add('ok'); $('slot-sci-s').textContent=name; }
  else if(kind==='extra'){ files.extra={name,text,delim}; }
  return kind;
}

async function ingest(fileList){
  files.manual=true;   // user-provided files take priority over the auto background load
  for(const f of fileList){
    status(t('Reading {f}…',{f:f.name}));
    let text;
    try{ text=await readFile(f); }catch(e){ status(e.message,true); continue; }
    if(!registerText(f.name,text)) status(t('“{f}” doesn’t look like a DOAJ or SCImago CSV, check the file.',{f:f.name}),true);
  }
  if(files.doaj && files.sci) processAll();
  else if(files.doaj||files.sci) status(files.sci?t('SCImago loaded ✓. Now drop the DOAJ CSV (step 1).'):t('DOAJ loaded ✓. Now drop the SCImago CSV (step 2).'));
}

/* ---- Built-in snapshots ----
   Served from the GitHub repo (free bandwidth, gzip, CORS) so visitors
   don't consume Netlify bandwidth; the copy deployed with the site is
   only the fallback. Data refreshes reach users as soon as the refresh
   workflow commits - no redeploy needed. */
const GH_DATA='https://raw.githubusercontent.com/Lamhour-Mohamed-Akram/Diamond-OA-Journal-Finder/main/';
const BUNDLED=[
  {key:'doaj', url:GH_DATA+'data/doaj.csv',    fallback:'data/doaj.csv',    label:'DOAJ journal list', from:0,  to:55},
  {key:'sci',  url:GH_DATA+'data/scimago.csv', fallback:'data/scimago.csv', label:'SCImago rankings',  from:55, to:80},
];

/* Small optional file: community-verified journals not in DOAJ. Never blocks
   the app - if it can't be fetched the list is simply DOAJ-only. */
async function fetchExtra(){
  if(files.extra) return;
  for(const u of [GH_DATA+'data/extra-journals.csv','data/extra-journals.csv']){
    try{ const r=await fetch(u); if(r.ok){ const text=await r.text(); if(registerText('extra-journals.csv',text)==='extra') return; } }catch(e){}
  }
}
async function fetchBundled(url,label,fallback,onProgress){
  let res=null;
  try{ res=await fetch(url); }catch(e){}
  if((!res || !res.ok) && fallback){ res=await fetch(fallback); }
  if(!res || !res.ok) throw new Error(t('Couldn’t load the built-in {l}{s}. You can still load the files manually below.',{l:t(label),s:res?' ('+res.status+')':''}));
  const lastMod=res.headers.get('last-modified');
  if(!res.body || !res.body.getReader) return {text:await res.text(), lastMod};
  // Content-Length is the compressed size when the transfer is gzipped, so it can't be trusted then
  const total=res.headers.get('content-encoding')?0:(+res.headers.get('content-length')||0);
  const reader=res.body.getReader();
  const chunks=[]; let got=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done) break;
    chunks.push(value); got+=value.length;
    status(t('Downloading {l}… {mb} MB',{l:t(label),mb:(got/1048576).toFixed(1)}));
    if(onProgress) onProgress(got,total);
  }
  const buf=new Uint8Array(got); let off=0;
  for(const c of chunks){ buf.set(c,off); off+=c.length; }
  return {text:new TextDecoder('utf-8').decode(buf), lastMod};
}

async function loadBundled(){
  const btn=$('useBundled'); btn.disabled=true;
  files.manual=false; wait.show();
  try{
    for(const b of BUNDLED){
      if(files.manual) return;   // user started dropping their own files - stand down
      wait.step(b.key,'active'); wait.progress(b.from,t('Downloading {l}…',{l:t(b.label)}));
      const {text,lastMod}=await fetchBundled(b.url,b.label,b.fallback,(got,total)=>{
        // cross-origin fetches hide Content-Encoding, so a gzipped transfer reports the compressed size: only trust a total in the ballpark of the known file size
        const known=total>EXPECT[b.key]*0.6&&got<=total; const size=known?total:EXPECT[b.key]; const frac=Math.min(0.98,got/size);
        wait.progress(b.from+(b.to-b.from)*frac);
        wait.step(b.key,'active',(got/1048576).toFixed(1)+(known?' / '+(total/1048576).toFixed(1):'')+t(' MB'));
      });
      if(files.manual) return;
      const date=lastMod? new Date(lastMod).toLocaleDateString() : '';
      const name=t(b.label)+' ('+t('built-in')+(date?', '+date:'')+')';
      if(!registerText(name,text)) throw new Error(t('The built-in {l} file looks corrupted; load the files manually below.',{l:t(b.label)}));
      wait.step(b.key,'done',(text.length/1048576).toFixed(1)+t(' MB')+(date?' · '+date:'')); wait.progress(b.to);
    }
    if(files.doaj && files.sci) await processAll();
  }catch(e){ wait.hide(); status(e.message,true); }
  finally{ btn.disabled=false; }
}
$('useBundled').addEventListener('click',loadBundled);
$('backToApp').addEventListener('click',()=>{
  wait.hide();
  $('loader').style.display='none';
  document.body.classList.add('app-open'); $('guide').style.display='none';   // same as startApp
  $('app').style.display='block';
});

async function processAll(){
  try{
    if(wait.on()){ wait.step('parse','active'); wait.progress(80); }
    status(t('Parsing DOAJ file… (large file, a few seconds)'));
    await new Promise(r=>setTimeout(r,30));
    const doajRows=parseCSV(files.doaj.text, files.doaj.delim);
    const inters=doajCsvToInters(doajRows);
    await fetchExtra();
    if(files.extra){
      // skip anything DOAJ already lists (by ISSN) so a journal accepted into DOAJ later never shows twice
      const have=new Set(); inters.forEach(it=>[it.pissn,it.eissn].map(normISSN).filter(Boolean).forEach(n=>have.add(n)));
      const extra=extraCsvToInters(parseCSV(files.extra.text,files.extra.delim))
        .filter(it=>![it.pissn,it.eissn].map(normISSN).filter(Boolean).some(n=>have.has(n)));
      inters.push(...extra);
    }
    if(wait.on()) wait.progress(88);
    status(t('Parsing SCImago file…'));
    await new Promise(r=>setTimeout(r,30));
    const sciRows=parseCSV(files.sci.text, files.sci.delim);
    if(wait.on()) wait.progress(94);
    status(t('Joining on ISSN…'));
    await new Promise(r=>setTimeout(r,30));
    const data=assemble(inters,sciRows);
    if(data.meta.total===0) throw new Error(t('Join produced 0 Diamond journals. Are these the right files?'));
    if(wait.on()){ wait.step('parse','done',t('{n} journals',{n:data.meta.total.toLocaleString()})); wait.step('done','active'); wait.progress(98,t('Saving on this device and opening…')); }
    const stamp=new Date().toLocaleDateString()+' · '+files.doaj.name+' + '+files.sci.name;
    await cacheSet('dataset11',{data,stamp,ts:Date.now(),extraHash:files.extra?hashText(files.extra.text):''});
    cacheDel('dataset5'); cacheDel('dataset6'); cacheDel('dataset7'); cacheDel('dataset8'); cacheDel('dataset9'); cacheDel('dataset10');   // superseded cache formats
    if(wait.on()){ wait.step('done','done'); wait.progress(100); await new Promise(r=>setTimeout(r,250)); }
    startApp(data,stamp);
  }catch(e){ wait.hide(); status(e.message,true); }
}

const dz=$('dz');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');ingest([...e.dataTransfer.files]);});
$('fileInput').addEventListener('change',e=>ingest([...e.target.files]));

$('confOnly').addEventListener('click',()=>startApp(null,null,'c'));

/* ---- Keep community-verified journals fresh for returning visitors ----
   The DOAJ/SCImago snapshot stays cached (25 MB), but extra-journals.csv is
   tiny, so it is re-fetched on every visit. If it changed since the cache
   was written, the community records are rebuilt in place (no SCImago join
   needed - these journals are not in SCImago), the cache is updated and the
   list re-renders. Silent on any failure. */
function hashText(t){ let h=0; for(let i=0;i<t.length;i++){ h=(h*31+t.charCodeAt(i))|0; } return t.length+':'+h; }
async function refreshExtra(c){
  try{
    let text=null;
    for(const u of [GH_DATA+'data/extra-journals.csv','data/extra-journals.csv']){
      try{ const r=await fetch(u,{cache:'no-cache'}); if(r.ok){ text=await r.text(); break; } }catch(e){}
    }
    if(text==null) return;
    const h=hashText(text);
    if(h===c.extraHash) return;
    const rows=parseCSV(text,sniffDelim(text.slice(0,text.indexOf('\n'))));
    if(detectKind(rows[0])!=='extra') return;
    const data=c.data;
    const have=new Set(); data.records.forEach(r=>{ if(!r.src) (r.issns||[]).forEach(n=>have.add(n)); });
    const fresh=extraCsvToInters(rows)
      .filter(it=>![it.pissn,it.eissn].map(normISSN).filter(Boolean).some(n=>have.has(n)))
      .map(it=>({t:it.t, idx:false, q:'', sjr:null, h:null, cats:'', areas:'', w:it.w, dia:it.dia, fee:it.fee, usd:it.usd,
        issn:normISSN(it.eissn)||normISSN(it.pissn)||'', issns:[normISSN(it.pissn),normISSN(it.eissn)].filter(Boolean),
        rev:it.rev, pub:it.pub, c:it.c, lang:it.lang, dsub:it.dsub, url:it.url, doaj:'', kw:it.kw,
        src:it.src, ver:it.ver, note:it.note, ev:it.ev, alt:'', acr:acronyms(it.t,it.url)}));
    data.records=data.records.filter(r=>!r.src).concat(fresh);
    data.meta.total=data.records.length; data.meta.dia=data.records.filter(r=>r.dia).length; data.meta.extra=fresh.length;
    await cacheSet('dataset11',{...c,data,extraHash:h});
    if(typeof R!=='undefined' && R.length){ R=data.records; renderStats(); if(state) render(); }
  }catch(e){ console.warn('extra-journals refresh skipped',e); }
}

cacheGet('dataset11').then(c=>{
  if(c && c.data){
    $('cacheNote').style.display='block';
    $('cacheDate').textContent=c.stamp;
    $('useCache').onclick=()=>startApp(c.data,c.stamp);
    startApp(c.data,c.stamp);   // returning visitor - straight into the app
    refreshExtra(c);            // …then quietly pick up any new community-verified journals
  } else {
    loadBundled();              // first visit - fetch the built-in data right away
  }
});
