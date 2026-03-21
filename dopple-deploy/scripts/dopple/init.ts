import { writeFile, access } from 'node:fs/promises';
import { join, basename } from 'node:path';

interface DetectedProject {
  name: string;
  build_command?: string;
  build_output: string;
  entry_point: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-detect the project type and suggest sensible defaults.
 */
async function detectProject(projectRoot: string): Promise<DetectedProject> {
  const name = basename(projectRoot);

  const hasPackageJson = await fileExists(join(projectRoot, 'package.json'));
  const hasViteConfig = await fileExists(join(projectRoot, 'vite.config.ts'))
    || await fileExists(join(projectRoot, 'vite.config.js'));
  const hasRootIndex = await fileExists(join(projectRoot, 'index.html'));

  if (hasViteConfig) {
    return {
      name,
      build_command: 'npm run build',
      build_output: 'dist',
      entry_point: 'index.html',
    };
  }

  if (hasPackageJson) {
    return {
      name,
      build_command: 'npm run build',
      build_output: 'dist',
      entry_point: 'index.html',
    };
  }

  if (hasRootIndex) {
    // Static site, no build step needed
    return {
      name,
      build_output: '.',
      entry_point: 'index.html',
    };
  }

  // Fallback defaults
  return {
    name,
    build_output: 'dist',
    entry_point: 'index.html',
  };
}

/**
 * Initialize a new dopple.toml in the project root.
 */
export async function init(projectRoot: string): Promise<void> {
  const tomlPath = join(projectRoot, 'dopple.toml');

  if (await fileExists(tomlPath)) {
    throw new Error(`dopple.toml already exists at ${tomlPath}`);
  }

  const detected = await detectProject(projectRoot);

  const lines: string[] = [
    `name = "${detected.name}"`,
  ];

  if (detected.build_command) {
    lines.push(`build_command = "${detected.build_command}"`);
  }

  lines.push(`build_output = "${detected.build_output}"`);
  lines.push(`entry_point = "${detected.entry_point}"`);
  lines.push('# icon = "icon.png"');
  lines.push('');
  lines.push('[slack]');
  lines.push('channel = "#qr-f3st-26"');
  lines.push('');

  await writeFile(tomlPath, lines.join('\n'), 'utf-8');

  console.log(`Created ${tomlPath}`);
  console.log('');
  console.log('Detected settings:');
  console.log(`  name         = ${detected.name}`);
  if (detected.build_command) {
    console.log(`  build_command = ${detected.build_command}`);
  }
  console.log(`  build_output = ${detected.build_output}`);
  console.log(`  entry_point  = ${detected.entry_point}`);
  console.log('');
  console.log('Edit dopple.toml to customize, then run "dopple deploy".');
}
