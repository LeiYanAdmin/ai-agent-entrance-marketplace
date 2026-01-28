#!/usr/bin/env node
/**
 * Build script for AI Agent Entrance
 * Bundles TypeScript source into plugin/scripts/
 */

import { build } from 'esbuild';
import { cpSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const PLUGIN = join(ROOT, 'plugins', 'ai-agent-entrance');
const SCRIPTS = join(PLUGIN, 'scripts');

const isWatch = process.argv.includes('--watch');

async function main() {
  console.log('Building AI Agent Entrance...');

  // Ensure output directories exist
  mkdirSync(SCRIPTS, { recursive: true });

  // Common build options
  const commonOptions = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: false,
    minify: false,
    external: [
      'better-sqlite3',
      '@anthropic-ai/sdk',
      '@modelcontextprotocol/sdk',
    ],
  };

  // Build worker service
  await build({
    ...commonOptions,
    entryPoints: [join(SRC, 'services', 'worker-service.ts')],
    outfile: join(SCRIPTS, 'worker-service.cjs'),
    banner: {
      js: '#!/usr/bin/env node',
    },
  });
  console.log('✓ Built worker-service.cjs');

  // Build worker CLI
  await build({
    ...commonOptions,
    entryPoints: [join(SRC, 'cli', 'worker-cli.ts')],
    outfile: join(SCRIPTS, 'worker-cli.cjs'),
    banner: {
      js: '#!/usr/bin/env node',
    },
  });
  console.log('✓ Built worker-cli.cjs');

  // Build MCP server (bundle @modelcontextprotocol/sdk since it runs standalone)
  await build({
    ...commonOptions,
    external: ['better-sqlite3', '@anthropic-ai/sdk'],
    entryPoints: [join(SRC, 'mcp', 'entrance-mcp-server.ts')],
    outfile: join(SCRIPTS, 'entrance-mcp-server.cjs'),
    banner: {
      js: '#!/usr/bin/env node',
    },
  });
  console.log('✓ Built entrance-mcp-server.cjs');

  // Make scripts executable (required for MCP server stdio launch)
  for (const script of ['worker-service.cjs', 'worker-cli.cjs', 'entrance-mcp-server.cjs']) {
    chmodSync(join(SCRIPTS, script), 0o755);
  }
  console.log('✓ Set executable permissions');

  // Copy config files if they exist in src
  const configSrc = join(ROOT, 'plugins', 'ai-agent-entrance', 'config');
  if (existsSync(configSrc)) {
    console.log('✓ Config files preserved');
  }

  console.log('\nBuild complete!');
  console.log(`Output: ${SCRIPTS}`);

  if (isWatch) {
    console.log('\nWatching for changes...');
    // Watch mode would require additional setup
  }
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
