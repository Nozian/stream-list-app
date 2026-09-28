import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const assets = {};
for (const file of ['index.html', 'style.css', 'app.js', 'model.js']) {
  assets[`/${file === 'index.html' ? '' : file}`] = await readFile(new URL(`../web/${file}`, import.meta.url), 'utf8');
}
const template = await readFile(new URL('../worker/index.template.js', import.meta.url), 'utf8');
const dist = new URL('../dist/', import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(new URL('server/', dist), { recursive: true });
await mkdir(new URL('.openai/', dist), { recursive: true });
await writeFile(new URL('server/index.js', dist), template.replace('__ASSETS__', JSON.stringify(assets)));
await cp(new URL('../.openai/hosting.json', import.meta.url), new URL('.openai/hosting.json', dist));
try { await cp(new URL('../drizzle/', import.meta.url), new URL('drizzle/', dist), { recursive: true }); } catch {}
