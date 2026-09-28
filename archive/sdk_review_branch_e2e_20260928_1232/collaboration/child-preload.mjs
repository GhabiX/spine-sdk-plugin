import { fileURLToPath } from 'node:url';

// The normal frozen child wrapper and Pi CLI are unchanged. Add the explicit
// provider extension before the final assignment argument, as Pi supports.
const entry = fileURLToPath(new URL('./child-provider.mjs', import.meta.url));
const marker = process.argv.indexOf('--');
process.argv.splice(marker < 0 ? process.argv.length - 1 : marker, 0,
  '--no-extensions', '--no-skills', '--no-context-files', '--approve', '--extension', entry);
