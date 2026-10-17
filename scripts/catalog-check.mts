import { readFile } from 'node:fs/promises';
import { parseCatalog } from '../src/core.ts';

const path = process.argv[2] ?? 'data/catalog.json';
const input = await readFile(path, 'utf8');
if (Buffer.byteLength(input) > 2_000_000) throw new Error('Catalog exceeds the 2 MB download limit.');
const catalog = parseCatalog(JSON.parse(input));
console.log(`Valid catalog ${catalog.revision}: ${catalog.models.length} models, ${catalog.benchmarks.length} benchmark observations, ${catalog.sources.length} sources.`);
