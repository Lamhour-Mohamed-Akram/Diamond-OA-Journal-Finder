/* ================= Loader UI ================= */
const files={doaj:null,sci:null};
const $=id=>document.getElementById(id);
const status=(msg,err)=>{ const el=$('status'); el.textContent=msg; el.classList.toggle('err',!!err); };

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
    if(!registerText(f.name,text)) status('“'+f.name+'” doesn’t look like a DOAJ or SCImago CSV — check the file.',true);
  }
  if(files.doaj && files.sci) processAll();
  else if(files.doaj||files.sci) status(files.sci?'SCImago loaded ✓ — now drop the DOAJ CSV (step 1).':'DOAJ loaded ✓ — now drop the SCImago CSV (step 2).');
}

/* ---- Built-in snapshots (served with the site from /data) ---- */
const BUNDLED=[
  {url:'data/doaj.csv',    label:'DOAJ journal list'},
  {url:'data/scimago.csv', label:'SCImago rankings'},
];

async function fetchBundled(url,label){
  const res=await fetch(url);
  if(!res.ok) throw new Error('Couldn’t load the built-in '+label+' ('+res.status+'). You can still load the files manually below.');
  const lastMod=res.headers.get('last-modified');
  if(!res.body || !res.body.getReader) return {text:await res.text(), lastMod};
  const reader=res.body.getReader();
  const chunks=[]; let got=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done) break;
    chunks.push(value); got+=value.length;
    status('Downloading '+label+'… '+(got/1048576).toFixed(1)+' MB');
  }
  const buf=new Uint8Array(got); let off=0;
  for(const c of chunks){ buf.set(c,off); off+=c.length; }
  return {text:new TextDecoder('utf-8').decode(buf), lastMod};
}

async function loadBundled(){
  const btn=$('useBundled'); btn.disabled=true;
  try{
    for(const b of BUNDLED){
      if(files.manual) return;   // user started dropping their own files — stand down
      status('Downloading '+b.label+'…');
      const {text,lastMod}=await fetchBundled(b.url,b.label);
      if(files.manual) return;
      const date=lastMod? new Date(lastMod).toLocaleDateString() : '';
      const name=b.label+' (built-in'+(date?', '+date:'')+')';
      if(!registerText(name,text)) throw new Error('The built-in '+b.label+' file looks corrupted — load the files manually below.');
    }
    if(files.doaj && files.sci) await processAll();
  }catch(e){ status(e.message,true); }
  finally{ btn.disabled=false; }
}
$('useBundled').addEventListener('click',loadBundled);
$('backToApp').addEventListener('click',()=>{
  $('loader').style.display='none';
  $('app').style.display='block';
});

async function processAll(){
  try{
    status('Parsing DOAJ file… (large file, a few seconds)');
    await new Promise(r=>setTimeout(r,30));
    const doajRows=parseCSV(files.doaj.text, files.doaj.delim);
    const inters=doajCsvToInters(doajRows);
    status('Parsing SCImago file…');
    await new Promise(r=>setTimeout(r,30));
    const sciRows=parseCSV(files.sci.text, files.sci.delim);
    status('Joining on ISSN…');
    await new Promise(r=>setTimeout(r,30));
    const data=assemble(inters,sciRows);
    if(data.meta.total===0) throw new Error('Join produced 0 Diamond journals — are these the right files?');
    const stamp=new Date().toLocaleDateString()+' · '+files.doaj.name+' + '+files.sci.name;
    await cacheSet('dataset5',{data,stamp,ts:Date.now()});
    cacheDel('dataset4');   // superseded cache format (kept HTML entities)
    startApp(data,stamp);
  }catch(e){ status(e.message,true); }
}

const dz=$('dz');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');ingest([...e.dataTransfer.files]);});
$('fileInput').addEventListener('change',e=>ingest([...e.target.files]));

$('confOnly').addEventListener('click',()=>startApp(null,null,'c'));

cacheGet('dataset5').then(c=>{
  if(c && c.data){
    $('cacheNote').style.display='block';
    $('cacheDate').textContent=c.stamp;
    $('useCache').onclick=()=>startApp(c.data,c.stamp);
    startApp(c.data,c.stamp);   // returning visitor — straight into the app
  } else {
    loadBundled();              // first visit — fetch the built-in data right away
  }
});
