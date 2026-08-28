/* ================= AI match (semantic journal recommender) =================
   100% client-side, 0 € to run: a tiny sentence-embedding model
   (all-MiniLM-L6-v2, int8 ONNX, ~23 MB, via Transformers.js from a CDN) turns
   the visitor's abstract into a 384-number vector right in the browser, which
   is compared with precomputed vectors of every DOAJ journal
   (data/embeddings.bin, built offline by scripts/build-embeddings.mjs from
   title + keywords + subjects + SCImago categories). Nothing is uploaded; the
   model and the vectors are cached on the device after the first use.

   Scoring lives in js/ai-score.js: the displayed percentage is topical
   relevance only (calibrated cosine); quartile / fees / keywords only affect
   the ORDER of journals that already passed the relevance threshold, after a
   discipline-compatibility gate. Filters (fee / quartile / indexed / area)
   restrict the candidates but never add relevance. */
const AI_CDN='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const AI_MODEL='Xenova/all-MiniLM-L6-v2';
const AI_EMB_KEY='emb1';                   // IndexedDB key (bump with the .bin layout)
const AI_EMB_TTL=15*86400e3;               // refetch after 15 days (data refresh cadence)
const AI_TOP=15;                            // shown at first; "Show more" adds 15 at a time
const AI_POOL=300;                          // best candidates by similarity that get the full score
const AI={extractor:null,emb:null,loading:null,results:null,ran:false,limit:AI_TOP};
let aiState={fees:new Set(['dia']),quarts:new Set(['Q1','Q2','Q3','Q4','']),idxOnly:false,extra:false,area:'',weeks:52,maxUsd:APC_MAX,sort:{k:'score',d:-1}};
const AI_SORT={score:{label:'Match',def:-1,val:x=>x.score},q:{label:'Quartile',def:1,val:x=>x.r.idx&&x.r.q?qRank[x.r.q]:null},sjr:{label:'SJR',def:-1,val:x=>x.r.sjr},h:{label:'H-index',def:-1,val:x=>x.r.h},w:{label:'Turnaround',def:1,val:x=>x.r.w},usd:{label:'Price',def:1,val:x=>x.r.usd},t:{label:'Title',def:1,val:x=>x.r.t.toLowerCase()}};

/* ---- loading: model (CDN + HF hub, browser-cached) and journal vectors (GitHub raw, IndexedDB-cached) ---- */
function aiProgress(pct,msg){
  const el=$('aiStatus'); if(!el) return;
  AI.status={pct,msg};
  el.style.display='block';
  el.innerHTML='<div class="aibar"><i style="width:'+Math.max(0,Math.min(100,pct))+'%"></i></div><span>'+esc(msg)+'</span>';
}
async function aiLoadEmbeddings(){
  const c=await cacheGet(AI_EMB_KEY);
  let buf=c&&c.buf&&(Date.now()-(c.ts||0)<AI_EMB_TTL)?c.buf:null;
  if(!buf){
    for(const url of [GH_DATA+'data/embeddings.bin','data/embeddings.bin']){
      try{ const r=await fetch(url); if(r.ok){ buf=await r.arrayBuffer(); break; } }catch(e){}
    }
    if(!buf){ if(c&&c.buf) buf=c.buf; else throw new Error(t('Couldn’t download the journal vectors (are you offline?). Try again in a moment.')); }
    else cacheSet(AI_EMB_KEY,{buf,ts:Date.now()});
  }
  const dv=new DataView(buf);
  if(String.fromCharCode(...new Uint8Array(buf,0,4))!=='OAE1') throw new Error('embeddings.bin: unknown format');
  const n=dv.getUint32(4,true), dim=dv.getUint32(8,true), scale=dv.getFloat32(12,true);
  const idBytes=new Uint8Array(buf,16,n*8);
  const ids=new Array(n);
  for(let i=0;i<n;i++) ids[i]=String.fromCharCode(...idBytes.subarray(i*8,i*8+8)).trim();
  return {n,dim,scale,ids,vec:new Int8Array(buf,16+n*8,n*dim)};
}
async function aiEnsure(){
  if(AI.extractor&&AI.emb) return;
  if(AI.loading) return AI.loading;
  AI.loading=(async()=>{
    try{
      aiProgress(2,t('Downloading the journal vectors…'));
      const embP=aiLoadEmbeddings();
      aiProgress(5,t('Loading the AI model (~23 MB, once)…'));
      const tf=await import(AI_CDN);
      tf.env.allowLocalModels=false;
      const seen={};
      AI.extractor=await tf.pipeline('feature-extraction',AI_MODEL,{dtype:'q8',progress_callback:p=>{
        if(p.status==='progress'&&p.file){ seen[p.file]=p.progress||0; const v=Object.values(seen); const avg=v.reduce((a,b)=>a+b,0)/v.length;
          aiProgress(5+avg*0.85,t('Loading the AI model… {p}%',{p:Math.round(avg)})); }
      }});
      AI.emb=await embP;
      aiProgress(100,t('Ready: {n} journals indexed. Everything stays on this device.',{n:AI.emb.n.toLocaleString()})); AI.status.ready=true;
    }catch(e){ AI.loading=null; AI.extractor=AI.extractor||null; throw e; }
  })();
  return AI.loading;
}

/* warm-up: kicked off when the AI tab is opened; errors are ignored here and
   reported properly if the visitor clicks "Find" anyway */
function aiWarmUp(){ if(AI.extractor&&AI.emb) return; aiEnsure().catch(()=>{}); }

/* ---- embed the visitor's text: MiniLM reads ~256 word pieces, so long abstracts
   are split into sentence chunks whose vectors are averaged ---- */
async function aiEmbed(text){
  const words=text.split(/\s+/).filter(Boolean);
  const chunks=[]; let cur=[];
  for(const s of text.replace(/\s+/g,' ').split(/(?<=[.!?])\s+/)){
    const w=s.split(' ').length;
    if(cur.length&&cur.reduce((a,x)=>a+x.split(' ').length,0)+w>150){ chunks.push(cur.join(' ')); cur=[]; }
    cur.push(s);
  }
  if(cur.length) chunks.push(cur.join(' '));
  if(!chunks.length) chunks.push(words.join(' '));
  const out=await AI.extractor(chunks.slice(0,8),{pooling:'mean',normalize:true});
  const dim=out.dims[1], k=out.dims[0], v=new Float32Array(dim);
  for(let c=0;c<k;c++) for(let d=0;d<dim;d++) v[d]+=out.data[c*dim+d];
  let norm=0; for(let d=0;d<dim;d++) norm+=v[d]*v[d]; norm=Math.sqrt(norm)||1;
  for(let d=0;d<dim;d++) v[d]/=norm;
  return v;
}

/* ---- filters (restrict candidates only) ---- */
function aiMatch(r){
  if(!aiState.fees.has(r.dia?'dia':'apc')) return false;
  if(r.src){ if(!aiState.extra) return false; }   // journals not in DOAJ: only via their own toggle, never ranked
  else {
    if(aiState.idxOnly&&!r.idx) return false;
    if(!aiState.quarts.has(r.idx&&r.q?r.q:'')) return false;
  }
  if(aiState.area&&!(r.areas||'').includes(aiState.area)) return false;
  if(aiState.weeks<52){ if(r.w==null||r.w>aiState.weeks) return false; }
  if(aiState.maxUsd<APC_MAX){ if(r.usd==null||r.usd>aiState.maxUsd) return false; }
  return true;
}
function aiKeywordHits(r,low){
  const hits=[];
  for(const k of (r.kw||'').split(',')){
    const kw=k.trim().toLowerCase(); if(kw.length<3) continue;
    const re=new RegExp('(^|[^a-z0-9])'+kw.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(s|es)?([^a-z0-9]|$)','i');
    if(re.test(low)) hits.push(k.trim());
  }
  return hits;
}
/* Journals not in DOAJ have no precomputed vector (embeddings.bin covers DOAJ
   only), so they are embedded here in the browser, once per dataset, from the
   same kind of text the build script uses (title + keywords + subjects). */
async function aiExtraVecs(){
  const extra=R.filter(r=>r.src);
  const key=extra.map(r=>r.issn).join('|');
  if(AI.extraKey===key) return AI.extraVecs;
  const texts=extra.map(r=>[r.t,r.kw,(r.dsub||'').replace(/\|/g,'; ')].filter(Boolean).join('. '));
  const vecs=[];
  for(let i=0;i<texts.length;i+=16){
    const out=await AI.extractor(texts.slice(i,i+16),{pooling:'mean',normalize:true});
    const dim=out.dims[1];
    for(let c=0;c<out.dims[0];c++) vecs.push(out.data.slice(c*dim,(c+1)*dim));
  }
  AI.extraKey=key; AI.extraVecs=extra.map((r,i)=>({r,v:vecs[i]}));
  return AI.extraVecs;
}
/* family descriptors are embedded once per session (11 short texts) */
async function aiFamilyVecs(){
  if(AI.famVecs) return AI.famVecs;
  const keys=Object.keys(AI_FAMILIES);
  const out=await AI.extractor(keys.map(k=>AI_FAMILIES[k]),{pooling:'mean',normalize:true});
  const dim=out.dims[1]; AI.famVecs={};
  keys.forEach((k,i)=>{ AI.famVecs[k]=out.data.slice(i*dim,(i+1)*dim); });
  return AI.famVecs;
}
async function aiRun(fromButton){
  const subj=$('aiSubj').value.trim(), abs=$('aiAbs').value.trim();
  if(!abs&&!subj) return;
  const text=[subj,abs].filter(Boolean).join('. ');
  const btn=$('aiRun'); btn.disabled=true;
  try{
    await aiEnsure();
    aiProgress(100,t('Matching…'));
    const q=await aiEmbed(text);
    // discipline gate: which families does the manuscript belong to?
    const fv=await aiFamilyVecs(); const cosByFam={};
    for(const k in fv){ let s=0; const v=fv[k]; for(let d=0;d<v.length;d++) s+=v[d]*q[d]; cosByFam[k]=s; }
    const msFams=manuscriptFamilies(cosByFam);
    const {n,dim,scale,ids,vec}=AI.emb;
    const byIssn=new Map(); for(const r of R) for(const i of (r.issns||[r.issn])) if(i&&!byIssn.has(i)) byIssn.set(i,r);
    const low=' '+text.toLowerCase()+' ';
    const out=[];
    for(let i=0;i<n;i++){
      const r=byIssn.get(ids[i]); if(!r||!aiMatch(r)) continue;
      let s=0; const o=i*dim;
      for(let d=0;d<dim;d++) s+=vec[o+d]*q[d];
      const cos=s*scale;
      out.push({r,cos});
    }
    if(aiState.extra&&R.some(r=>r.src)){
      aiProgress(100,t('Matching…'));
      for(const {r,v} of await aiExtraVecs()){
        if(!aiMatch(r)) continue;
        let s=0; for(let d=0;d<v.length;d++) s+=v[d]*q[d];
        out.push({r,cos:s});
      }
    }
    // 1. relevance threshold + discipline gate (no metadata can rescue an irrelevant journal)
    const passed=[]; let gated=0;
    for(const {r,cos} of out){
      const scope=scopeFromCos(cos);
      if(scope<AI_MIN_SCOPE) continue;
      if(!gatePasses(r,msFams,scope)){ gated++; continue; }
      passed.push({r,cos,scope});
    }
    // 2. order by scope + preferences; the displayed % stays the scope
    const top=passed.map(x=>{ const kw=aiKeywordHits(x.r,low); return {...x,kw,sem:x.scope,score:rankScore(x.scope,x.r,kw.length)}; })
      .sort((a,b)=>b.score-a.score||b.scope-a.scope).slice(0,AI_POOL);
    top.forEach((x,i)=>x.rank=i+1);
    AI.limit=AI_TOP;
    AI.results={top,total:out.length,text,fams:msFams,gated};
    AI.ran=true;
    renderAI();
    aiProgress(100,t('Ready: {n} journals indexed. Everything stays on this device.',{n:AI.emb.n.toLocaleString()}));
    AI.status.ready=true;
    if(fromButton && window.matchMedia('(max-width:860px)').matches) document.body.classList.add('side-hidden');   // phone: after pressing the button, close the drawer so the results are visible (filter changes keep it open)
  }catch(e){ console.error(e); aiProgress(0,e.message||String(e)); $('aiStatus').classList.add('err'); return; }
  finally{ btn.disabled=false; }
  $('aiStatus').classList.remove('err');
}

/* ---- rendering ---- */
const AI_BUCKET_LABEL={strong:'Strong match',good:'Good match',possible:'Possible match — check the scope',weak:'Weak match'};
function aiLabel(p){ return t(AI_BUCKET_LABEL[aiBucket(p)]||'Weak match'); }
/* two explicit lines: what is topical, and what only influenced the order */
function aiWhy(x){
  const topic=[];
  if(x.kw.length) topic.push(t('Shares your topics: {k}',{k:x.kw.slice(0,4).map(esc).join(', ')}));
  else if(x.scope>=.5) topic.push(t('Scope closely related to your abstract'));
  else if(x.scope>=.35) topic.push(t('Scope related to your abstract'));
  else topic.push(t('Only partly related: check the journal’s aims & scope'));
  const cats=(x.r.cats||'').split(';').map(s=>s.trim()).filter(Boolean).slice(0,2);
  if(cats.length) topic.push(t('Ranked in {c}',{c:cats.map(esc).join(', ')}));
  else if(x.r.dsub) topic.push(esc(x.r.dsub.split('|')[0].trim()));
  const pref=[];
  if(x.r.idx&&x.r.q) pref.push(x.r.q);
  if(x.r.dia) pref.push(t('free to publish'));
  return '<span class="aiw-topic"><em>'+t('Topical match')+'</em> '+topic.join(' · ')+'</span>'
    +(pref.length?'<span class="aiw-pref"><em>'+t('Order by your preferences')+'</em> '+pref.join(' · ')+'</span>':'');
}
function renderAI(){
  const list=$('alist'); if(!list) return;
  $('aisortbar').style.display=AI.ran&&AI.results?'':'none';
  $('aiExport').style.display=AI.ran&&AI.results?'':'none';
  if(!AI.ran||!AI.results){
    $('aresCount').textContent='';
    list.innerHTML='<div class="empty aiempty"><h3>'+t('✦ Find the right journal for your paper')+'</h3><p>'+t('Paste your abstract (and a subject) in the panel, then click <b>Find journals with AI</b>. A small language model runs in your browser and ranks every open access journal by how close its scope is to your text. Nothing is uploaded.')+'</p></div>';
    return;
  }
  const {total}=AI.results;
  const {k,d}=aiState.sort, f=AI_SORT[k].val;
  const all=[...AI.results.top].sort((a,b)=>{ const x=f(a),y=f(b); if(x==null&&y==null) return a.rank-b.rank; if(x==null) return 1; if(y==null) return -1; return x<y?-d:x>y?d:a.rank-b.rank; });
  AI.sorted=all;
  const top=all.slice(0,AI.limit);
  renderAISort();
  $('aresCount').textContent=top.length.toLocaleString();
  if(!top.length){ list.innerHTML='<div class="empty"><h3>'+t('No sufficiently relevant journal')+'</h3><p>'+t('No sufficiently relevant journal matches your filters. Widen the budget, the quartiles or the selected disciplines.')+'</p></div>'; return; }
  list.innerHTML='<div class="aihint">'+t('{k} relevant journals (of {n} passing your filters). The percentage is topical relevance only; quartile and fees only affect the order.',{k:all.length.toLocaleString(),n:total.toLocaleString()})+'</div>'
    +top.map((x,i)=>{
      const p=Math.round(x.scope*100), b=aiBucket(p), cls=b==='strong'?'st':b==='good'?'gd':b==='possible'?'ps':'wk';
      return '<div class="airow '+cls+'"><div class="aihead"><span class="airank">#'+x.rank+'</span>'
        +'<div class="aiscore"><b>'+p+'%</b><small>'+aiLabel(p)+'</small></div>'
        +'<div class="aimeter"><i style="width:'+p+'%"></i></div>'
        +'<div class="aiwhy">'+aiWhy(x)+'</div></div>'
        +jrowHtml(x.r)+'</div>';
    }).join('')
    +(all.length>top.length?'<div class="more">'+t('Showing {a} of {b}',{a:top.length.toLocaleString(),b:all.length.toLocaleString()})+'<br><button id="aiMore">'+t('Show 15 more')+'</button></div>':'');
  const more=$('aiMore'); if(more) more.onclick=()=>{ AI.limit+=AI_TOP; renderAI(); };
}
function renderAISort(){
  const {k,d}=aiState.sort;
  document.querySelectorAll('#aisortbar button[data-k]').forEach(b=>{
    const on=b.dataset.k===k; b.classList.toggle('on',on);
    b.innerHTML=t(AI_SORT[b.dataset.k].label)+(on?' <span class="dir">'+(d<0?'↓':'↑')+'</span>':'');
  });
  $('aisorthint').textContent=k==='score'?t('default: best match first'):t(AI_SORT[k].label)+(d<0?' ↓':' ↑');
}
function exportAI(){
  if(!AI.sorted||!AI.sorted.length) return;
  const strip=h=>h.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
  downloadCSV(['Rank','Topical match %','Ranking score (with preferences)','Why','Shared keywords',...CSV_HEAD],
    AI.sorted.map(x=>[x.rank,Math.round(x.scope*100),x.score.toFixed(3),strip(aiWhy(x).replace(/<\/span>/g,' | ')),x.kw.join('; '),...csvRow(x.r)]),'ai-journal-matches');
}
function bindAI(){
  $('aiExport').addEventListener('click',exportAI);
  $('aisortbar').addEventListener('click',e=>{
    const b=e.target.closest('button[data-k]'); if(!b) return;
    const k=b.dataset.k;
    aiState.sort=aiState.sort.k===k?{k,d:-aiState.sort.d}:{k,d:AI_SORT[k].def};
    renderAI();
  });
  $('aiWeeks').addEventListener('input',e=>{ aiState.weeks=+e.target.value; $('aiWkVal').textContent=aiState.weeks>=52?t('Any'):'≤ '+aiState.weeks+'w'; if(AI.ran) aiRun(); });
  $('aiApc').addEventListener('input',e=>{ aiState.maxUsd=+e.target.value; $('aiApcVal').textContent=apcLabel(aiState.maxUsd); if(AI.ran) aiRun(); });
  $('aiRun').addEventListener('click',()=>aiRun(true));
  $('aiAbs').addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter') aiRun(true); });
  document.querySelectorAll('#afchips .chip').forEach(ch=>ch.addEventListener('click',()=>{
    ch.classList.toggle('on'); if(ch.classList.contains('on')) aiState.fees.add(ch.dataset.f); else aiState.fees.delete(ch.dataset.f);
    if(AI.ran) aiRun();
  }));
  document.querySelectorAll('#aqchips .chip').forEach(ch=>ch.addEventListener('click',()=>{
    const key=ch.dataset.q==='none'?'':ch.dataset.q;
    ch.classList.toggle('on'); if(ch.classList.contains('on')) aiState.quarts.add(key); else aiState.quarts.delete(key);
    if(AI.ran) aiRun();
  }));
  $('aiIdxOnly').addEventListener('change',e=>{ aiState.idxOnly=e.target.checked; if(AI.ran) aiRun(); });
  $('aiExtraOn').addEventListener('change',e=>{ aiState.extra=e.target.checked; if(AI.ran) aiRun(); });
  $('aiResetBtn').addEventListener('click',()=>{
    aiState={fees:new Set(['dia']),quarts:new Set(['Q1','Q2','Q3','Q4','']),idxOnly:false,extra:false,area:'',weeks:52,maxUsd:APC_MAX,sort:{k:'score',d:-1}};
    document.querySelectorAll('#afchips .chip').forEach(ch=>ch.classList.toggle('on',ch.dataset.f==='dia'));
    document.querySelectorAll('#aqchips .chip').forEach(ch=>ch.classList.add('on'));
    $('aiIdxOnly').checked=false; $('aiExtraOn').checked=false; $('aiArea').value='';
    $('aiWeeks').value=52; $('aiWkVal').textContent=t('Any'); $('aiApc').value=APC_MAX; $('aiApcVal').textContent=apcLabel(APC_MAX);
    if(AI.ran) aiRun();
  });
  $('aiArea').addEventListener('change',e=>{ aiState.area=e.target.value; if(AI.ran) aiRun(); });
  $('aiClear').addEventListener('click',()=>{ $('aiSubj').value=''; $('aiAbs').value=''; AI.ran=false; AI.results=null; renderAI(); });
  renderAISort();
  $('alist').addEventListener('click',e=>{ const b=e.target.closest('.scopus-btn'); if(b) openScopusModal(b.dataset.issn,b.dataset.title); });
}

/* language switch: re-render the status line (it is JS-generated, not data-i18n) */
if(typeof I18N!=='undefined'&&I18N.onChange) I18N.onChange(()=>{
  if(AI.status&&AI.status.ready&&AI.emb){ aiProgress(100,t('Ready: {n} journals indexed. Everything stays on this device.',{n:AI.emb.n.toLocaleString()})); AI.status.ready=true; }   // keep the marker so every later switch re-renders too
});
