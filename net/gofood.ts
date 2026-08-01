/**
 * GoFood client.
 *
 * No login and no browser: the site's Next.js data routes serve everything,
 * they just sit behind a WAF that rejects requests without a session. Fetching
 * any HTML page hands out that session, after which the JSON routes answer.
 *
 * Be gentle here. A burst of ~10 concurrent page fetches got this IP blocked
 * for several minutes during development, so requests are sequential with a
 * small gap rather than parallel.
 */

import type { Location, Menu, MenuItem, Merchant } from "./types.ts";

const HOST = "https://gofood.co.id";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0";

/**
 * GoFood's WAF blocks non-Indonesian and datacenter IPs outright, so a VPS
 * needs an Indonesian egress. Opt in explicitly rather than defaulting to a
 * tunnel: Cloudflare WARP exits Singapore and is blocked just the same, and
 * silently routing through a proxy that also fails only hides the cause.
 *
 *   FOOD_PROXY=socks5://127.0.0.1:40000
 */
const proxyUrl = Deno.env.get("FOOD_PROXY");
const client = proxyUrl
  ? Deno.createHttpClient({ proxy: { url: proxyUrl } })
  : undefined;

const via = (init: RequestInit = {}): RequestInit =>
  client ? { ...init, client } as RequestInit : init;

/** Keep well under whatever tripped the WAF; this is not a crawler. */
const GAP_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Outlet_Status from the site's own protobuf enum. */
const OPEN_STATUS = new Set([1, /* OPEN */ 7 /* CLOSING_SOON */]);

type Session = {
  cookie: string;
  /** Next.js build id, part of every data-route URL; changes on deploys. */
  buildId: string;
  serviceArea: string;
};

let cached: Session | null = null;

async function session(loc: Location): Promise<Session> {
  if (cached) return cached;

  const boot = await fetch(
    `${HOST}/en`,
    via({ headers: { "User-Agent": UA } }),
  );
  const html = await boot.text();
  if (!boot.ok) {
    throw new Error(
      `GoFood refused the session bootstrap (${boot.status}). ` +
        `Its WAF blocks datacenter and non-Indonesian IPs outright` +
        (proxyUrl ? ` (FOOD_PROXY=${proxyUrl} did not help)` : "") +
        `; it also blocks temporarily after too many requests.`,
    );
  }
  const buildId = html.match(/"buildId":"([^"]+)"/)?.[1];
  if (!buildId) throw new Error("could not read GoFood buildId from homepage");

  const jar = (boot.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  await sleep(GAP_MS);

  // Ask GoFood which service area our coordinates fall in, rather than
  // hardcoding one; this is what keeps GoFood pinned to the same address
  // Grab uses instead of defaulting to the city centroid.
  const geo = await fetch(
    `${HOST}/api/poi/reverse-geocode?latlong=${loc.latitude},${loc.longitude}`,
    via({ headers: { "User-Agent": UA, Cookie: jar.join("; ") } }),
  );
  if (!geo.ok) throw new Error(`GoFood reverse-geocode failed (${geo.status})`);
  const g = await geo.json();
  if (g.is_serviceable === false) {
    throw new Error(`GoFood does not deliver to ${loc.address}`);
  }

  // The site reads the chosen address from this cookie; query params are
  // ignored, so without it every result is scoped to the city centroid.
  const chosen = {
    id: "",
    latitude: loc.latitude,
    longitude: loc.longitude,
    name: loc.address,
    serviceAreaId: g.service_area_id,
    serviceArea: g.service_area_name,
    timezone: g.timezone,
    locality: "",
  };
  jar.push(`gf_chosen_loc=${encodeURIComponent(JSON.stringify(chosen))}`);

  cached = {
    cookie: jar.join("; "),
    buildId,
    serviceArea: g.service_area_name,
  };
  return cached;
}

async function data(s: Session, path: string): Promise<Record<string, never>> {
  await sleep(GAP_MS);
  const r = await fetch(
    `${HOST}/_next/data/${s.buildId}/en/${path}`,
    via({
      headers: {
        "User-Agent": UA,
        Cookie: s.cookie,
        Accept: "application/json",
      },
    }),
  );
  if (!r.ok) {
    throw new Error(
      `GoFood ${path.split("?")[0]} -> ${r.status}` +
        (r.status === 403 ? " (WAF block; slow down and retry)" : ""),
    );
  }
  return (await r.json()).pageProps;
}

/**
 * "07:00-22:00" for today, from the outlet's weekly schedule.
 *
 * `now` is injectable so the day mapping can be tested; an off-by-one here
 * reports yesterday's hours and fails silently.
 */
// deno-lint-ignore no-explicit-any
export function todayHours(
  periods: any[],
  timeZone: string,
  now = new Date(),
): string {
  if (!periods?.length) return "?";
  const wib = new Date(now.toLocaleString("en-US", { timeZone }));
  // The API numbers days 1..7 starting Monday; JS getDay() is 0=Sunday.
  const day = wib.getDay() === 0 ? 7 : wib.getDay();
  const hhmm = (t: Record<string, number> | undefined) =>
    `${String(t?.hours ?? 0).padStart(2, "0")}:${
      String(t?.minutes ?? 0).padStart(2, "0")
    }`;
  const today = periods.filter((p) => p.day === day);
  if (!today.length) return "closed today";
  return today.map((p) => `${hhmm(p.startTime)}-${hhmm(p.endTime)}`).join(" ");
}

// deno-lint-ignore no-explicit-any
function toMerchant(o: any): Merchant {
  const core = o.core ?? {};
  return {
    source: "gofood",
    // The data route needs the full slug; the bare uid returns an empty page.
    id: String(o.path ?? "").split("/restaurant/")[1] ?? o.uid,
    name: core.displayName ?? "(unnamed)",
    open: OPEN_STATUS.has(core.status),
    hours: todayHours(core.openPeriods, core.timeZone ?? "Asia/Jakarta"),
    cuisine: (core.tags ?? [])
      // deno-lint-ignore no-explicit-any
      .filter((t: any) => t.taxonomy === 2)
      // deno-lint-ignore no-explicit-any
      .map((t: any) => t.displayName)
      .filter(Boolean),
    distanceKm: o.delivery?.distanceKm ?? 0,
    // GoFood sends 0 for "unrated"; report that as unknown, not as a bad score.
    rating: o.ratings?.average || null,
    votes: o.ratings?.total ?? 0,
    etaMinutes: o.delivery?.etaRange?.min ?? null,
  };
}

/**
 * Search outlets near the address.
 *
 * GoFood caps this at 12 results and offers no paging, so a broad "what's
 * around me" needs several keywords; see `sweep`.
 */
export async function search(
  loc: Location,
  keyword: string,
): Promise<Merchant[]> {
  const s = await session(loc);
  const pp = await data(s, `search.json?q=${encodeURIComponent(keyword)}`);
  // deno-lint-ignore no-explicit-any
  return ((pp as any).outlets ?? []).map(toMerchant);
}

/** GoFood's own cuisine shortcuts, used to approximate a browse-everything. */
const CUISINES = [
  "ayam",
  "nasi",
  "mie",
  "bakso",
  "sate",
  "martabak",
  "roti",
  "kopi",
  "minuman",
  "seafood",
  "burger",
  "pizza",
];

/** Union of several keyword searches, deduped; GoFood has no browse-all. */
export async function sweep(loc: Location, limit: number): Promise<Merchant[]> {
  const seen = new Map<string, Merchant>();
  for (const q of CUISINES) {
    for (const m of await search(loc, q)) {
      if (!seen.has(m.id)) seen.set(m.id, m);
    }
    if (seen.size >= limit) break;
  }
  return [...seen.values()]
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

export async function menu(loc: Location, slug: string): Promise<Menu> {
  const s = await session(loc);
  const pp = await data(
    s,
    `${s.serviceArea}/restaurant/${slug}.json` +
      `?service_area=${s.serviceArea}&restaurant=${slug}`,
  );
  // deno-lint-ignore no-explicit-any
  const o = (pp as any).outlet;
  if (!o) throw new Error(`GoFood has no outlet "${slug}"`);
  const core = o.core ?? {};
  return {
    source: "gofood",
    id: slug,
    name: core.displayName ?? "(unnamed)",
    open: OPEN_STATUS.has(core.status),
    hours: todayHours(core.openPeriods, core.timeZone ?? "Asia/Jakarta"),
    address: core.brand?.name ?? "",
    // deno-lint-ignore no-explicit-any
    categories: (o.catalog?.sections ?? []).map((sec: any) => ({
      name: sec.displayName || sec.internalName || "(unnamed)",
      // deno-lint-ignore no-explicit-any
      items: (sec.items ?? []).map((i: any): MenuItem => ({
        name: i.displayName,
        priceRp: Number(i.price?.units ?? 0),
        // Item_Status: 1 ACTIVE, 2 INACTIVE, 3 OUT_OF_STOCK, 4 DELETED.
        available: i.status === 1,
        description: i.description ?? "",
      })),
    })),
  };
}
