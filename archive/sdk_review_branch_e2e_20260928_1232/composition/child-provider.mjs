import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';

// Process children keep an isolated Pi agentDir. Credentials remain in the
// existing read-only model runtime; neither credentials nor a catalog copy are
// written into the experiment. Forward the original hooks and model options.
const task = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { createLocalGrokModelConfig } = await import(pathToFileURL(join(task,
  'runtime-composition/poc/src/poc/pi-local-grok.mjs')));
const { modelRuntime, model } = await createLocalGrokModelConfig();
export default function childProvider(pi) {
  pi.registerProvider(model.provider, {
    api: model.api, baseUrl: model.baseUrl,
    apiKey: 'delegated-readonly-runtime',
    models: [model],
    streamSimple(_model, context, options) {
      const { apiKey: _delegatedMarker, ...requestOptions } = options ?? {};
      return modelRuntime.streamSimple(model, context, requestOptions);
    },
  });
}
