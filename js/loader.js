/* ================= Loader UI ================= */
const files={doaj:null,sci:null};
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
          wait.progress(0,'Starting…'); },
  hide(){ $('loader').classList.remove('waiting'); },
  on(){ return $('loader').classList.contains('waiting'); },
  step(k,state,note){ const li=$('ws-'+k); if(!li) return; li.classList.remove('active','done'); if(state) li.classList.add(state);
          if(note!=null){ const n=li.querySelector('em'); if(n) n.textContent=note; } },
  progress(pct,msg){ $('wfill').style.width=Math.max(0,Math.min(100,pct))+'%'; if(msg) status(msg); },
};
$('waitManual').addEventListener('click',()=>{ files.manual=true; wait.hide(); status(''); });
$('waitConf').addEventListener('click',()=>startApp(null,null,'c'));

function readFile(f){ return new Promise((res,rej)=>{ const r=new FileReader();
  r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('Could not read '+f.name)); r.readAsText(f,'utf-8'); });}

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
  return kind;
}

async function ingest(fileList){
  files.manual=true;   // user-provided files take priority over the auto background load
  for(const f of fileList){
    status('Reading '+f.name+'…');
    let text;
    try{ text=await readFile(f); }catch(e){ status(e.message,true); continue; }
    if(!registerText(f.name,text)) status('“'+f.name+'” doesn’t look like a DOAJ or SCImago CSV, check the file.',true);
  }
  if(files.doaj && files.sci) processAll();
  else if(files.doaj||files.sci) status(files.sci?'SCImago loaded ✓. Now drop the DOAJ CSV (step 1).':'DOAJ loaded ✓. Now drop the SCImago CSV (step 2).');
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

async function fetchBundled(url,label,fallback,onProgress){
  let res=null;
  try{ res=await fetch(url); }catch(e){}
  if((!res || !res.ok) && fallback){ res=await fetch(fallback); }
  if(!res || !res.ok) throw new Error('Couldn’t load the built-in '+label+(res?' ('+res.status+')':'')+'. You can still load the files manually below.');
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
    status('Downloading '+label+'… '+(got/1048576).toFixed(1)+' MB');
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
      wait.step(b.key,'active'); wait.progress(b.from,'Downloading '+b.label+'…');
      const {text,lastMod}=await fetchBundled(b.url,b.label,b.fallback,(got,total)=>{
        const known=total&&got<=total; const size=known?total:EXPECT[b.key]; const frac=Math.min(0.98,got/size);
        wait.progress(b.from+(b.to-b.from)*frac);
        wait.step(b.key,'active',(got/1048576).toFixed(1)+(known?' / '+(total/1048576).toFixed(1):'')+' MB');
      });
      if(files.manual) return;
      const date=lastMod? new Date(lastMod).toLocaleDateString() : '';
      const name=b.label+' (built-in'+(date?', '+date:'')+')';
      if(!registerText(name,text)) throw new Error('The built-in '+b.label+' file looks corrupted; load the files manually below.');
      wait.step(b.key,'done',(text.length/1048576).toFixed(1)+' MB'+(date?' · '+date:'')); wait.progress(b.to);
    }
    if(files.doaj && files.sci) await processAll();
  }catch(e){ wait.hide(); status(e.message,true); }
  finally{ btn.disabled=false; }
}
$('useBundled').addEventListener('click',loadBundled);
$('backToApp').addEventListener('click',()=>{
  wait.hide();
  $('loader').style.display='none';
  $('app').style.display='block';
});

async function processAll(){
  try{
    if(wait.on()){ wait.step('parse','active'); wait.progress(80); }
    status('Parsing DOAJ file… (large file, a few seconds)');
    await new Promise(r=>setTimeout(r,30));
    const doajRows=parseCSV(files.doaj.text, files.doaj.delim);
    const inters=doajCsvToInters(doajRows);
    if(wait.on()) wait.progress(88);
    status('Parsing SCImago file…');
    await new Promise(r=>setTimeout(r,30));
    const sciRows=parseCSV(files.sci.text, files.sci.delim);
    if(wait.on()) wait.progress(94);
    status('Joining on ISSN…');
    await new Promise(r=>setTimeout(r,30));
    const data=assemble(inters,sciRows);
    if(data.meta.total===0) throw new Error('Join produced 0 Diamond journals. Are these the right files?');
    if(wait.on()){ wait.step('parse','done',data.meta.total.toLocaleString()+' journals'); wait.step('done','active'); wait.progress(98,'Saving on this device and opening…'); }
    const stamp=new Date().toLocaleDateString()+' · '+files.doaj.name+' + '+files.sci.name;
    await cacheSet('dataset8',{data,stamp,ts:Date.now()});
    cacheDel('dataset4'); cacheDel('dataset5'); cacheDel('dataset6'); cacheDel('dataset7');   // superseded cache formats
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

cacheGet('dataset8').then(c=>{
  if(c && c.data){
    $('cacheNote').style.display='block';
    $('cacheDate').textContent=c.stamp;
    $('useCache').onclick=()=>startApp(c.data,c.stamp);
    startApp(c.data,c.stamp);   // returning visitor - straight into the app
  } else {
    loadBundled();              // first visit - fetch the built-in data right away
  }
});
