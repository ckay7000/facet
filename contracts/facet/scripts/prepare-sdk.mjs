import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// near-sdk-js 2.0.0 predates the JS binding for NEAR's native Ed25519 host call.
// Add only that binding. Fail closed if the pinned SDK builder changes.
const file = new URL('../node_modules/near-sdk-js/builder/builder.c', import.meta.url);
const originalHash = 'e8d9b0429dd88cdf125e3b44e00b89dd8e2d58d4b6a2ba6b76583284255a6ee5';
const native = await readFile(new URL('../src/native-ed25519.c.inc', import.meta.url), 'utf8');
const registration = '  JS_SetPropertyStr(ctx, env, "ed25519_verify", JS_NewCFunction(ctx, near_ed25519_verify, "ed25519_verify", 3));\n';
let source = await readFile(file, 'utf8');
if (source.includes('static JSValue near_ed25519_verify')) {
  source = source.replace(native + '\n', '').replace(registration, '');
}
if (createHash('sha256').update(source).digest('hex') !== originalHash) throw new Error('Unexpected NEAR SDK builder; review the native binding before building.');
source = source.replace('static JSValue near_ecrecover(', native + '\nstatic JSValue near_ecrecover(')
  .replace('  JS_SetPropertyStr(ctx, env, "ecrecover",', registration + '  JS_SetPropertyStr(ctx, env, "ecrecover",');
await writeFile(file, source);
