import { mintToken } from "./browserToken.ts";

const CACHE = new URL("../.cache/grab-token.json", import.meta.url).pathname;

/**
 * Re-mint this long before expiry. Grab issues 30-day tokens, so a day of
 * slack costs nothing and keeps a run from dying on a token that expires
 * mid-flight.
 */
const MIN_LIFETIME_SEC = 24 * 60 * 60;

/** Seconds left on a JWT, or 0 if unreadable/expired. */
export function jwtSecondsLeft(jwt: string): number {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4)));
    return Math.max(0, exp - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}

function cached(): string | null {
  try {
    const { token } = JSON.parse(Deno.readTextFileSync(CACHE));
    return jwtSecondsLeft(token) > MIN_LIFETIME_SEC ? token : null;
  } catch {
    return null;
  }
}

function store(token: string) {
  try {
    Deno.mkdirSync(new URL("../.cache", import.meta.url).pathname, {
      recursive: true,
    });
    Deno.writeTextFileSync(CACHE, JSON.stringify({ token }, null, 2));
  } catch { /* cache is an optimisation, not a requirement */ }
}

let inMemory: string | null = null;

/**
 * A usable guest token. Only the credential is cached, never any food data,
 * so results can't go stale — a cached token still fetches live answers.
 *
 * Pass force=true after a 401: Grab allows one guest session per identity, so
 * another browser logging in revokes ours and we simply mint a new one.
 */
export async function grabToken(force = false): Promise<string> {
  if (!force) {
    const t = inMemory ?? cached();
    if (t) return (inMemory = t);
  }
  const fresh = await mintToken();
  store(fresh);
  return (inMemory = fresh);
}
