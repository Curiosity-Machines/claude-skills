import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { DoppleConfig } from './config.js';

/**
 * Run the configured build command (if any) and verify the output directory exists.
 */
export async function runBuild(config: DoppleConfig, projectRoot: string): Promise<void> {
  if (config.build_command) {
    console.log(`Running build: ${config.build_command}`);

    const parts = config.build_command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    try {
      execFileSync(cmd, args, {
        cwd: projectRoot,
        stdio: 'inherit',
      });
    } catch {
      throw new Error(`Build command failed: ${config.build_command}`);
    }
  }

  // Verify build output directory exists
  const outputDir = join(projectRoot, config.build_output);
  try {
    await access(outputDir);
  } catch {
    throw new Error(
      `Build output directory does not exist: ${outputDir}\n` +
      (config.build_command
        ? 'The build command may have failed or produced output elsewhere.'
        : 'No build_command is configured. Ensure the directory exists.')
    );
  }
}
