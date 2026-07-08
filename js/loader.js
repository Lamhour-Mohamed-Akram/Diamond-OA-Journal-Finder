/* ================= Loader UI ================= */
const files={doaj:null,sci:null};
const $=id=>document.getElementById(id);
const status=(msg,err)=>{ const el=$('status'); el.textContent=msg; el.classList.toggle('err',!!err); };

function readFile(f){ return new Promise((res,rej)=>{ const r=new FileReader();
  r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('Could not read '+f.name)); r.readAsText(f,'utf-8'); });}

async function ingest(fileList){
  for(const f of fileList){
    status('Reading '+f.name+'…');
    let text;
    try{ text=await readFile(f); }catch(e){ status(e.message,true); continue; }
    const nl=text.indexOf('\n');
    const firstLine=text.slice(0, nl>0?nl:Math.min(text.length,5000));
    const delim=sniffDelim(firstLine);
    const header=parseCSV(firstLine,delim)[0]||[];
    const kind=detectKind(header);
    if(kind==='doaj'){ files.doaj={name:f.name,text,delim}; $('slot-doaj').classList.add('ok'); $('slot-doaj-s').textContent=f.name; }
    else if(kind==='sci'){ files.sci={name:f.name,text,delim}; $('slot-sci').classList.add('ok'); $('slot-sci-s').textContent=f.name; }
    else { status('“'+f.name+'” doesn’t look like a DOAJ or SCImago CSV — check the file.',true); }
  }
  if(files.doaj && files.sci) processAll();
  else if(files.doaj||files.sci) status(files.sci?'SCImago loaded ✓ — now drop the DOAJ CSV (step 1).':'DOAJ loaded ✓ — now drop the SCImago CSV (step 2).');
}

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
    await cacheSet('dataset4',{data,stamp,ts:Date.now()});
    startApp(data,stamp);
  }catch(e){ status(e.message,true); }
}

const dz=$('dz');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');ingest([...e.dataTransfer.files]);});
$('fileInput').addEventListener('change',e=>ingest([...e.target.files]));

$('confOnly').addEventListener('click',()=>startApp(null,null,'c'));

cacheGet('dataset4').then(c=>{
  if(c && c.data){
    $('cacheNote').style.display='block';
    $('cacheDate').textContent=c.stamp;
    $('useCache').onclick=()=>startApp(c.data,c.stamp);
  }
});
