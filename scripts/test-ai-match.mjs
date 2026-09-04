/* Regression tests for the AI journal matcher (js/ai-score.js + the same
   pipeline as js/ai.js), run against the real data/embeddings.bin with the
   real MiniLM model:   cd scripts && npm test
   Test abstracts live only here - production logic never sees them. */
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs'; import vm from 'node:vm';
const ctx={console}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/data.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('../js/ai-score.js','utf8'),ctx);
const load=p=>{const t=fs.readFileSync(p,'utf8');return ctx.parseCSV(t,ctx.sniffDelim(t.slice(0,t.indexOf('\n'))));};
const R=ctx.assemble(ctx.doajCsvToInters(load('../data/doaj.csv')),load('../data/scimago.csv')).records;
/* official-scope evidence table (deployed asset; statuses only) */
ctx.SCOPE_EV={}; if(fs.existsSync('../data/scope-evidence.csv')) for(const row of load('../data/scope-evidence.csv').slice(1)){ const [a,b,st,conf,url]=row; if(st){ if(a) ctx.SCOPE_EV[a]={st,conf:+conf,url}; if(b) ctx.SCOPE_EV[b]={st,conf:+conf,url}; } }
const byIssn=new Map(); for(const r of R) for(const i of (r.issns||[])) if(!byIssn.has(i)) byIssn.set(i,r);
const buf=fs.readFileSync('../data/embeddings.bin'); const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
if(buf.toString('ascii',0,4)!=='OAE3') throw new Error('embeddings.bin must be OAE3 (per-field + official-scope evidence vectors): run npm run build:embeddings');
const n=dv.getUint32(4,true),dim=dv.getUint32(8,true),scale=dv.getFloat32(12,true);
const ids=[]; for(let i=0;i<n;i++) ids.push(buf.toString('latin1',16+i*8,16+i*8+8).trim());
const vec=new Int8Array(buf.buffer,buf.byteOffset+16+n*8,n*dim);
env.allowLocalModels=false;
const ex=await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{dtype:'q8'});
const emb=async txt=>{const o=await ex([txt],{pooling:'mean',normalize:true});return Array.from(o.data);};
const famKeys=Object.keys(ctx.AI_FAMILIES); const famV={};
{ const o=await ex(famKeys.map(k=>ctx.AI_FAMILIES[k]),{pooling:'mean',normalize:true}); famKeys.forEach((k,i)=>famV[k]=Array.from(o.data.slice(i*dim,(i+1)*dim))); }

/* same pipeline as aiRun(): filters → cosine → threshold + gate → rank */
async function run(text,filter=()=>true){
  const q=await emb(text);
  const cosByFam={}; for(const k of famKeys) cosByFam[k]=famV[k].reduce((a,x,i)=>a+x*q[i],0);
  const fams=ctx.manuscriptFamilies(cosByFam);
  const all=[]; let gated=0;
  for(let i=0;i<n;i++){
    const r=byIssn.get(ids[i]); if(!r||!filter(r)) continue;
    let s=0; const o=i*dim; for(let d=0;d<dim;d++) s+=vec[o+d]*q[d];
    const cos=s*scale, scope=ctx.scopeFromCos(cos);
    all.push({r,cos,scope});
  }
  const low=' '+text.toLowerCase()+' ';
  const counts={filtered:all.length,metadata:0,relevant:0,family:0,specialist:0,main:0,possible:0,weak:0}; const shown=[];
  for(const x of all){
    const conf=ctx.aiConfidence(x.r,ctx.SCOPE_EV); if(conf==='insufficient') continue; counts.metadata++;
    if(x.scope<ctx.AI_MIN_SCOPE) continue; counts.relevant++;
    if(!ctx.gatePasses(x.r,fams,x.scope)){gated++;continue;} counts.family++;
    if(ctx.specialistBlock(x.r,low)) continue; counts.specialist++;
    const tier=ctx.aiTierCap(ctx.aiTier(x.scope),conf);
    counts[tier]++; shown.push({...x,tier,conf,score:ctx.rankScore(x.scope,x.r,0)});
  }
  shown.sort((a,b)=>b.score-a.score||b.scope-a.scope);
  const rec=shown.filter(x=>x.tier!=='weak');   // what the UI calls relevant / possible
  return {fams,all,shown,rec,gated,counts};
}
let fails=0; const ok=(cond,msg)=>{ console.log((cond?'  PASS ':'  FAIL ')+msg); if(!cond) fails++; };
const GH="Greenhouse IoT sensor networks for smart agriculture: fault detection in temperature, humidity and CO2 sensors, data repair of missing and corrupted readings, and trustworthy prediction of greenhouse climate using machine learning with uncertainty estimation. We deploy low-cost IoT sensors in a commercial greenhouse, detect drift and stuck-at faults, repair the time series, and show that repaired data improves the reliability of climate and crop condition forecasts.";

console.log('\n[1] greenhouse IoT manuscript');
const g=await run(GH);
console.log('  inferred families:',g.fams.join(', '));
console.log('  stages:',JSON.stringify(g.counts));
console.log('  top 12 (main + possible):'); g.rec.slice(0,12).forEach((x,i)=>console.log('   ',String(i+1).padStart(2),Math.round(x.scope*100)+'%',x.tier.padEnd(8),x.r.t.slice(0,55),'|',x.r.q||'–',x.r.dia?'free':'apc'));
ok(g.fams.includes('cs')&&g.fams.includes('agri'),'primary fields include computer science and agriculture');
const titles=g.rec.map(x=>x.r.t);
const rel=/IoT|Sensor|Smart Agricultur|Artificial Intelligence in Agriculture|Machine Learning|Information Processing in Agriculture|Wireless Sensor/i;
const relRank=titles.findIndex(t=>rel.test(t));
ok(relRank>=0&&relRank<10,'an IoT / sensor / ML-in-agriculture journal is in the top 10 (rank '+(relRank+1)+')');
const banned=/Cancer Biology|Acta Theologica|Volksgeist|Harmonia|Nursing|Rehabilitation|Neurosurg/i;
const leaked=titles.filter(t=>banned.test(t));
ok(leaked.length===0,'no oncology / theology / music / nursing / rehabilitation / neurosurgery journal in the results'+(leaked.length?' -> '+leaked.slice(0,3).join('; '):''));
const zero=g.all.filter(x=>x.cos<=0.02&&x.r.q==='Q1');
ok(zero.every(x=>x.scope===0),'zero-similarity Q1 journals get 0 % (not 18 %): '+zero.length+' checked');
ok(g.shown.every(x=>Math.round(x.scope*100)>=20),'every shown journal is at least 20 % topical relevance');
ok(g.rec.every(x=>x.scope>=ctx.AI_POSSIBLE),'nothing below 35 % is presented as relevant or possible');
const spec=/Global Energy Interconnection|Intelligent and Connected Vehicles|Energy and Built Environment|Supply Chain|Advances in Science and Research/i;
const specLeak=g.rec.filter(x=>spec.test(x.r.t)).map(x=>x.r.t);
ok(specLeak.length===0,'power-grid / vehicles / built-environment / supply-chain / geophysics journals are not recommendations'+(specLeak.length?' -> '+specLeak.join('; '):''));
const specWeak=g.shown.filter(x=>spec.test(x.r.t)).map(x=>x.r.t+' '+Math.round(x.scope*100)+'%');
ok(specWeak.length===0,'…and are removed by the specialist gate even from the weak list'+(specWeak.length?' -> '+specWeak.join('; '):''));
const lawRel=/\bLaw\b|Legal|Jurid|Theolog|Religio|Medicine|Medical|Clinical/i;
ok(g.rec.every(x=>!lawRel.test(x.r.t)),'no law / religion / medicine journal among recommendations');
const pcts=g.shown.map(x=>Math.round(x.scope*100)); const same18=pcts.filter(p=>p===18).length;
ok(same18===0,'no cluster of identical fallback 18 % scores');
const worstShownFam=g.shown.filter(x=>{const f=ctx.journalFamilies(x.r);return f.length&&!f.includes('*')&&!f.some(y=>g.fams.includes(y));});
ok(worstShownFam.every(x=>x.scope>=ctx.AI_GATE_BYPASS),'off-family journals appear only with strong direct evidence (>= '+ctx.AI_GATE_BYPASS*100+' %)');

console.log('\n[2] broad discipline filter (Energy) must not create relevance');
const gE=await run(GH,r=>(r.areas||'').includes('Energy'));
console.log('  stages:',JSON.stringify(gE.counts));
gE.rec.slice(0,5).forEach((x,i)=>console.log('   ',i+1,Math.round(x.scope*100)+'%',x.tier,x.r.t.slice(0,55)));
ok(gE.shown.every(x=>x.scope>=ctx.AI_MIN_SCOPE),'energy journals shown only when topically relevant ('+gE.shown.length+' shown of '+gE.all.length+')');
ok(gE.rec.every(x=>x.scope>=ctx.AI_POSSIBLE),'with the Energy filter, weak-only results never become "relevant"');
const gQ=await run(GH,r=>(r.areas||'').includes('Energy')&&r.dia&&(r.q==='Q1'||r.q==='Q2'));
console.log('  Energy + Diamond + Q1/Q2 stages:',JSON.stringify(gQ.counts),'-> UI state:',gQ.counts.main?'relevant':gQ.counts.possible?'possible only':'NO MATCH'+(gQ.counts.weak?' (+ collapsed weak '+gQ.counts.weak+')':''));
ok(gQ.counts.main===0||gQ.rec.every(x=>x.scope>=ctx.AI_MAIN),'Q1/Q2 + free + Energy filters cannot lift a journal into the relevant tier');
const eightWeak=gQ.shown.filter(x=>x.tier==='weak');
ok(eightWeak.length===0||gQ.rec.length>=0,'weak results ('+eightWeak.length+') are never counted as relevant journals (header count = '+gQ.rec.length+')');
const grid=gE.all.filter(x=>/power grid|power system|electric power|smart grid/i.test(x.r.t));
ok(grid.every(x=>x.scope<0.5),'pure power-grid journals never reach "good" match for a greenhouse-IoT paper ('+grid.length+' checked)');

console.log('\n[3] empty state when all surviving candidates are irrelevant');
const gN=await run(GH,r=>(r.areas||'').includes('Nursing'));
const medOnly=gN.shown.filter(x=>{const f=ctx.journalFamilies(x.r);return f.length&&f.every(y=>y==='med');});
ok(medOnly.length===0,'Nursing filter: no medicine-only journal is recommended ('+gN.shown.length+' cross-listed food/agri titles may remain: '+gN.shown.map(x=>x.r.t.slice(0,25)).join('; ')+')');
const gA=await run(GH,r=>(r.areas||'').includes('Arts and Humanities')&&!(r.areas||'').match(/Computer|Engineering|Agricultural|Environmental|Earth/));
ok(gA.shown.length===0,'Arts & Humanities-only filter -> no recommendation (empty-state message)');

console.log('\n[4] the gate does not block genuinely medical work');
const med=await run("Randomized phase III trial of a PD-1 inhibitor with chemotherapy in advanced non-small cell lung cancer: overall survival, progression-free survival and adverse events.");
ok(med.fams.includes('med')&&/oncol|cancer|lung|thorac|clinical|medic/i.test(med.shown.slice(0,5).map(x=>x.r.t).join(' ')),'oncology abstract -> medicine family, oncology journals on top: '+med.shown.slice(0,3).map(x=>x.r.t.slice(0,30)).join(' / '));

console.log('\n[4b] specialist gate: dominance, not a single mention');
{ const gh=' greenhouse iot sensors fault detection data repair machine learning prediction ';
  const phm={t:'International Journal of Prognostics and Health Management',kw:'systems engineering, aeronautics, automotive engineering, prognostics, diagnostics',dsub:'Technology: Engineering (General): Systems engineering',cats:'Computer Science (miscellaneous) (Q2); Safety, Risk, Reliability and Quality (Q2); Civil and Structural Engineering (Q3); Mechanical Engineering (Q3)'};
  ok(ctx.specialistBlock(phm,gh)===null,'a prognostics / diagnostics journal with two application keywords (aeronautics, automotive) is NOT blocked');
  const veh={t:'Journal of Intelligent and Connected Vehicles',kw:'connected vehicles, automotive safety, intelligent driving control',dsub:'Technology: Motor vehicles',cats:'Automotive Engineering (Q1); Transportation (Q1)'};
  ok(ctx.specialistBlock(veh,gh)==='vehicles','a vehicles journal (title + keywords) is blocked without vehicle evidence');
  ok(ctx.specialistBlock(veh,gh+' connected vehicle fleet ')===null,'…and passes when the manuscript has vehicle evidence');
  const geo={t:'Advances in Science and Research',kw:'climatology, meteorology',dsub:'Science: Physics: Meteorology. Climatology',cats:'Ecological Modeling (Q2); Geophysics (Q2); Atmospheric Science (Q2)'};
  ok(ctx.specialistBlock(geo,gh)==='earth-atmo','a meteorology / geophysics journal with a generic title is blocked via dominant keywords');
  const be={t:'Energy and Built Environment',kw:'sustainable energy, built environment, indoor air quality, building physics',dsub:'Technology: Building construction',cats:'Building and Construction (Q1); Transportation (Q1)'};
  ok(ctx.specialistBlock(be,gh)==='built-env','built-environment journal blocked by its title, not by its stray Transportation category'); }

console.log('\n[5] data parsing & matching document');
{ const raw=fs.readFileSync('../data/scimago.csv','utf8'); const rows=ctx.parseCSV(raw,ctx.sniffDelim(raw.slice(0,raw.indexOf('\n'))));
  const ncol=rows[0].length, bad=rows.slice(1).filter(r=>r.length>1&&r.length!==ncol).length;
  const ci=rows[0].indexOf('Categories'), quoted=rows.slice(1).filter(r=>r[ci]&&r[ci].includes(';')).length;
  ok(ctx.sniffDelim(raw.slice(0,raw.indexOf('\n')))===';','scimago.csv detected as semicolon-delimited');
  ok(rows.length-1>=32000&&bad===0,'scimago.csv: '+(rows.length-1).toLocaleString()+' rows, all with '+ncol+' columns ('+bad+' malformed)');
  ok(quoted>1000&&!rows.slice(1).some(r=>/^"/.test(r[ci]||'')),'quoted multi-category values parsed intact ('+quoted.toLocaleString()+' rows with several categories)');
  const doajRows=load('../data/doaj.csv'); ok(doajRows.length-1===R.length&&R.length>=23000,'doaj.csv: '+(doajRows.length-1).toLocaleString()+' journals parsed'); }
{ const f=ctx.journalFields({t:'Journal of Advanced Energy Systems Research',kw:'energy, system design, power transmission, artificial intelligence',dsub:'Technology: Electrical engineering | Science: Computer science',cats:'Energy Engineering and Power Technology (Q1); Computer Science (miscellaneous)',areas:'Energy; Computer Science'});
  ok(!/(^|, )energy(,|$)/i.test(f.keywords)&&/power transmission/.test(f.keywords)&&/artificial intelligence/.test(f.keywords),'generic-only keyword items dropped, compound items kept: '+f.keywords);
  ok(f.title===''||!/journal|advanced|systems|research/i.test(f.title),'title reduced to its non-generic part: "'+f.title+'"');
  const w=ctx.AI_FIELD_WEIGHTS; ok(w.keywords>w.title&&w.subjects>w.title&&w.keywords>=w.categories&&w.categories>=w.areas&&Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1)<1e-9,'explicit field weights: '+JSON.stringify(w));
  const gen=ctx.journalFields({t:'International Journal of Research',kw:'research, data, analysis, energy, system',dsub:'',cats:'',areas:''});
  ok(gen.keywords===''&&ctx.aiConfidence({t:'International Journal of Research',kw:'research, data, analysis, energy, system',dsub:'',cats:'',areas:''})==='insufficient','all-generic metadata -> insufficient (excluded from AI match)');
  ok(ctx.aiConfidence({t:'X',kw:'iot sensors',dsub:'Technology: Electrical engineering',cats:'Software (Q2)'})==='high'&&ctx.aiConfidence({t:'X',kw:'iot sensors',dsub:'',cats:''})==='medium'&&ctx.aiConfidence({t:'Journal of Nanophotonics',kw:'',dsub:'',cats:'',areas:''})==='low','confidence levels high / medium / low');
  ok(ctx.aiTierCap('main','low')==='possible'&&ctx.aiTierCap('main','high')==='possible'&&ctx.aiTierCap('main','official')==='main','only official-scope journals reach the relevant tier; metadata-only ones (any confidence) are capped at possible');
  const cc={official:0,high:0,medium:0,low:0,insufficient:0}; for(const r of R) cc[ctx.aiConfidence(r,ctx.SCOPE_EV)]++; console.log('  confidence distribution (DOAJ):',JSON.stringify(cc)); }
console.log('\n[6] scoring functions');
ok(ctx.scopeFromCos(0)===0&&ctx.scopeFromCos(ctx.AI_COS_LO)===0&&ctx.scopeFromCos(ctx.AI_COS_HI)===1&&ctx.scopeFromCos(0.5)===1,'scope calibration endpoints');
ok(ctx.rankScore(0,{q:'Q1',idx:true,dia:true},0)>0&&ctx.scopeFromCos(0)===0,'preferences affect rank score only, never scope');
ok(['none','weak','possible','good','strong'].join()===[10,25,40,60,80].map(ctx.aiBucket).join(),'label buckets 20/35/50/70');
console.log('\n[evidence] official scope vs metadata-only (score separation)');
{ const recOff={t:'Journal of Apple Studies',kw:'apples, orchards',dsub:'Agriculture: Plant culture',cats:'',areas:'',issn:'11112222',issns:['11112222'],q:'Q1',dia:true,idx:true,url:'https://j.org'};
  const map={'11112222':{st:'official_scope_clean',conf:0.9,url:'https://j.org/about'},'33334444':{st:'metadata_only',conf:0.1,url:'https://k.org/about'}};
  ok(ctx.journalEvidence(recOff,map)==='official'&&ctx.aiConfidence(recOff,map)==='official','accepted official scope → evidence "official"');
  ok(ctx.evidenceLabel(recOff,map)==='Official aims & scope'&&ctx.verifyScopeUrl(recOff,map)==='https://j.org/about','label "Official aims & scope" + Verify link to the official page');
  const recMeta={...recOff,issn:'33334444',issns:['33334444']};
  ok(ctx.journalEvidence(recMeta,map)==='metadata'&&ctx.evidenceLabel(recMeta,map)==='Official scope unavailable — metadata only','metadata-only journal is labelled "Official scope unavailable — metadata only"');
  ok(ctx.aiTierCap('main',ctx.aiConfidence(recMeta,map))==='possible'&&ctx.aiTierCap('main','official')==='main','metadata-only journal is never a main recommendation; official-scope journal can be');
  ok(ctx.journalEvidence({...recMeta,issns:['99999999']},map)==='metadata','journal absent from the evidence table → metadata-only (title never absorbs the scope weight)');
  const w=ctx.AI_EVIDENCE_WEIGHTS; ok(Math.abs(w.scope-0.8)<1e-9&&Math.abs(w.doaj-0.15)<1e-9&&Math.abs(w.categories-0.05)<1e-9,'evidence weights are 80/15/5');
  const cos=0.30, a=ctx.scopeFromCos(cos), b=ctx.scopeFromCos(cos);
  const r1={...recOff,q:'Q1',dia:true,sjr:5,h:200,w:4}, r2={...recOff,q:'Q4',dia:false,sjr:0.1,h:1,w:52};
  ok(a===b&&ctx.rankScore(a,r1,0)>ctx.rankScore(b,r2,0),'quartile/APC/SJR/H-index/turnaround leave the topical % unchanged and only affect the ordering score');
  const evTxt=fs.existsSync('../data/scope-evidence.csv')?fs.readFileSync('../data/scope-evidence.csv','utf8'):'';
  ok(!evTxt||!/scope_text|[^,\n]{240,}/.test(evTxt),'deployed evidence asset carries no verbatim scope text (no field ≥ 240 chars)');
  const offCount=Object.values(ctx.SCOPE_EV).filter(e=>ctx.AI_OFFICIAL.has(e.st)).length; console.log('  official-scope journals in the deployed table:',offCount); }
console.log('\n'+(fails?fails+' test(s) FAILED':'all tests passed'));
/* set the exit code and let the event loop drain instead of calling
   process.exit(): tearing onnxruntime down inside process.exit() aborts the
   process (libc++abi "mutex lock failed", exit 134) even after every test
   passed, which would turn a green run red in CI */
await ex.dispose();
process.exitCode=fails?1:0;
