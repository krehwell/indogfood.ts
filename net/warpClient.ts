/**
 * Egress that differs per machine.
 *
 * The VPS runs Cloudflare WARP as a local SOCKS5 proxy; the Mac has no WARP and
 * needs none. So the proxy is detected, not configured: probing the port keeps
 * one checkout working on both. Hardcoding the proxy makes every request on the
 * Mac fail against a dead port, and branching on `Deno.build.os` breaks the day
 * this runs on a Linux desktop.
 *
 * WARP does not unblock GoFood, and nothing here pretends otherwise. Its exit is
 * Singapore and flagged as a proxy, so GoFood's WAF answers 403 through it
 * exactly as it does direct. Grab works either way. WARP is used because it is
 * the VPS's normal egress, not because it buys a provider.
 */
const HOST = "127.0.0.1";
const PORT = 40000;

async function listening(): Promise<boolean> {
  try {
    (await Deno.connect({ hostname: HOST, port: PORT })).close();
    return true;
  } catch {
    return false;
  }
}

/** True on the VPS, false on the Mac. */
export const warpEnabled = await listening();

/**
 * Pass as `client` on any fetch. `undefined` is already what `fetch` means by
 * "no custom client", so call sites need no branch of their own.
 */
export const warpClient = warpEnabled
  ? Deno.createHttpClient({ proxy: { url: `socks5://${HOST}:${PORT}` } })
  : undefined;
