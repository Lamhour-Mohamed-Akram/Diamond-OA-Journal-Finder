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
const byIssn=new Map(); for(const r of R) for(const i of (r.issns||[])) if(!byIssn.has(i)) byIssn.set(i,r);
const buf=fs.readFileSync('../data/embeddings.bin'); const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
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
  const shown=[];
  for(const x of all){ if(x.scope<ctx.AI_MIN_SCOPE) continue; if(!ctx.gatePasses(x.r,fams,x.scope)){gated++;continue;} shown.push({...x,score:ctx.rankScore(x.scope,x.r,0)}); }
  shown.sort((a,b)=>b.score-a.score||b.scope-a.scope);
  return {fams,all,shown,gated};
}
let fails=0; const ok=(cond,msg)=>{ console.log((cond?'  PASS ':'  FAIL ')+msg); if(!cond) fails++; };
const GH="Greenhouse IoT sensor networks for smart agriculture: fault detection in temperature, humidity and CO2 sensors, data repair of missing and corrupted readings, and trustworthy prediction of greenhouse climate using machine learning with uncertainty estimation. We deploy low-cost IoT sensors in a commercial greenhouse, detect drift and stuck-at faults, repair the time series, and show that repaired data improves the reliability of climate and crop condition forecasts.";

console.log('\n[1] greenhouse IoT manuscript');
const g=await run(GH);
console.log('  inferred families:',g.fams.join(', '),'| shown:',g.shown.length,'| gated:',g.gated);
console.log('  top 12:'); g.shown.slice(0,12).forEach((x,i)=>console.log('   ',String(i+1).padStart(2),Math.round(x.scope*100)+'%',x.r.t.slice(0,55),'|',x.r.q||'–',x.r.dia?'free':'apc'));
ok(g.fams.includes('cs')&&g.fams.includes('agri'),'primary fields include computer science and agriculture');
const titles=g.shown.map(x=>x.r.t);
const rel=/IoT|Sensor|Smart Agricultur|Artificial Intelligence in Agriculture|Machine Learning|Information Processing in Agriculture|Wireless Sensor/i;
const relRank=titles.findIndex(t=>rel.test(t));
ok(relRank>=0&&relRank<10,'an IoT / sensor / ML-in-agriculture journal is in the top 10 (rank '+(relRank+1)+')');
const banned=/Cancer Biology|Acta Theologica|Volksgeist|Harmonia|Nursing|Rehabilitation|Neurosurg/i;
const leaked=titles.filter(t=>banned.test(t));
ok(leaked.length===0,'no oncology / theology / music / nursing / rehabilitation / neurosurgery journal in the results'+(leaked.length?' -> '+leaked.slice(0,3).join('; '):''));
const zero=g.all.filter(x=>x.cos<=0.02&&x.r.q==='Q1');
ok(zero.every(x=>x.scope===0),'zero-similarity Q1 journals get 0 % (not 18 %): '+zero.length+' checked');
ok(g.shown.every(x=>Math.round(x.scope*100)>=20),'every shown journal is at least 20 % topical relevance');
const pcts=g.shown.map(x=>Math.round(x.scope*100)); const same18=pcts.filter(p=>p===18).length;
ok(same18===0,'no cluster of identical fallback 18 % scores');
const worstShownFam=g.shown.filter(x=>{const f=ctx.journalFamilies(x.r);return f.length&&!f.includes('*')&&!f.some(y=>g.fams.includes(y));});
ok(worstShownFam.every(x=>x.scope>=ctx.AI_GATE_BYPASS),'off-family journals appear only with strong direct evidence (>= '+ctx.AI_GATE_BYPASS*100+' %)');

console.log('\n[2] broad discipline filter (Energy) must not create relevance');
const gE=await run(GH,r=>(r.areas||'').includes('Energy'));
gE.shown.slice(0,5).forEach((x,i)=>console.log('   ',i+1,Math.round(x.scope*100)+'%',x.r.t.slice(0,55)));
ok(gE.shown.every(x=>x.scope>=ctx.AI_MIN_SCOPE),'energy journals shown only when topically relevant ('+gE.shown.length+' shown of '+gE.all.length+')');
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

console.log('\n[5] scoring functions');
ok(ctx.scopeFromCos(0)===0&&ctx.scopeFromCos(0.12)===0&&ctx.scopeFromCos(0.5)===1,'scope calibration endpoints');
ok(ctx.rankScore(0,{q:'Q1',idx:true,dia:true},0)>0&&ctx.scopeFromCos(0)===0,'preferences affect rank score only, never scope');
ok(['none','weak','possible','good','strong'].join()===[10,25,40,60,80].map(ctx.aiBucket).join(),'label buckets 20/35/50/70');
console.log('\n'+(fails?fails+' test(s) FAILED':'all tests passed'));
process.exit(fails?1:0);
