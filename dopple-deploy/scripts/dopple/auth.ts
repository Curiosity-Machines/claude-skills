import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const AUTH_DIR = join(homedir(), '.dopple');
const AUTH_FILE = join(AUTH_DIR, 'auth.json');
const OAUTH_PORT = 8976;

interface AuthData {
  refresh_token: string;
}

function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_ prefixed variants).'
    );
  }

  return { url, anonKey };
}

function createSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseEnv();
  return createClient(url, anonKey);
}

async function loadAuthFile(): Promise<AuthData | null> {
  try {
    const raw = await readFile(AUTH_FILE, 'utf-8');
    const data = JSON.parse(raw) as AuthData;
    if (typeof data.refresh_token === 'string') {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveAuthFile(data: AuthData): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  await writeFile(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Resolve an access token using the priority chain:
 * 1. Explicit --token flag
 * 2. DOPPLE_TOKEN env var
 * 3. ~/.dopple/auth.json refresh token
 */
export async function resolveAuth(tokenFlag?: string): Promise<string> {
  // 1. Explicit token flag
  if (tokenFlag) {
    return tokenFlag;
  }

  // 2. Environment variable
  const envToken = process.env.DOPPLE_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 3. Saved refresh token
  const authData = await loadAuthFile();
  if (!authData) {
    throw new Error(
      'Not authenticated. Run "dopple login" or set DOPPLE_TOKEN.'
    );
  }

  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: authData.refresh_token,
  });

  if (error || !data.session) {
    throw new Error(
      `Session refresh failed: ${error?.message || 'no session returned'}. Run "dopple login" again.`
    );
  }

  // Save updated refresh token
  await saveAuthFile({ refresh_token: data.session.refresh_token });

  return data.session.access_token;
}

/**
 * Return the email of the currently authenticated user.
 */
export async function whoami(tokenFlag?: string): Promise<string> {
  const accessToken = await resolveAuth(tokenFlag);
  const supabase = createSupabaseClient();

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error(`Failed to get user: ${error?.message || 'no user returned'}`);
  }

  return data.user.email || data.user.id;
}

/**
 * Interactive browser-based OAuth login.
 * Starts a local HTTP server, opens the browser to the Supabase auth URL,
 * and captures the callback with the session tokens.
 */
export async function login(): Promise<void> {
  const { url } = getSupabaseEnv();
  const supabase = createSupabaseClient();
  const redirectUrl = `http://localhost:${OAUTH_PORT}/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    throw new Error(`Failed to initiate OAuth: ${error?.message || 'no URL returned'}`);
  }

  console.log('Opening browser for login...');
  console.log(`If the browser does not open, visit: ${data.url}`);

  // Open browser using execFile (no shell injection)
  const platform = process.platform;
  const openCmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'start'
    : 'xdg-open';

  execFile(openCmd, [data.url], (err) => {
    if (err) {
      console.log(`Could not open browser automatically. Please visit the URL above.`);
    }
  });

  // Start local server to capture the callback
  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const reqUrl = new URL(req.url, `http://localhost:${OAUTH_PORT}`);

      // The tokens may come as hash fragments, which the browser handles client-side.
      // Serve a small page that extracts hash params and sends them as query params.
      if (!reqUrl.searchParams.has('access_token')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html><body><script>
  const hash = window.location.hash.substring(1);
  if (hash) {
    window.location.href = '/callback?' + hash;
  } else {
    document.body.textContent = 'Login failed: no tokens received.';
  }
</script><p>Completing login...</p></body></html>`);
        return;
      }

      const accessToken = reqUrl.searchParams.get('access_token');
      const refreshToken = reqUrl.searchParams.get('refresh_token');

      if (!accessToken || !refreshToken) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Login failed: missing tokens.');
        server.close();
        reject(new Error('Login failed: missing tokens in callback'));
        return;
      }

      // Save refresh token
      await saveAuthFile({ refresh_token: refreshToken });

      // Get user info
      const { data: userData } = await supabase.auth.getUser(accessToken);
      const email = userData?.user?.email || 'unknown';

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html><body>
<h2>Logged in as ${email}</h2>
<p>You can close this tab.</p>
</body></html>`);

      console.log(`Logged in as ${email}`);
      server.close();
      resolve();
    });

    server.listen(OAUTH_PORT, () => {
      // Server is ready
    });

    server.on('error', (err) => {
      reject(new Error(`Failed to start auth server on port ${OAUTH_PORT}: ${err.message}`));
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out after 2 minutes.'));
    }, 120_000);
  });
}
