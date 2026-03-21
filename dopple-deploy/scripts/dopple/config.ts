import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

export interface DoppleConfig {
  name: string;
  build_output: string;
  entry_point: string;
  build_command?: string;
  icon?: string;
  slack?: {
    channel?: string;
  };
}

const REQUIRED_FIELDS = ['name', 'build_output', 'entry_point'] as const;

export async function loadConfig(projectRoot: string): Promise<DoppleConfig> {
  const configPath = join(projectRoot, 'dopple.toml');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    throw new Error(
      `Could not read dopple.toml at ${configPath}. Run "dopple init" to create one.`
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to parse dopple.toml: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof parsed[field] !== 'string' || parsed[field].length === 0) {
      throw new Error(`dopple.toml: missing or empty required field "${field}"`);
    }
  }

  const config: DoppleConfig = {
    name: parsed.name as string,
    build_output: parsed.build_output as string,
    entry_point: parsed.entry_point as string,
  };

  if (typeof parsed.build_command === 'string') {
    config.build_command = parsed.build_command;
  }

  if (typeof parsed.icon === 'string') {
    config.icon = parsed.icon;
  }

  if (parsed.slack && typeof parsed.slack === 'object') {
    const slack = parsed.slack as Record<string, unknown>;
    config.slack = {};
    if (typeof slack.channel === 'string') {
      config.slack.channel = slack.channel;
    }
  }

  return config;
}
