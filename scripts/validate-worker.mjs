import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../dist/server/index.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const worker = await import(moduleUrl);
assert.equal(typeof worker.default?.fetch, 'function');
JSON.parse(await readFile(new URL('../dist/.openai/hosting.json', import.meta.url), 'utf8'));
console.log('Worker artifact is valid.');
