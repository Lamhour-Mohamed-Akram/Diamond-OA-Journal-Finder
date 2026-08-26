#!/usr/bin/env node
/* Precomputes one semantic embedding per DOAJ journal for the in-browser
   "AI match" tab (js/ai.js). Output: data/embeddings.bin

   Model: Xenova/all-MiniLM-L6-v2 (384 dims, int8 ONNX, ~23 MB), the same
   model the browser runs through Transformers.js, so both sides live in the
   same vector space. Each journal is described by its title + DOAJ keywords +
   DOAJ subjects + SCImago categories (DOAJ has no aims & scope text, only a
   URL to it). In the app, only the visitor's abstract is embedded live; the
   journals are compared against this file with a cosine similarity.

   Binary layout (little-endian):
     "OAE1"            4 bytes  magic / format version
     uint32 n          number of journals
     uint32 dim        vector length (384)
     float32 scale     int8 → float multiplier (vectors are unit-length)
     n × 8 bytes       ISSN (ASCII, digits/X) the app joins on
     n × dim int8      quantized vectors, row-major
   ≈ 9 MB for 23k journals (fp32 would be 35 MB). Quantization error is far
   below the differences that matter for ranking.

   Run after every DOAJ refresh:
     cd scripts && npm install && npm run build:embeddings
   First run downloads the model from the Hugging Face hub (cached afterwards). */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/embeddings.bin');
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const BATCH = 64;
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf-8');

/* ---- load the app's join logic so the journal set is exactly the app's ---- */
const ctx = { indexedDB: undefined, console };
vm.createContext(ctx);
vm.runInContext(rd('js/data.js'), ctx, { filename: 'data.js' });
const { parseCSV, sniffDelim, doajCsvToInters, assemble } = ctx;
const load = f => { const t = rd(f); return parseCSV(t, sniffDelim(t.slice(0, t.indexOf('\n')))); };
const R = assemble(doajCsvToInters(load('data/doaj.csv')), load('data/scimago.csv')).records.filter(r => r.issn);

/* ---- the text that stands in for each journal's scope ---- */
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
function journalText(r){
  const cats = clean(r.cats).split(';').map(c => c.replace(/\s*\(Q[1-4]\)\s*$/, '').trim()).filter(Boolean);
  const subs = clean(r.dsub).split('|').map(s => s.trim()).filter(Boolean);
  const parts = [clean(r.t), clean(r.kw), subs.join('; '), cats.join('; ')].filter(Boolean);
  return parts.join('. ');
}

env.allowLocalModels = false;
console.log(`Embedding ${R.length.toLocaleString()} journals with ${MODEL} …`);
const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });

const dimProbe = await extractor('probe', { pooling: 'mean', normalize: true });
const DIM = dimProbe.dims[1];
const vecs = new Float32Array(R.length * DIM);
const t0 = Date.now();
for (let i = 0; i < R.length; i += BATCH) {
  const batch = R.slice(i, i + BATCH);
  const out = await extractor(batch.map(journalText), { pooling: 'mean', normalize: true });
  vecs.set(out.data, i * DIM);
  if ((i / BATCH) % 20 === 0 || i + BATCH >= R.length) {
    const done = Math.min(i + BATCH, R.length), s = (Date.now() - t0) / 1000;
    process.stdout.write(`  ${done.toLocaleString()} / ${R.length.toLocaleString()}  (${s.toFixed(0)}s, ETA ${(s / done * (R.length - done)).toFixed(0)}s)\n`);
  }
}

/* ---- quantize to int8 with one global scale ---- */
let maxAbs = 0;
for (let i = 0; i < vecs.length; i++) { const a = Math.abs(vecs[i]); if (a > maxAbs) maxAbs = a; }
const scale = maxAbs / 127;
const head = Buffer.alloc(16);
head.write('OAE1', 0, 'ascii');
head.writeUInt32LE(R.length, 4);
head.writeUInt32LE(DIM, 8);
head.writeFloatLE(scale, 12);
const ids = Buffer.alloc(R.length * 8, ' ');
R.forEach((r, i) => ids.write(r.issn.padEnd(8).slice(0, 8), i * 8, 'ascii'));
const q = Buffer.alloc(R.length * DIM);
for (let i = 0; i < vecs.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(vecs[i] / scale))) & 0xff;

/* sanity check before overwriting: enough journals, and quantized vectors still rank sensibly */
if (R.length < 15000) throw new Error(`only ${R.length} journals - refusing to write a truncated file`);
const dot = (a, b) => { let s = 0; for (let k = 0; k < DIM; k++) s += a[k] * b[k]; return s; };
const deq = i => Array.from(q.subarray(i * DIM, (i + 1) * DIM), b => ((b << 24) >> 24) * scale);
const self = dot(deq(0), Array.from(vecs.subarray(0, DIM)));
if (self < 0.98) throw new Error(`quantization check failed (cos = ${self.toFixed(3)})`);

fs.writeFileSync(OUT, Buffer.concat([head, ids, q]));
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${R.length.toLocaleString()} × ${DIM} int8, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB, scale ${scale.toExponential(3)}`);
