/* ================= CSV parsing (RFC-4180: quotes, embedded newlines) ================= */
function parseCSV(text, delim){
  const rows=[]; let row=[], field='', inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else inQ=false; }
      else field+=c;
    } else {
      if(c==='"') inQ=true;
      else if(c===delim){ row.push(field); field=''; }
      else if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c==='\r'){/* skip */}
      else field+=c;
    }
  }
  if(field!=='' || row.length){ row.push(field); rows.push(row); }
  return rows;
}
function sniffDelim(firstLine){
  return (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
}
function detectKind(headerRow){
  const h=headerRow.map(x=>x.trim().toLowerCase());
  // full export uses "SJR Best Quartile"; filtered per-category exports use "SJR Quartile"
  if(h.some(x=>x==='sjr best quartile'||x==='sjr quartile')) return 'sci';
  if(h.some(x=>x==='apc') && h.some(x=>x.includes('journal title'))) return 'doaj';
  return null;
}
const normISSN = v => {
  if(!v) return null;
  const n=String(v).toUpperCase().replace(/[^0-9X]/g,'');
  return n.length===8 ? n : null;
};

/* ================= Journal join logic ================= */
/* Both sources (DOAJ CSV and DOAJ API) are first mapped to the same
   intermediate shape, then joined with SCImago on ISSN. */
function buildSci(sciRows){
  const sh=sciRows[0];
  const si=Object.fromEntries(sh.map((c,i)=>[c.trim(),i]));
  // filtered per-category exports name the quartile column "SJR Quartile"
  if(!('SJR Best Quartile' in si) && ('SJR Quartile' in si)) si['SJR Best Quartile']=si['SJR Quartile'];
  for(const c of ['Issn','SJR','SJR Best Quartile','H index','Categories','Areas'])
    if(!(c in si)) throw new Error('SCImago file: missing column “'+c+'”');
  const smap=new Map(), list=[];
  const col=(row,name)=>(name in si)?String(row[si[name]]||'').trim():'';
  for(let r=1;r<sciRows.length;r++){
    const row=sciRows[r]; if(!row || row.length<3) continue;
    const issns=[];
    for(const tok of String(row[si['Issn']]||'').split(',')){
      const n=normISSN(tok);
      if(n){ issns.push(n); if(!smap.has(n)) smap.set(n,row); }
    }
    // full Scopus source list (all types, not just OA) for the Scopus check tab
    if('Title' in si){
      const sRaw=col(row,'SJR').replace(/\./g,'').replace(',','.');
      let q=col(row,'SJR Best Quartile'); if(q==='-') q='';
      list.push({
        t:col(row,'Title'), ty:col(row,'Type'), issns,
        q, sjr:sRaw&&!isNaN(parseFloat(sRaw))?Math.round(parseFloat(sRaw)*1000)/1000:null,
        h:!isNaN(parseInt(col(row,'H index')))?parseInt(col(row,'H index')):null,
        pub:col(row,'Publisher'), cov:col(row,'Coverage'), areas:col(row,'Areas')
      });
    }
  }
  return {si,smap,list};
}
function doajCsvToInters(doajRows){
  const dh=doajRows[0];
  const di=Object.fromEntries(dh.map((c,i)=>[c.trim(),i]));
  const need=['Journal title','APC','Has other fees','Journal ISSN (print version)','Journal EISSN (online version)',
              'Average number of weeks between article submission and publication','Publisher','Country of publisher',
              'Languages in which the journal accepts manuscripts','Review process','Subjects','Journal URL','URL in DOAJ'];
  for(const c of need) if(!(c in di)) throw new Error('DOAJ file: missing column “'+c+'”');
  const inters=[];
  for(let r=1;r<doajRows.length;r++){
    const row=doajRows[r]; if(!row || row.length<5) continue;
    const apc=(row[di['APC']]||'').trim().toLowerCase();
    const fees=(row[di['Has other fees']]||'').trim().toLowerCase();
    const dia = apc==='no' && fees==='no';   // Diamond = no APC AND no other fees
    const fee = dia ? '' : ((('APC amount' in di) && row[di['APC amount']]) ? row[di['APC amount']].split(';')[0].trim() : '');
    const wRaw=row[di['Average number of weeks between article submission and publication']];
    inters.push({
      dia, fee,
      t:row[di['Journal title']],
      pissn:row[di['Journal ISSN (print version)']], eissn:row[di['Journal EISSN (online version)']],
      w: wRaw && !isNaN(parseFloat(wRaw)) ? Math.round(parseFloat(wRaw)) : null,
      rev:row[di['Review process']]||'', pub:row[di['Publisher']]||'', c:row[di['Country of publisher']]||'',
      lang:row[di['Languages in which the journal accepts manuscripts']]||'', dsub:row[di['Subjects']]||'',
      url:row[di['Journal URL']]||'', doaj:row[di['URL in DOAJ']]||''
    });
  }
  return inters;
}
function assemble(inters, sciRows){
  const {si,smap,list}=buildSci(sciRows);
  const records=[];
  for(const it of inters){
    let sci=null;
    for(const raw of [it.pissn,it.eissn]){
      const n=normISSN(raw);
      if(n && smap.has(n)){ sci=smap.get(n); break; }
    }
    let sjr=null,h=null,q='',cats='',areas='';
    if(sci){
      const sRaw=(sci[si['SJR']]||'').replace(/\./g,'').replace(',','.'); // EU decimal
      sjr = sRaw && !isNaN(parseFloat(sRaw)) ? Math.round(parseFloat(sRaw)*1000)/1000 : null;
      const hRaw=sci[si['H index']];
      h = hRaw && !isNaN(parseInt(hRaw)) ? parseInt(hRaw) : null;
      q=(sci[si['SJR Best Quartile']]||'').trim(); if(q==='-') q='';
      cats=sci[si['Categories']]||''; areas=sci[si['Areas']]||'';
    }
    records.push({
      t:it.t, idx:!!sci, q, sjr, h, cats, areas, w:it.w, dia:it.dia, fee:it.fee,
      issn:normISSN(it.eissn)||normISSN(it.pissn)||'',
      rev:it.rev, pub:it.pub, c:it.c, lang:it.lang, dsub:it.dsub, url:it.url, doaj:it.doaj
    });
  }
  const areaSet=new Set();
  records.forEach(r=>{ if(r.areas) r.areas.split(';').forEach(a=>{a=a.trim(); if(a) areaSet.add(a);}); });
  return {
    records,
    sci:list,
    areas:[...areaSet].sort(),
    meta:{
      total:records.length,
      dia:records.filter(r=>r.dia).length,
      q12:records.filter(r=>r.q==='Q1'||r.q==='Q2').length
    }
  };
}

/* ================= IndexedDB cache ================= */
const DB='oa_finder', STORE='data';
function idb(){ return new Promise((res,rej)=>{ const rq=indexedDB.open(DB,1);
  rq.onupgradeneeded=()=>rq.result.createObjectStore(STORE);
  rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); });}
async function cacheSet(key,payload){ try{ const db=await idb();
  await new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(payload,key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
}catch(e){ console.warn('cache write failed',e); } }
async function cacheGet(key){ try{ const db=await idb();
  return await new Promise((res,rej)=>{ const rq=db.transaction(STORE).objectStore(STORE).get(key);
    rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error); });
}catch(e){ return null; } }
