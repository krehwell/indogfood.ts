/**
 * Egress per machine: the VPS runs Cloudflare WARP as a local SOCKS5 proxy, the
 * Mac has none and needs none. The VPS is Linux and the Mac is not, so the OS
 * is the whole test.
 *
 * WARP does not unblock GoFood, and nothing here pretends otherwise. Its exit is
 * Singapore and flagged as a proxy, so GoFood's WAF answers 403 through it
 * exactly as it does direct. Grab works either way. WARP is used because it is
 * the VPS's normal egress, not because it buys a provider.
 */

/** True on the VPS, false on the Mac. */
export const warpEnabled = Deno.build.os === "linux";

/**
 * Pass as `client` on any fetch. Off the VPS this is a plain client with no
 * proxy, so call sites need no branch of their own.
 *
 * ponytail: assumes WARP is up whenever the OS is Linux. If it is not, every
 * request fails at the socket with nothing pointing at the proxy as the cause;
 * probe the port instead if that ever bites.
 */
export const warpClient = Deno.createHttpClient(
  warpEnabled ? { proxy: { url: "socks5://127.0.0.1:40000" } } : {},
);
