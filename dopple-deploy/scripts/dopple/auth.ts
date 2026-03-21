import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const AUTH_DIR = join(homedir(), '.dopple');
const AUTH_FILE = join(AUTH_DIR, 'auth.json');

interface AuthData {
  refresh_token: string;
}

const DEFAULT_SUPABASE_URL = 'https://onljswkegixyjjhpcldn.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ubGpzd2tlZ2l4eWpqaHBjbGRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1NDY1MzEsImV4cCI6MjA4MTEyMjUzMX0.MtOk_dTmjvSduX2AW4YzmSwxaACua3B5z3O8gBRPG7k';

function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

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
 * Detect if we're in a headless environment (container, SSH, CI, agent).
 */
function isHeadless(): boolean {
  return !!(
    process.env.SSH_CONNECTION ||
    process.env.CI ||
    process.env.CODEX ||
    process.env.CLAUDE_CODE ||
    process.env.CONTAINER ||
    process.env.DOCKER_CONTAINER ||
    !process.env.DISPLAY && process.platform === 'linux'
  );
}

/**
 * Read a line from stdin.
 */
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Login via OAuth.
 * - On desktop: opens browser, local server captures callback automatically.
 * - On headless/container: prints URL, user authenticates in any browser.
 *   The callback page shows a short code to paste back into the terminal.
 */
const SITE_URL = 'https://dopple-studio.pages.dev';

export async function login(): Promise<void> {
  const supabase = createSupabaseClient();
  // Always use the hosted /cli-auth page for the callback.
  // It shows a short code the user pastes back into the terminal,
  // which works everywhere (containers, SSH, desktop).
  const redirectUrl = `${SITE_URL}/cli-auth`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    throw new Error(`Failed to initiate OAuth: ${error?.message || 'no URL returned'}`);
  }

  // Open browser if possible, otherwise just print the URL
  const headless = isHeadless();
  if (!headless) {
    const platform = process.platform;
    const openCmd = platform === 'darwin' ? 'open'
      : platform === 'win32' ? 'start'
      : 'xdg-open';
    execFile(openCmd, [data.url], (err) => {
      if (err) {
        console.log('Could not open browser automatically.');
      }
    });
  }

  await loginHeadless(supabase, data.url);
}

/**
 * Headless login: user opens the auth URL in any browser, signs in,
 * and gets redirected to the hosted /cli-auth page which shows a short code.
 * User copies the code and pastes it here.
 */
async function loginHeadless(supabase: SupabaseClient, authUrl: string): Promise<void> {
  console.log('');
  console.log('Open this URL in any browser to authenticate:');
  console.log('');
  console.log(`  ${authUrl}`);
  console.log('');
  console.log('After you sign in, you\'ll see a code. Copy and paste it here.');
  console.log('');

  const input = await prompt('Paste code: ');

  if (!input) {
    throw new Error('No input provided.');
  }

  let refreshToken: string;

  if (input.startsWith('dopple:')) {
    // Code format: dopple:<base64-encoded-refresh-token>
    refreshToken = Buffer.from(input.slice(7), 'base64').toString();
  } else {
    // Full URL fallback
    try {
      const parsed = new URL(input);
      let rt = parsed.searchParams.get('refresh_token');
      if (!rt && parsed.hash) {
        const hashParams = new URLSearchParams(parsed.hash.substring(1));
        rt = hashParams.get('refresh_token');
      }
      if (!rt) {
        throw new Error('No refresh token found');
      }
      refreshToken = rt;
    } catch {
      throw new Error('Invalid input. Paste either the code or the full callback URL.');
    }
  }

  await saveAuthFile({ refresh_token: refreshToken });

  let email = 'unknown';
  try {
    const { data: session } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (session?.session?.access_token) {
      const { data: userData } = await supabase.auth.getUser(session.session.access_token);
      email = userData?.user?.email || 'unknown';
    }
  } catch {
    // Network may be unavailable — tokens are saved, that's what matters
  }

  console.log(`\nLogged in as ${email}`);
}

