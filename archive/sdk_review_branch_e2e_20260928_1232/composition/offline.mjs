import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const task = resolve(fileURLToPath(new URL('..', import.meta.url)));
const testbed = resolve(process.argv[2]);
const evidence = join(task, 'evidence/composition');
await mkdir(evidence, { recursive: true });
const run = (command, args, env = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { cwd: task, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject); child.on('exit', code => resolveRun({ code: code ?? 1, stdout, stderr }));
});
const mixed = await run(process.execPath, ['--test', join(task, 'composition/mixed-fixture.test.mjs')], { SPINE_PLUGIN_WORKSPACE: join(task, 'runtime-composition/sdk') });
await writeFile(join(evidence, 'mixed-offline.log'), mixed.stdout + mixed.stderr);
assert.equal(mixed.code, 0, mixed.stderr);
const structureDir = join(testbed, 'structure-offline');
const structure = await run(process.execPath, [join(task, 'composition/structure-offline.mjs'), structureDir]);
await writeFile(join(evidence, 'structure-offline.log'), structure.stdout + structure.stderr);
assert.equal(structure.code, 0, structure.stderr);
const result = {
  passed: true,
  provider: 'scripted-no-network',
  latestSdkCommit: JSON.parse(await readFile(join(task, 'evidence/collaboration/runtime-manifest-live.json'), 'utf8')).sdkCommit,
  mixedFixture: { exit: mixed.code, latestRuntime: true },
  structureFixture: { exit: structure.code, result: JSON.parse(await readFile(join(structureDir, 'result.json'), 'utf8')) },
  compositionBoundary: 'The two deterministic Pi fixtures share the immutable runtime but retain independent trees; no single-run cross-feature causality is claimed.',
  testbed,
};
await writeFile(join(evidence, 'offline-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
