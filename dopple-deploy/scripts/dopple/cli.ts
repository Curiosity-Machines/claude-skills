#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { init } from './init.js';
import { login, whoami, resolveAuth } from './auth.js';
import { loadConfig } from './config.js';
import { runBuild } from './build.js';
import { runSmokeTest } from './smoke.js';
import { deploy, type DeployResult } from './deploy.js';

const HELP = `
dopple - Deploy activities to Dopple Studio

Usage:
  dopple <command> [options]

Commands:
  init        Initialize dopple.toml in the current directory
  login       Authenticate via browser OAuth
  whoami      Show the currently authenticated user
  deploy      Build, test, and deploy the activity

Options:
  --as <name>      Override the activity name for this deploy
  --token <token>  Use an explicit auth token
  --no-smoke       Skip the Playwright smoke test
  -h, --help       Show this help message
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      as: { type: 'string' },
      token: { type: 'string' },
      'no-smoke': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const command = positionals[0];
  const projectRoot = resolve('.');

  switch (command) {
    case 'init': {
      await init(projectRoot);
      break;
    }

    case 'login': {
      await login();
      break;
    }

    case 'whoami': {
      const email = await whoami(values.token);
      console.log(email);
      break;
    }

    case 'deploy': {
      const config = await loadConfig(projectRoot);

      // Build
      await runBuild(config, projectRoot);

      // Smoke test (unless --no-smoke)
      if (!values['no-smoke']) {
        try {
          await runSmokeTest(config, projectRoot);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('Playwright is not installed')) {
            console.log(`Skipping smoke test: ${msg}`);
          } else {
            throw err;
          }
        }
      } else {
        console.log('Skipping smoke test (--no-smoke).');
      }

      // Authenticate
      const accessToken = await resolveAuth(values.token);

      // Deploy
      const result: DeployResult = await deploy(config, projectRoot, accessToken, values.as);

      // Human-readable output
      console.log('');
      console.log('Deploy successful!');
      console.log(`  Activity: ${result.name}`);
      console.log(`  Version:  ${result.version}`);
      console.log(`  Manifest: ${result.manifest_url}`);
      if (result.qr_url) {
        console.log(`  QR Code:  ${result.qr_url}`);
      }
      console.log('');

      // Machine-readable output
      console.log(`__DEPLOY_RESULT__${JSON.stringify(result)}`);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
