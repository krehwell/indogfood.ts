import { grabToken } from "./token.ts";
import type { Location, Menu, MenuItem, Merchant } from "./types.ts";
import { warpClient } from "./warpClient.ts";

const PORTAL = "https://portal.grab.com/foodweb/guest/v2";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0";

/**
 * A 401 means our guest session was revoked; Grab allows one per identity, so
 * any other browser logging in as guest kicks us out. Mint a fresh token and
 * retry once; only a second 401 is a real failure.
 */
async function call(
  path: string,
  init: RequestInit & { country: string },
): Promise<unknown> {
  for (const attempt of [0, 1]) {
    const res = await fetch(`${PORTAL}${path}`, {
      ...init,
      client: warpClient,
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        // Note: this does not control menu language; merchants publish their
        // own item names, so some menus come back in English regardless.
        "Accept-Language": "id",
        "X-Country-Code": init.country,
        "Cookie": `passenger_authn_token=${await grabToken(attempt === 1)}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (res.status === 401 && attempt === 0) continue;
    if (!res.ok) {
      throw new Error(
        `Grab ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    return await res.json();
  }
  throw new Error("unreachable");
}

// deno-lint-ignore no-explicit-any
function toMerchant(m: any): Merchant {
  const b = m.merchantBrief ?? {};
  return {
    source: "grab",
    id: m.id,
    name: m.address?.name ?? "(tanpa nama)",
    open: b.openHours?.open === true,
    hours: b.openHours?.displayedHours ?? "?",
    cuisine: b.cuisine ?? [],
    distanceKm: b.distanceInKm ?? 0,
    rating: b.rating ?? null,
    votes: b.vote_count ?? 0,
    etaMinutes: m.estimatedDeliveryTime ?? null,
  };
}

/**
 * Restaurants near the address. Empty keyword lists everything nearby.
 *
 * Page length is not a usable end-of-results signal: Grab deliberately returns
 * a short first page (a "top picks" block) before full ones, so we page on
 * `hasMore` and stop on an empty page.
 */
export async function search(
  loc: Location,
  keyword = "",
  limit = 64,
): Promise<Merchant[]> {
  const seen = new Set<string>();
  const out: Merchant[] = [];
  let offset = 0;

  while (out.length < limit) {
    // deno-lint-ignore no-explicit-any
    const res: any = await call("/search", {
      method: "POST",
      country: loc.countryCode,
      body: JSON.stringify({
        latlng: `${loc.latitude},${loc.longitude}`,
        keyword,
        offset,
        pageSize: 32,
        countryCode: loc.countryCode,
      }),
    });
    const page = res?.searchResult?.searchMerchants ?? [];
    if (!page.length) break;
    offset += page.length;

    for (const raw of page) {
      const m = toMerchant(raw);
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    if (res?.searchResult?.hasMore !== true) break;
  }
  return out.slice(0, limit);
}

export async function menu(loc: Location, merchantId: string): Promise<Menu> {
  const q = `?latlng=${loc.latitude},${loc.longitude}`;
  // deno-lint-ignore no-explicit-any
  const res: any = await call(`/merchants/${merchantId}${q}`, {
    method: "GET",
    country: loc.countryCode,
  });
  const m = res.merchant;
  return {
    source: "grab",
    id: m.ID,
    name: m.name,
    open: m.openingHours?.open === true,
    hours: m.openingHours?.displayedHours ?? "?",
    address: m.address?.combined_address ?? "",
    // deno-lint-ignore no-explicit-any
    categories: (m.menu?.categories ?? []).map((c: any) => ({
      name: c.name,
      // deno-lint-ignore no-explicit-any
      items: (c.items ?? []).map((i: any): MenuItem => ({
        name: i.name,
        priceRp: Math.round(
          (i.discountedPriceV2?.amountInMinor ?? i.priceV2?.amountInMinor ??
            i.priceInMinorUnit ?? 0) / 100,
        ),
        available: i.available !== false,
        description: i.description ?? "",
      })),
    })),
  };
}
