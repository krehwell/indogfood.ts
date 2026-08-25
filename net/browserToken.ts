/**
 * Mint a GrabFood guest token with a headless browser.
 *
 * Grab's guest token can only be issued to a real browser: the login call is
 * gated on an attestation JWT from Grab's Guardian anti-abuse SDK, which runs
 * client-side. So we load the site and take the token it ends up with.
 */

import { browse } from "./browser.ts";

const LOGIN_URL = "https://food.grab.com/id/id/restaurants";

/** sessionStorage key the web app keeps its guest token under. */
const TOKEN_KEY = "guest_token";

export function mintToken(timeoutMs = 60_000): Promise<string> {
  return browse(LOGIN_URL, timeoutMs, async (cdp) => {
    // The app stashes the guest token it just logged in with here. Polling for
    // it is more reliable than watching the login call (which may have already
    // fired before we attached) or the cookie jar (which headless Chrome
    // reports as empty even while the page makes authenticated requests).
    while (Date.now() < cdp.deadline) {
      const t = await cdp.eval<unknown>(
        `sessionStorage.getItem(${JSON.stringify(TOKEN_KEY)})`,
      );
      if (typeof t === "string" && t.length > 0) return t;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      "browser loaded but Grab never completed guest login " +
        "(anti-abuse may have refused this environment)",
    );
  });
}
