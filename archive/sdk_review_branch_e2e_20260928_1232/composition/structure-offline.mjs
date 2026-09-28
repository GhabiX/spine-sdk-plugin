import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const task = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = resolve(process.argv[2]);
const source = join(task, 'composition/structure-fixture.mjs');
const child = spawn(process.execPath, [source, target], {
  cwd: task,
  env: { ...process.env, SPINE_PLUGIN_WORKSPACE: join(task, 'runtime-composition/sdk') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const code = await new Promise((resolveExit, reject) => { child.on('error', reject); child.on('exit', (status) => resolveExit(status ?? 1)); });
await writeFile(join(target, 'offline.stdout.log'), stdout);
await writeFile(join(target, 'offline.stderr.log'), stderr);
if (code !== 0) throw new Error(`structure fixture exited ${code}: ${stderr}`);
console.log(stdout.trim());
