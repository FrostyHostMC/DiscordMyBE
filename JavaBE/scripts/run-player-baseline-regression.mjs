import { createServer } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const fixtures = await server.ssrLoadModule('/src/utils/regressionSchemaFixtures.ts');
  const result = fixtures.measurePlayerMolangVariableInitialization();
  const summary = {
    id: result.id,
    label: result.label,
    status: result.status,
    passed: result.assertions.filter((assertion) => assertion.passed).length,
    total: result.assertions.length,
    findings: result.findings,
    unavailable: result.unavailable,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\\n`);
  if (result.status !== 'passed') process.exitCode = 1;
} finally {
  await server.close();
}
