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
  if(h.some(x=>x==='evidence url') && h.some(x=>x==='source')) return 'extra';
  if(h.some(x=>x==='apc') && h.some(x=>x.includes('journal title'))) return 'doaj';
  return null;
}
/* Rough exchange rates to USD (mid-2026, for sorting/filtering only, not for billing).
   DOAJ lists "1000 CHF; 250 EUR" style multi-currency amounts; we take the cheapest. */
const FX={USD:1,EUR:1.08,GBP:1.27,CHF:1.12,AUD:0.66,CAD:0.73,NZD:0.60,JPY:0.0065,CNY:0.14,INR:0.012,IDR:0.000062,
  IRR:0.000024,EGP:0.021,UAH:0.024,BRL:0.18,IQD:0.00076,ZAR:0.054,PLN:0.25,PKR:0.0036,RUB:0.011,KRW:0.00072,NGN:0.00065,
  MYR:0.22,KZT:0.0021,TRY:0.029,NOK:0.092,SEK:0.095,DKK:0.145,XOF:0.0016,XAF:0.0016,MAD:0.10,DZD:0.0074,TND:0.32,SAR:0.27,
  AED:0.27,QAR:0.27,KWD:3.25,BHD:2.65,OMR:2.60,JOD:1.41,LKR:0.0033,BDT:0.0085,NPR:0.0075,VND:0.00004,THB:0.028,PHP:0.017,
  TWD:0.031,HKD:0.128,SGD:0.74,MXN:0.055,COP:0.00024,ARS:0.001,CLP:0.0011,PEN:0.27,HUF:0.0027,CZK:0.043,RON:0.22,BGN:0.55,
  RSD:0.0092,HRK:0.14,GEL:0.36,AMD:0.0026,AZN:0.59,UZS:0.00008,KES:0.0077,GHS:0.065,ETB:0.0078,TZS:0.0004,UGX:0.00027};
function apcUSD(str){
  let best=null;
  for(const part of String(str||'').split(';')){
    const m=part.match(/([\d.,]+)\s*([A-Z]{3})/);
    if(!m||!(m[2] in FX)) continue;
    const n=parseFloat(m[1].replace(/,/g,'')); if(isNaN(n)) continue;
    const v=Math.round(n*FX[m[2]]);
    if(best==null||v<best) best=v;
  }
  return best;
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
  // SCImago exports contain HTML entities ("Taylor &amp; Francis") - decode them
  const deent=s=>s.indexOf('&')<0?s:s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'");
  const col=(row,name)=>(name in si)?deent(String(row[si[name]]||'').trim()):'';
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
        pub:col(row,'Publisher'), cov:col(row,'Coverage'), areas:col(row,'Areas'), cats:col(row,'Categories')
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
    const feeAll = (('APC amount' in di) && row[di['APC amount']]) ? row[di['APC amount']] : '';
    const fee = dia ? '' : feeAll.split(';')[0].trim();
    const usd = dia ? 0 : apcUSD(feeAll);   // approx USD (null when unknown)
    const wRaw=row[di['Average number of weeks between article submission and publication']];
    inters.push({
      dia, fee, usd,
      t:row[di['Journal title']],
      pissn:row[di['Journal ISSN (print version)']], eissn:row[di['Journal EISSN (online version)']],
      w: wRaw && !isNaN(parseFloat(wRaw)) ? Math.round(parseFloat(wRaw)) : null,
      rev:row[di['Review process']]||'', pub:row[di['Publisher']]||'', c:row[di['Country of publisher']]||'',
      lang:row[di['Languages in which the journal accepts manuscripts']]||'', dsub:row[di['Subjects']]||'',
      url:row[di['Journal URL']]||'', doaj:row[di['URL in DOAJ']]||'',
      kw:('Keywords' in di)?(row[di['Keywords']]||''):''   // DOAJ keywords (used by the AI matcher's "why" line)
    });
  }
  return inters;
}
/* ---- Community-verified journals (data/extra-journals.csv) ----
   Peer-reviewed open-access journals that are NOT (yet) in DOAJ, checked by
   hand against a short checklist (see data/extra-journals.README.md). They
   are mapped to the same intermediate shape as DOAJ rows and tagged with
   src:'community' so the UI can flag them and the filter can hide them. */
function extraCsvToInters(rows){
  if(!rows || rows.length<2) return [];
  const h=rows[0].map(c=>c.trim()), i=Object.fromEntries(h.map((c,k)=>[c,k]));
  const need=['Journal title','Journal URL','Source','Evidence URL'];
  for(const c of need) if(!(c in i)) throw new Error('extra-journals.csv: missing column “'+c+'”');
  const g=(row,c)=>(c in i)?String(row[i[c]]||'').trim():'';
  const out=[];
  for(let r=1;r<rows.length;r++){
    const row=rows[r]; if(!row || row.length<3 || !g(row,'Journal title')) continue;
    const apc=g(row,'APC').toLowerCase(), fees=g(row,'Has other fees').toLowerCase();
    const dia=(apc===''||apc==='no') && (fees===''||fees==='no');
    const feeAll=g(row,'APC amount');
    const wRaw=g(row,'Weeks to publication');
    out.push({
      dia, fee:dia?'':feeAll.split(';')[0].trim(), usd:dia?0:apcUSD(feeAll),
      t:g(row,'Journal title'), pissn:g(row,'ISSN (print)'), eissn:g(row,'EISSN'),
      w:wRaw&&!isNaN(parseFloat(wRaw))?Math.round(parseFloat(wRaw)):null,
      rev:g(row,'Review process'), pub:g(row,'Publisher'), c:g(row,'Country'),
      lang:g(row,'Languages'), dsub:g(row,'Subjects'), url:g(row,'Journal URL'), doaj:'', kw:g(row,'Keywords'),
      src:g(row,'Source')||'community', ver:g(row,'Verified on'), note:g(row,'Notes'), ev:g(row,'Evidence URL')
    });
  }
  return out;
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
      t:it.t, idx:!!sci, q, sjr, h, cats, areas, w:it.w, dia:it.dia, fee:it.fee, usd:it.usd,
      issn:normISSN(it.eissn)||normISSN(it.pissn)||'',
      issns:[normISSN(it.pissn),normISSN(it.eissn)].filter(Boolean),
      rev:it.rev, pub:it.pub, c:it.c, lang:it.lang, dsub:it.dsub, url:it.url, doaj:it.doaj, kw:it.kw,
      // community-verified (not in DOAJ) entries only; DOAJ records leave these undefined
      src:it.src, ver:it.ver, note:it.note, ev:it.ev
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
      extra:records.filter(r=>r.src).length,
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
async function cacheDel(key){ try{ const db=await idb();
  await new Promise((res,rej)=>{ const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(key); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
}catch(e){} }
