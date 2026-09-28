import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const dir = resolve(process.argv[2]), output = resolve(process.argv[3]);
const signed=process.argv[4]==='signed';
const path = join(dir, 'ledger.mjs'), bytes = await readFile(path);
const artifacts=await Promise.all(['ledger.mjs','validation.mjs','aggregation.mjs'].map(async name=>({name,sha256:createHash('sha256').update(await readFile(join(dir,name))).digest('hex')})));
const validation=await import(pathToFileURL(join(dir,'validation.mjs')));
const aggregation=await import(pathToFileURL(join(dir,'aggregation.mjs')));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const candidate = await import(pathToFileURL(path));
// Independent reference: character and integer checks, without using the
// candidate implementation or its own assertions.
const valid = row => {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
  if (typeof row.id !== 'string' || row.id.length < 1 || row.id.length > 16) return false;
  if (![...row.id].every(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.includes(c))) return false;
  return Number.isInteger(row.amountMinor) && row.amountMinor >= (signed ? -1000000000 : 0) && row.amountMinor <= 1000000000;
};
const expected = rows => {
  let amount = 0n, acceptedCount = 0; const invalidIndexes = [];
  rows.forEach((row, i) => { if (valid(row)) { amount += BigInt(row.amountMinor); acceptedCount++; } else invalidIndexes.push(i); });
  return { totalMinor: Number(amount), acceptedCount, invalidIndexes };
};
const rows = [null, undefined, [], {}, 0, '', true, { id: 'a', amountMinor: 0 }, { id: 'b', amountMinor: 1000000000 }];
for (const id of ['', 'x', '_-', 'A0_b-9', 'a'.repeat(16), 'a'.repeat(17), 'space id', 'é', 'a\n', 12, null])
  for (const amountMinor of [-1000000001, -1000000000, -1, 0, 1, 1.5, 1000000000, 1000000001, '1', null, NaN, Infinity]) rows.push({ id, amountMinor, extra: true });
for (const row of rows) assert.equal(validation.validateRow(row), valid(row), JSON.stringify(row));
const batches = [[], [{ id: 'same', amountMinor: 10 }, { id: 'same', amountMinor: 20 }], Array.from({ length: 100 }, () => ({ id: 'x', amountMinor: 1000000000 }))];
for (let start = 0; start < rows.length; start += 40) batches.push(rows.slice(start, start + 40));
for (const batch of batches) {
 assert.deepEqual(candidate.summarizeRows(batch),expected(batch));
 const accepted=batch.filter(valid), total=expected(accepted);
 assert.deepEqual(aggregation.aggregateValidRows(accepted),{totalMinor:total.totalMinor,acceptedCount:total.acceptedCount});
}
for (const value of [null, undefined, {}, 12, '[]', true]) assert.throws(() => candidate.summarizeRows(value), TypeError);
const cliInput = [{ id: 'a', amountMinor: 100 }, { id: 'bad id', amountMinor: 10 }, { id: 'a', amountMinor: 25 }];
const cli = JSON.parse(execFileSync(process.execPath, [path, JSON.stringify(cliInput)], { cwd: dir, encoding: 'utf8' }));
assert.deepEqual(cli, expected(cliInput));
assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), sha256);
const result = { passed: true, path, sha256, artifacts, signed, validationInputs: rows.length, aggregationBatches: batches.length, nonArrayCases: 6, cliCases: 1 };
await writeFile(output, JSON.stringify(result, null, 2)+'\n'); console.log(JSON.stringify(result));
