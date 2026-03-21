import { createWriteStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import type { DoppleConfig } from './config.js';

export interface DeployResult {
  id: string;
  name: string;
  version: number;
  manifest_url: string;
  qr_url: string;
}

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!url) {
    throw new Error('Missing SUPABASE_URL or VITE_SUPABASE_URL environment variable.');
  }
  return url;
}

/**
 * Create a ZIP archive of the build output directory.
 * Returns the path to the temporary ZIP file.
 */
async function createZip(buildDir: string): Promise<string> {
  const zipPath = join(tmpdir(), `dopple-${randomUUID()}.zip`);

  return new Promise<string>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(buildDir, false);
    archive.finalize();
  });
}

/**
 * Deploy an activity to Dopple Studio.
 *
 * Three-phase deployment:
 * 1. POST metadata -> get signed upload URLs
 * 2. PUT ZIP bundle and icon to signed URLs
 * 3. POST finalize -> get manifest URL and version
 */
export async function deploy(
  config: DoppleConfig,
  projectRoot: string,
  accessToken: string,
  nameOverride?: string
): Promise<DeployResult> {
  const supabaseUrl = getSupabaseUrl();
  const deployUrl = `${supabaseUrl}/functions/v1/deploy-activity`;
  const activityName = nameOverride || config.name;
  const buildDir = join(projectRoot, config.build_output);

  // Create ZIP of build output
  console.log('Packaging build output...');
  const zipPath = await createZip(buildDir);

  let iconData: Buffer | null = null;
  let iconContentType = 'image/png';
  if (config.icon) {
    const iconPath = join(projectRoot, config.icon);
    iconData = await readFile(iconPath);
    if (config.icon.endsWith('.svg')) {
      iconContentType = 'image/svg+xml';
    } else if (config.icon.endsWith('.jpg') || config.icon.endsWith('.jpeg')) {
      iconContentType = 'image/jpeg';
    }
  }

  try {
    // Phase 1: Request signed upload URLs
    console.log(`Deploying "${activityName}"...`);

    const iconExtension = config.icon
      ? config.icon.split('.').pop()?.toLowerCase()
      : undefined;

    const initBody: Record<string, unknown> = {
      action: 'init',
      name: activityName,
      entry_point: config.entry_point,
      has_icon: !!iconData,
      ...(iconData && iconExtension ? { icon_extension: iconExtension } : {}),
    };

    const initRes = await fetch(deployUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(initBody),
    });

    if (!initRes.ok) {
      const errText = await initRes.text();
      throw new Error(`Deploy init failed (${initRes.status}): ${errText}`);
    }

    const initData = await initRes.json() as {
      activity_id: string;
      bundle_upload_url: string;
      icon_upload_url?: string;
    };

    // Phase 2: Upload files to signed URLs
    console.log('Uploading bundle...');
    const zipData = new Uint8Array(await readFile(zipPath));

    const bundleRes = await fetch(initData.bundle_upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/zip' },
      body: zipData,
    });

    if (!bundleRes.ok) {
      throw new Error(`Bundle upload failed (${bundleRes.status})`);
    }

    if (iconData && initData.icon_upload_url) {
      console.log('Uploading icon...');
      const iconRes = await fetch(initData.icon_upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': iconContentType },
        body: new Uint8Array(iconData),
      });

      if (!iconRes.ok) {
        throw new Error(`Icon upload failed (${iconRes.status})`);
      }
    }

    // Phase 3: Finalize
    console.log('Finalizing deploy...');
    const finalizeRes = await fetch(deployUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action: 'finalize',
        activity_id: initData.activity_id,
        entry_point: config.entry_point,
        ...(iconExtension ? { icon_extension: iconExtension } : {}),
      }),
    });

    if (!finalizeRes.ok) {
      const errText = await finalizeRes.text();
      throw new Error(`Deploy finalize failed (${finalizeRes.status}): ${errText}`);
    }

    const result = await finalizeRes.json() as DeployResult;
    return result;
  } finally {
    // Clean up temp ZIP
    await unlink(zipPath).catch(() => {});
  }
}
