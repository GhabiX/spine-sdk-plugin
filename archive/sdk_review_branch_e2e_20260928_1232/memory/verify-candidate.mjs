import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [directory, revision, output] = process.argv.slice(2);
assert.ok(['initial', 'revised'].includes(revision));
const path = join(resolve(directory), 'parser.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const before = sha(await readFile(path));
const { parseMinorUnits } = await import(pathToFileURL(path));
assert.equal(typeof parseMinorUnits, 'function');
const cases = [null, false, true, 0, 12.3, [], ['12'], {}, '', ' ', ' 12', '12 ', '+12', '-0', '-12', '1e2', '0x10', 'Infinity', 'NaN', '.', '12..', '..50', '.123', '1.234', '1234567890123', '0000000000000', '12\n', '１２', '\t1', '1_000', '.5', '.50', '12.', '0.', '000.'];
for (const integer of ['0', '1', '9', '12', '001', '000000000000', '123456789012', '999999999999']) {
  for (const fraction of ['', '.0', '.00', '.01', '.09', '.1', '.10', '.50', '.99', '.999']) cases.push(integer + fraction);
}
const check = revision === 'initial' ? /^[0-9]{1,12}(?:\.[0-9]{1,2})?$/ : /^(?:[0-9]{1,12}(?:\.[0-9]{0,2})?|\.[0-9]{1,2})$/;
const failures=[];
for (const value of cases) {
  let expected=null;
  if (typeof value === 'string' && check.test(value) && !/[\r\n]/.test(value)) {
    const [integer, fractional=''] = value.split('.');
    expected = Number(BigInt(integer || '0') * 100n + BigInt(fractional.padEnd(2,'0')));
  }
  try { assert.equal(parseMinorUnits(value), expected); }
  catch (e) { failures.push({value,expected,error:e.message}); }
}
assert.equal(sha(await readFile(path)),before,'candidate changed during host validation');
const result={passed:failures.length===0,revision,cases:cases.length,candidate:path,sha256:before,failures};
await writeFile(resolve(output),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
if(failures.length)process.exitCode=1;
