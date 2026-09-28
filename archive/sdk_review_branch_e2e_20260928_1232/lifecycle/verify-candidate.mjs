import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [directory, destination] = process.argv.slice(2).map(value => resolve(value));
const source = join(directory, 'reconcile.mjs');
const bytes = await readFile(source);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const { reconcile } = await import(pathToFileURL(source));
assert.equal(typeof reconcile, 'function');
const canonical = value => JSON.parse(JSON.stringify(value));
function oracle(rows) {
  const totals = new Map(), invalidIndices = [], ignoredIndices = [];
  let totalCents = 0;
  rows.forEach((row, index) => {
    if (row === null || typeof row !== 'object' || typeof row.account !== 'string' || row.account.length === 0 || !Number.isSafeInteger(row.cents) || !['paid', 'cancelled'].includes(row.status)) {
      invalidIndices.push(index);
    } else if (row.status === 'cancelled') {
      ignoredIndices.push(index);
    } else {
      totalCents += row.cents;
      totals.set(row.account, (totals.get(row.account) ?? 0) + row.cents);
    }
  });
  return { totalCents, byAccount: Object.fromEntries(totals), invalidIndices, ignoredIndices };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const member of Object.values(value)) freeze(member);
    Object.freeze(value);
  }
  return value;
}
const orders = JSON.parse(await readFile(join(directory, 'orders.json'), 'utf8'));
const sets = [[], orders, [null, false, 0, 'paid', {}, [], {account:'',cents:1,status:'paid'}, {account:'x',cents:0.5,status:'paid'}, {account:'x',cents:1,status:'pending'}],
  ['__proto__', 'constructor', 'toString', 'hasOwnProperty', ' ', '0', '账户'].flatMap(account => [{account,cents:7,status:'paid'},{account,cents:-7,status:'paid'},{account,cents:123,status:'cancelled'}]),
  [{account:'a',cents:Number.MAX_SAFE_INTEGER,status:'paid'}, {account:'a',cents:-Number.MAX_SAFE_INTEGER,status:'paid'}, {account:'z',cents:Number.MAX_SAFE_INTEGER + 1,status:'cancelled'}]];
let seed = 0x73091;
const random = upper => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed % upper; };
const names = ['alpha','beta','__proto__','constructor','toString','账户','0'];
for (let group = 0; group < 100; group++) {
  const rows = [];
  for (let index = 0; index < random(60); index++) {
    const row = { account:names[random(names.length)], cents:random(2001)-1000, status:random(3) ? 'paid' : 'cancelled' };
    switch (random(8)) { case 0: rows.push(null); break; case 1: rows.push({...row,cents:'1'}); break; case 2: rows.push({...row,status:'pending'}); break; default: rows.push(row); }
  }
  sets.push(rows);
}
const checks = [];
for (const [index, rows] of sets.entries()) {
  const expected = oracle(rows), before = JSON.stringify(rows);
  try {
    const actual = reconcile(freeze(rows));
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
    assert.deepEqual(canonical(actual), expected);
    for (const name of Object.keys(expected.byAccount)) assert.ok(Object.hasOwn(actual.byAccount,name));
    assert.equal(JSON.stringify(rows), before);
    checks.push({index,rows:rows.length,passed:true});
  } catch (error) { checks.push({index,rows:rows.length,passed:false,error:error.message}); }
}
for (const value of [undefined,null,0,'',{},new Set()]) {
  try { assert.throws(() => reconcile(value),TypeError); checks.push({invalidInput:String(value),passed:true}); }
  catch (error) { checks.push({invalidInput:String(value),passed:false,error:error.message}); }
}
for (const [name, value] of [
  ['saved-result', JSON.parse(await readFile(join(directory,'result.json'),'utf8'))],
  ['cli',JSON.parse(execFileSync(process.execPath,[source,join(directory,'orders.json')],{cwd:directory,encoding:'utf8',timeout:10000}))]
]) {
  try { assert.deepEqual(value,oracle(orders)); checks.push({name,passed:true}); }
  catch (error) { checks.push({name,passed:false,error:error.message}); }
}
assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), sha256);
const result = { at:new Date().toISOString(), passed:checks.every(x=>x.passed), source, sha256, seed:'0x73091', checks, limitation:'Bounded independent functional check; not an official benchmark or proof over all JavaScript objects.' };
await writeFile(destination,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,checks:checks.length,failures:checks.filter(x=>!x.passed)}));
if (!result.passed) process.exitCode = 1;
