/* ================= App shell / tabs ================= */
let R=[], state=null;
let S=[], sciRef=null;   // full Scopus/SCImago source list for the Scopus check tab; sciRef = reference "current" year
function covEnd(cov){ const y=(String(cov).match(/\d{4}/g)||[]).map(Number).filter(v=>v>=1900&&v<=2100); return y.length?Math.max(...y):null; }
function covActive(cov){ const e=covEnd(cov); return e!=null && sciRef!=null && e>=sciRef-1; }
const qRank={Q1:1,Q2:2,Q3:3,Q4:4,'':9};
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

function switchTab(tab){
  document.querySelectorAll('.tabbar button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  for(const t of ['j','c','s']){
    $('side-'+t).style.display = t===tab?'block':'none';
    $('main-'+t).style.display = t===tab?'block':'none';
  }
  if(tab==='c'){ if(csrc==='ma') loadMa(); else loadConfs(); }
  if(tab==='s') renderScopus();
  if(tab==='j' && !R.length){
    // no journal data yet — go back to the loader to get some
    $('app').style.display='none';
    $('loader').style.display='flex';
  }
}
document.querySelectorAll('.tabbar button').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));

function startApp(data,stamp,tab){
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
    $('s-src').textContent=S.length.toLocaleString();
    $('s-act').textContent=S.filter(s=>covActive(s.cov)).length.toLocaleString();
    $('dataStamp').textContent=stamp;
    $('s-total').textContent=data.meta.total.toLocaleString();
    $('s-idx').textContent=(data.meta.dia!=null?data.meta.dia:0).toLocaleString();
    $('s-q12').textContent=data.meta.q12.toLocaleString();

    const areaSel=$('area'); areaSel.innerHTML='<option value="">All areas</option>';
    data.areas.forEach(a=>{const o=document.createElement('option');o.value=a;o.textContent=a;areaSel.appendChild(o);});
    const cSel=$('country'); cSel.innerHTML='<option value="">All countries</option>';
    const cc={}; R.forEach(r=>{if(r.c)cc[r.c]=(cc[r.c]||0)+1;});
    Object.keys(cc).sort((a,b)=>cc[b]-cc[a]).forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c+' ('+cc[c]+')';cSel.appendChild(o);});

    state={q:'',fees:new Set(['dia']),quarts:new Set(['Q1','Q2']),idxOnly:true,area:'',weeks:52,country:'',sort:'q',limit:60};
  }
  bindOnce();
  switchTab(tab||'j');
  if(data) render();
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
  $('q').addEventListener('input',e=>{state.q=e.target.value.toLowerCase().trim();state.limit=60;render();});
  $('idxOnly').addEventListener('change',e=>{state.idxOnly=e.target.checked;state.limit=60;render();});
  $('area').addEventListener('change',e=>{state.area=e.target.value;state.limit=60;render();});
  $('country').addEventListener('change',e=>{state.country=e.target.value;state.limit=60;render();});
  $('sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
  $('weeks').addEventListener('input',e=>{
    state.weeks=+e.target.value;
    $('wkVal').textContent=state.weeks>=52?'Any':'≤ '+state.weeks+'w';
    state.limit=60; render();
  });
  $('resetBtn').addEventListener('click',()=>{
    state={q:'',fees:new Set(['dia']),quarts:new Set(['Q1','Q2']),idxOnly:true,area:'',weeks:52,country:'',sort:state.sort,limit:60};
    $('q').value='';$('idxOnly').checked=true;$('area').value='';$('country').value='';
    $('weeks').value=52;$('wkVal').textContent='Any';
    document.querySelectorAll('#qchips .chip').forEach(ch=>ch.classList.toggle('on',ch.dataset.q==='Q1'||ch.dataset.q==='Q2'));
    document.querySelectorAll('#fchips .chip').forEach(ch=>ch.classList.toggle('on',ch.dataset.f==='dia'));
    render();
  });
  $('reload').addEventListener('click',()=>{
    files.doaj=files.sci=null;
    ['slot-doaj','slot-sci'].forEach(id=>$(id).classList.remove('ok'));
    $('slot-doaj-s').textContent='waiting…'; $('slot-sci-s').textContent='waiting…';
    status('');
    $('app').style.display='none'; $('loader').style.display='flex';
    $('cacheNote').style.display='none';
    $('backToApp').style.display='inline-block';   // current data stays loaded — one click back
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
}
