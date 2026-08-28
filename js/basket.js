/* ================= Shortlist ("basket") =================
   Journals the visitor picks with the "+ Add" button on a card. Kept in
   localStorage until cleared, so it survives refreshes; exporting it as CSV
   (all details) empties it. Opens as a drawer from the right. */
const BK_KEY='shortlist1';
let basket=new Map();   // key (ISSN or title) → record
const bkKey=r=>r.issn||('t:'+r.t);
function bkLoad(){ try{ const raw=localStorage.getItem(BK_KEY); if(raw) for(const r of JSON.parse(raw)) basket.set(bkKey(r),r); }catch(e){} }
function bkSave(){ try{ localStorage.setItem(BK_KEY,JSON.stringify([...basket.values()])); }catch(e){} }
function bkHas(key){ return basket.has(key); }
function bkToggle(key){
  if(basket.has(key)) basket.delete(key);
  else { const r=R.find(x=>bkKey(x)===key); if(!r) return; basket.set(key,r); }
  bkSave(); bkSync();
}
function bkRemove(key){ basket.delete(key); bkSave(); bkSync(); }
function bkClear(){ basket.clear(); bkSave(); bkSync(); }
/* keep every "+ Add" button, the counters and the drawer in step with the basket */
function bkSync(){
  document.querySelectorAll('.pick-btn').forEach(b=>{ const on=basket.has(b.dataset.key); b.classList.toggle('on',on); b.textContent=on?t('✓ Added'):t('+ Add'); });
  const n=basket.size;
  document.querySelectorAll('.bk-count').forEach(el=>el.textContent=n);
  document.querySelectorAll('.basket-btn').forEach(b=>b.classList.toggle('has',n>0));
  if($('bk').classList.contains('open')) bkRender();
}
function bkRender(){
  const list=$('bkList');
  if(!basket.size){ list.innerHTML='<div class="bk-empty">'+t('Your shortlist is empty. Use “+ Add” on a journal card to keep it here.')+'</div>'; $('bkExport').disabled=true; $('bkClear').disabled=true; return; }
  $('bkExport').disabled=false; $('bkClear').disabled=false;
  list.innerHTML=[...basket.values()].map(r=>'<div class="bk-item">'
    +'<div class="bk-q q-'+(r.idx&&r.q?r.q:'none')+'">'+(r.idx&&r.q?r.q:'–')+'</div>'
    +'<div class="bk-main"><b>'+(r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.t)+'</a>':esc(r.t))+'</b>'
    +'<span>'+esc(r.pub||'')+(r.c?' · '+esc(r.c):'')+(r.issn?' · ISSN '+fmtISSN(r.issn):'')+'</span>'
    +'<span>'+(r.dia?t('Diamond · free'):(r.fee?t('APC: ')+esc(r.fee):t('Has fees')))+(r.sjr!=null?' · SJR '+r.sjr:'')+(r.w!=null?' · '+r.w+'w':'')+(r.src?' · '+t('Not in DOAJ'):'')+'</span></div>'
    +'<button class="bk-del" data-key="'+esc(bkKey(r))+'" title="'+t('Remove')+'" aria-label="'+t('Remove')+'">✕</button>'
    +'</div>').join('');
}
function bkOpen(open){ $('bk').classList.toggle('open',open); $('bkBackdrop').classList.toggle('open',open); if(open) bkRender(); }
/* full details: the standard export columns plus review / subjects / keywords / DOAJ status */
/* (CSV_HEAD / csvRow / downloadCSV live in app.js, which loads after this file - so resolve them at click time) */
function bkExport(){
  if(!basket.size) return;
  const head=[...CSV_HEAD,'Review process','DOAJ subjects','Keywords','Listed in DOAJ'];
  const row=r=>[...csvRow(r),r.rev||'',r.dsub||'',r.kw||'',r.src?'No (auto-checked)':'Yes'];
  downloadCSV(head,[...basket.values()].map(row),'shortlist');
  bkClear(); bkOpen(false);
}
function bindBasket(){
  bkLoad();
  document.addEventListener('click',e=>{
    const pick=e.target.closest('.pick-btn'); if(pick){ bkToggle(pick.dataset.key); return; }
    const del=e.target.closest('.bk-del'); if(del){ bkRemove(del.dataset.key); return; }
    if(e.target.closest('.basket-btn')){ bkOpen(true); return; }
  });
  $('bkClose').addEventListener('click',()=>bkOpen(false));
  $('bkBackdrop').addEventListener('click',()=>bkOpen(false));
  $('bkClear').addEventListener('click',bkClear);
  $('bkExport').addEventListener('click',bkExport);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&$('bk').classList.contains('open')) bkOpen(false); });
  if(typeof I18N!=='undefined'&&I18N.onChange) I18N.onChange(bkSync);
  bkSync();
}
