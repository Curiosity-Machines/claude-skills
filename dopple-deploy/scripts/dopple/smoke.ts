import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve as resolvePath } from 'node:path';
import type { DoppleConfig } from './config.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

function startStaticServer(root: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const resolvedRoot = resolvePath(root);
      let filePath = resolvePath(root, (req.url === '/' ? 'index.html' : req.url || 'index.html').replace(/^\//, ''));

      // Prevent path traversal outside the build directory
      if (!filePath.startsWith(resolvedRoot)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      try {
        const fileStat = await stat(filePath);
        if (fileStat.isDirectory()) {
          filePath = join(filePath, 'index.html');
        }
      } catch {
        // File might not exist, let it fall through to the read attempt
      }

      try {
        const content = await readFile(filePath);
        const ext = extname(filePath);
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });

    // Listen on port 0 to get a random available port
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}

/**
 * Run a Playwright smoke test against the built activity.
 * Starts a local static server, loads the entry point in headless Chromium,
 * and checks for fatal errors.
 *
 * Playwright is dynamically imported so it remains optional.
 */
export async function runSmokeTest(config: DoppleConfig, projectRoot: string): Promise<void> {
  const buildDir = join(projectRoot, config.build_output);

  // Dynamic import so playwright remains optional.
  // Use a variable to prevent TypeScript from resolving the module at compile time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let playwright: any;
  try {
    const moduleName = 'playwright';
    playwright = await import(moduleName);
  } catch {
    throw new Error(
      'Playwright is not installed. Install it with "npm install -D playwright" ' +
      'or skip smoke tests with --no-smoke.'
    );
  }

  const { server, port } = await startStaticServer(buildDir);

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  try {
    const browser = await playwright.chromium.launch({
      args: ['--no-sandbox'],
    });

    const page = await browser.newPage();

    page.on('console', (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('requestfailed', (req: { url: () => string; failure: () => { errorText: string } | null }) => {
      const failure = req.failure();
      failedRequests.push(`${req.url()} - ${failure?.errorText || 'unknown error'}`);
    });

    const entryUrl = `http://127.0.0.1:${port}/${config.entry_point}`;
    console.log(`Smoke test: loading ${entryUrl}`);

    const response = await page.goto(entryUrl, {
      waitUntil: 'networkidle',
      timeout: 10_000,
    });

    await browser.close();

    if (!response || response.status() >= 400) {
      throw new Error(
        `Page failed to load (status: ${response?.status() || 'none'})`
      );
    }

    // Filter out non-fatal console errors (e.g., favicon 404)
    const fatalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon.ico')
    );

    if (fatalErrors.length > 0) {
      throw new Error(
        `Smoke test found console errors:\n${fatalErrors.map((e) => `  - ${e}`).join('\n')}`
      );
    }

    if (failedRequests.length > 0) {
      // Only warn about failed requests, don't fail the build
      console.log(
        `Smoke test warning: ${failedRequests.length} failed request(s):\n` +
        failedRequests.map((r) => `  - ${r}`).join('\n')
      );
    }

    console.log('Smoke test passed.');
  } finally {
    server.close();
  }
}
