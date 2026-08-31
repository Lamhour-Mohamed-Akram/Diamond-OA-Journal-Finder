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
const AI_EMB_KEY='emb2';                   // IndexedDB key (bump with the .bin layout)
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
const AI_EMB_MAGIC='OAE2';   // weighted per-field vectors (see js/ai-score.js); older files are skipped
const aiMagic=buf=>String.fromCharCode(...new Uint8Array(buf,0,4));
async function aiLoadEmbeddings(){
  const c=await cacheGet(AI_EMB_KEY);
  let buf=c&&c.buf&&(Date.now()-(c.ts||0)<AI_EMB_TTL)&&aiMagic(c.buf)===AI_EMB_MAGIC?c.buf:null;
  if(!buf){
    // GitHub raw first (free bandwidth), then the copy deployed with the site;
    // a source serving an older format is skipped, so a newer local build wins
    for(const url of [GH_DATA+'data/embeddings.bin','data/embeddings.bin']){
      try{ const r=await fetch(url); if(r.ok){ const b=await r.arrayBuffer(); if(aiMagic(b)===AI_EMB_MAGIC){ buf=b; break; } console.info('embeddings.bin at '+url+' has format '+aiMagic(b)+', using the next source'); } }catch(e){}
    }
    if(!buf){ if(c&&c.buf&&aiMagic(c.buf)===AI_EMB_MAGIC) buf=c.buf; else throw new Error(t('Couldn’t download the journal vectors (are you offline?). Try again in a moment.')); }
    else cacheSet(AI_EMB_KEY,{buf,ts:Date.now()});
  }
  const dv=new DataView(buf);
  const magic=aiMagic(buf);
  if(magic!==AI_EMB_MAGIC) throw new Error('embeddings.bin: unknown format '+magic+' (expected '+AI_EMB_MAGIC+': rebuild with scripts/build-embeddings.mjs)');
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
/* per-field vectors of a set of journals (same scheme as the build script):
   returns [{r, v (weighted, unit), fields:{name:{text,vec}}}] */
async function aiFieldVecs(records){
  const jobs=[]; const fields=records.map(r=>journalFields(r));
  fields.forEach((f,j)=>{ for(const k in AI_FIELD_WEIGHTS) if(f[k]) jobs.push({j,k,text:f[k]}); });
  const vecs=new Map(); let dim=0;
  for(let i=0;i<jobs.length;i+=32){
    const chunk=jobs.slice(i,i+32);
    const out=await AI.extractor(chunk.map(x=>x.text),{pooling:'mean',normalize:true}); dim=out.dims[1];
    chunk.forEach((x,c)=>vecs.set(x.j+':'+x.k,out.data.slice(c*dim,(c+1)*dim)));
  }
  return records.map((r,j)=>{
    const v=new Float32Array(dim||384); const fl={};
    for(const k in AI_FIELD_WEIGHTS){ const fv=vecs.get(j+':'+k); if(!fv) continue; fl[k]={text:fields[j][k],vec:fv}; for(let d=0;d<v.length;d++) v[d]+=AI_FIELD_WEIGHTS[k]*fv[d]; }
    let n=0; for(let d=0;d<v.length;d++) n+=v[d]*v[d]; n=Math.sqrt(n)||1; for(let d=0;d<v.length;d++) v[d]/=n;
    return {r,v,fields:fl};
  });
}
async function aiExtraVecs(){
  const extra=R.filter(r=>r.src&&aiConfidence(r)!=='insufficient');
  const key=extra.map(r=>r.issn).join('|');
  if(AI.extraKey===key) return AI.extraVecs;
  AI.extraKey=key; AI.extraVecs=await aiFieldVecs(extra);
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
  AI.shortText=text.split(/\s+/).filter(Boolean).length;   // word count: a bare title gives unreliable similarities
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
    // eligibility stages (counts are kept for the hint line / diagnostics):
    //   filters -> >= 20 % topical -> discipline family gate -> specialist-scope gate -> tiers
    const counts={filtered:out.length,metadata:0,relevant:0,family:0,specialist:0,main:0,possible:0,weak:0};
    const passed=[];
    for(const {r,cos} of out){
      const scope=scopeFromCos(cos), conf=aiConfidence(r);
      if(conf==='insufficient') continue; counts.metadata++;
      if(scope<AI_MIN_SCOPE) continue; counts.relevant++;
      if(!gatePasses(r,msFams,scope)) continue; counts.family++;
      if(specialistBlock(r,low)) continue; counts.specialist++;
      passed.push({r,cos,scope,conf});
    }
    // order by scope + preferences (ordering only); tier from the scope alone,
    // capped at "possible" for low-confidence metadata
    const top=passed.map(x=>{
      const kw=aiKeywordHits(x.r,low);
      return {...x,kw,tier:aiTierCap(aiTier(x.scope),x.conf),sem:x.scope,score:rankScore(x.scope,x.r,kw.length)};
    }).sort((a,b)=>b.score-a.score||b.scope-a.scope);
    top.forEach((x,i)=>{ x.rank=i+1; counts[x.tier]++; });
    AI.limit=AI_TOP; AI.showWeak=false;
    AI.results={top,total:out.length,text,fams:msFams,counts};
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
/* one result row */
function aiRowHtml(x){
  const p=Math.round(x.scope*100), b=aiBucket(p), cls=b==='strong'?'st':b==='good'?'gd':b==='possible'?'ps':'wk';
  return '<div class="airow '+cls+'"><div class="aihead"><span class="airank">#'+x.rank+'</span>'
    +'<div class="aiscore" title="'+esc(t('Metadata-based topical similarity'))+' — '+esc(t('Estimated from journal title, keywords, subjects and indexing categories. Always verify the journal’s aims and scope.'))+'"><b>'+p+'%</b><small>'+aiLabel(p)+'</small>'
    +(x.conf==='low'?'<span class="aiconf" title="'+esc(t('Only the title or broad categories are available for this journal.'))+'">'+t('low confidence')+'</span>':x.conf==='medium'?'<span class="aiconf mid" title="'+esc(t('Keywords or subjects available, but not both with indexing categories.'))+'">'+t('medium confidence')+'</span>':'')+'</div>'
    +'<div class="aimeter"><i style="width:'+p+'%"></i></div>'
    +'<div class="aiwhy">'+aiWhy(x)+'</div></div>'
    +jrowHtml(x.r)+'</div>';
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
  const {total,counts}=AI.results;
  const {k,d}=aiState.sort, f=AI_SORT[k].val;
  const bySort=(a,b)=>{ const x=f(a),y=f(b); if(x==null&&y==null) return a.rank-b.rank; if(x==null) return 1; if(y==null) return -1; return x<y?-d:x>y?d:a.rank-b.rank; };
  const main=AI.results.top.filter(x=>x.tier==='main').sort(bySort);
  const poss=AI.results.top.filter(x=>x.tier==='possible').sort(bySort);
  const weak=AI.results.top.filter(x=>x.tier==='weak').sort(bySort);
  AI.sorted=[...main,...poss,...weak];   // export order
  renderAISort();
  $('aresCount').textContent=(main.length+poss.length).toLocaleString();
  const noMatch='<div class="empty"><h3>'+t('No sufficiently relevant journal')+'</h3><p>'+t('No sufficiently relevant journal was found among the journals passing your filters. Widen the budget, the quartiles or the selected disciplines.')+'</p></div>';
  // topical-metadata summary header removed per request (relevant/possible counts, filter funnel, disclaimer)
  const shown=[...main.slice(0,AI.limit)];
  let html=(main.length||poss.length)?'':noMatch;
  if(AI.shortText<40) html='<div class="aihint warn">'+t('Your text is short ({n} words). A title alone gives unreliable similarities: paste the full abstract for a meaningful estimate.',{n:AI.shortText})+'</div>'+html;
  if(main.length){
    html+=shown.map(aiRowHtml).join('');
    if(main.length>shown.length) html+='<div class="more">'+t('Showing {a} of {b}',{a:shown.length.toLocaleString(),b:main.length.toLocaleString()})+'<br><button id="aiMore">'+t('Show 15 more')+'</button></div>';
  }
  if(poss.length) html+='<div class="aisection"><h4>'+t('Possible matches — verify the journal’s aims and scope')+' <span>'+poss.length+'</span></h4></div>'+poss.map(aiRowHtml).join('');
  if(weak.length){
    html+='<div class="aisection weak"><button id="aiWeakBtn" class="reset small">'+(AI.showWeak?t('Hide weak matches'):t('Show weak matches ({k})',{k:weak.length}))+'</button></div>';
    if(AI.showWeak) html+='<div class="aihint">'+t('Weak matches (20–34 %): usually one shared generic keyword. Not recommendations.')+'</div>'+weak.map(aiRowHtml).join('');
  }
  list.innerHTML=html;
  const more=$('aiMore'); if(more) more.onclick=()=>{ AI.limit+=AI_TOP; renderAI(); };
  const wb=$('aiWeakBtn'); if(wb) wb.onclick=()=>{ AI.showWeak=!AI.showWeak; renderAI(); };
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
  downloadCSV(['Rank','Tier','Topical match %','Confidence','Ranking score (with preferences)','Why','Shared keywords',...CSV_HEAD],
    AI.sorted.map(x=>[x.rank,x.tier,Math.round(x.scope*100),x.conf,x.score.toFixed(3),strip(aiWhy(x).replace(/<\/span>/g,' | ')),x.kw.join('; '),...csvRow(x.r)]),'ai-journal-matches');
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
