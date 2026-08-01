import { mintToken } from "./browserToken.ts";

/**
 * Per-user cache dir, not one inside the repo: the checkout may be read-only
 * for the account actually running this (e.g. an agent user reading another
 * user's copy), and a silently unwritable cache means re-minting a token on
 * every single run.
 */
const CACHE_DIR = `${
  Deno.env.get("XDG_CACHE_HOME") ?? `${Deno.env.get("HOME")}/.cache`
}/indogfood`;
const CACHE = `${CACHE_DIR}/grab-token.json`;

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
    Deno.mkdirSync(CACHE_DIR, { recursive: true });
    Deno.writeTextFileSync(CACHE, JSON.stringify({ token }, null, 2));
  } catch (e) {
    // Not fatal, but without a cache every run launches a browser and mints a
    // new session, so say so instead of silently degrading.
    console.error(`warning: could not cache token in ${CACHE}: ${e}`);
  }
}

let inMemory: string | null = null;

/**
 * A usable guest token. Only the credential is cached, never any food data,
 * so results can't go stale; a cached token still fetches live answers.
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
