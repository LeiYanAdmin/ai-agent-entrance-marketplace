/**
 * Worker CLI for AI Agent Entrance
 * Usage: worker-cli.js <start|stop|restart|status|hook>
 */

import { ProcessManager } from '../services/infrastructure/process-manager.js';
import { getWorkerPort, getWorkerHost } from '../shared/config.js';

const IS_TTY = process.stdin.isTTY;
const JSON_OUTPUT = '{"continue": true, "suppressOutput": true}';

async function start(): Promise<void> {
  const port = getWorkerPort();
  const result = await ProcessManager.start(port);

  if (result.success) {
    if (IS_TTY) {
      console.log(`Worker started (PID: ${result.pid})`);
      const date = new Date().toISOString().slice(0, 10);
      console.log(`Logs: ~/.ai-agent-entrance/logs/worker-${date}.log`);
    } else {
      console.log(JSON_OUTPUT);
    }
    process.exit(0);
  } else {
    console.error(`Failed to start: ${result.error}`);
    process.exit(1);
  }
}

async function stop(): Promise<void> {
  await ProcessManager.stop();
  console.log(IS_TTY ? 'Worker stopped' : JSON_OUTPUT);
  process.exit(0);
}

async function restart(): Promise<void> {
  const port = getWorkerPort();
  const result = await ProcessManager.restart(port);

  if (result.success) {
    console.log(IS_TTY ? `Worker restarted (PID: ${result.pid})` : JSON_OUTPUT);
    process.exit(0);
  } else {
    console.error(`Failed to restart: ${result.error}`);
    process.exit(1);
  }
}

async function status(): Promise<void> {
  const info = await ProcessManager.status();

  if (IS_TTY) {
    if (info.running) {
      console.log('Worker is running');
      console.log(`  PID: ${info.pid}`);
      console.log(`  Port: ${info.port}`);
      console.log(`  Uptime: ${info.uptime}`);
    } else {
      console.log('Worker is not running');
    }
  } else {
    console.log(JSON_OUTPUT);
  }
  process.exit(0);
}

async function hook(hookType: string): Promise<void> {
  const port = getWorkerPort();
  const host = getWorkerHost();

  // Ensure worker is running
  const running = await ProcessManager.isRunning();
  if (!running) {
    const result = await ProcessManager.start(port);
    if (!result.success) {
      console.error(JSON.stringify({ continue: true, suppressOutput: true, error: result.error }));
      process.exit(0); // Exit 0 to not block Claude
    }
  }

  // Read stdin for hook input
  let input = '';
  if (!IS_TTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks).toString('utf-8');
  }

  // Map hook type to endpoint
  const endpoints: Record<string, string> = {
    'session-start': '/api/hook/session-start',
    'user-prompt': '/api/hook/user-prompt',
    'tool-use': '/api/hook/tool-use',
    'stop': '/api/hook/stop',
    'context': '/api/context/inject',
  };

  const endpoint = endpoints[hookType];
  if (!endpoint) {
    console.error(`Unknown hook type: ${hookType}`);
    console.log(JSON_OUTPUT);
    process.exit(0);
  }

  try {
    let response: Response;

    if (hookType === 'context') {
      // GET request for context injection
      const project = process.env.CLAUDE_PROJECT || process.cwd();
      response = await fetch(`http://${host}:${port}${endpoint}?project=${encodeURIComponent(project)}`, {
        signal: AbortSignal.timeout(30000),
      });
    } else {
      // POST request for hooks
      let body: Record<string, unknown> = {};
      if (input) {
        try {
          body = JSON.parse(input);
        } catch {
          // Input is not JSON, use as raw string
          body = { raw: input };
        }
      }

      // Add project from env if not in body
      if (!body.project) {
        body.project = process.env.CLAUDE_PROJECT || process.cwd();
      }

      response = await fetch(`http://${host}:${port}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    }

    const result = await response.json();
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    // Don't block Claude on errors
    console.log(JSON_OUTPUT);
    process.exit(0);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      await stop();
      break;
    case 'restart':
      await restart();
      break;
    case 'status':
      await status();
      break;
    case 'hook':
      const hookType = process.argv[3];
      if (!hookType) {
        console.error('Usage: worker-cli.js hook <session-start|user-prompt|tool-use|stop|context>');
        process.exit(1);
      }
      await hook(hookType);
      break;
    default:
      console.log('Usage: worker-cli.js <start|stop|restart|status|hook>');
      process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
