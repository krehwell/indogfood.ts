/**
 * Google Maps client, by driving the real site in a headless browser.
 *
 * There is no public data route, so the results list is read off the DOM.
 * Classes are obfuscated and rotate, so nothing here depends on one: the
 * anchors are found by role and href, and the fields come from aria-labels,
 * the href, and the card's visible text lines.
 *
 * Maps has no menus and no ordering, so a row from here is a place to go to or
 * to look up on Grab/GoFood by name, not something `menu` can open.
 */

import { browse, type Cdp } from "./browser.ts";
import type { Location, Merchant } from "./types.ts";

const HOST = "https://www.google.com";
/** Zoom 15 covers a few kilometres around the address at our window size. */
const ZOOM = 15;
/** With no keyword this is what a person would type. */
const DEFAULT_QUERY = "restoran";
/** Three quiet scrolls in a row means the feed has no more to give. */
const STALL_ROUNDS = 3;

/** Raw pieces of one result card, pulled in-page and parsed here. */
export type Card = {
  name: string;
  href: string;
  /** "4,7 bintang 39 Ulasan" or null when unrated. */
  rating: string | null;
  /** "Rp 25.000 ke Rp 50.000" or null when Google has no price reports. */
  price: string | null;
  lines: string[];
};

const CARDS_JS = `
  [...document.querySelectorAll('div[role="feed"] div[role="article"]')]
    .map((c) => {
      const a = c.querySelector('a[href*="/maps/place/"]');
      return a && {
        name: a.getAttribute("aria-label"),
        href: a.href,
        rating: c.querySelector('[role="img"][aria-label*="bintang"]')
          ?.getAttribute("aria-label") ?? null,
        price: c.querySelector('[aria-label^="Rp "]')
          ?.getAttribute("aria-label") ?? null,
        lines: c.innerText.split("\\n").map((s) => s.trim()).filter(Boolean),
      };
    })
    .filter(Boolean)
`;

const SCROLL_JS = `
  (() => { const f = document.querySelector('div[role="feed"]');
    if (f) f.scrollTop = f.scrollHeight; })()
`;

/**
 * Google's "Buka sekarang" chip, as the URL encodes it once clicked. Asking
 * for it up front gets a page of open places instead of a page of places that
 * is then mostly filtered away.
 */
const OPEN_NOW = "/data=!4m4!2m3!5m1!2e1!6e5";

const LIMITED_JS =
  `!!document.querySelector('[aria-label*="tampilan terbatas"]')`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A fresh profile gets Google's "limited view": no review counts, no prices,
 * type stripped to "Restoran", no reviews tab. A reload usually lifts it, not
 * always on the first try. The marker tells the old document from the new one,
 * since `ready` would otherwise pass on the page the reload is about to replace.
 */
async function fullView(cdp: Cdp, ready: () => Promise<unknown>) {
  await ready();
  for (let i = 0; i < 3 && (await cdp.eval<boolean>(LIMITED_JS)); i++) {
    await cdp.eval(`document.documentElement.dataset.stale = "1"`);
    await cdp.send("Page.enable");
    await cdp.send("Page.reload");
    while (
      await cdp.eval<boolean>(`!!document.documentElement.dataset.stale`)
    ) {
      if (Date.now() > cdp.deadline) throw new Error("Google Maps reload hung");
      await sleep(200);
    }
    await ready();
  }
}

export function searchUrl(
  loc: Location,
  keyword: string,
  openNow = false,
): string {
  const q = encodeURIComponent(keyword || DEFAULT_QUERY);
  return `${HOST}/maps/search/${q}/@${loc.latitude},${loc.longitude},${ZOOM}z${
    openNow ? OPEN_NOW : ""
  }?hl=id`;
}

export function search(
  loc: Location,
  keyword: string,
  limit: number,
  openNow: boolean,
): Promise<Merchant[]> {
  return browse(searchUrl(loc, keyword, openNow), 90_000, async (cdp) => {
    let cards: Card[] = [];
    const feed = async () => {
      let stalled = 0;
      cards = [];
      while (Date.now() < cdp.deadline) {
        const next = (await cdp.eval<Card[] | undefined>(CARDS_JS)) ?? [];
        stalled = next.length > cards.length ? 0 : stalled + 1;
        cards = next;
        if (
          cards.length >= limit || (cards.length && stalled >= STALL_ROUNDS)
        ) break;
        await cdp.eval(SCROLL_JS);
        await sleep(700);
      }
      if (!cards.length) {
        throw new Error(
          "Google Maps showed no results list (blocked, or the page changed)",
        );
      }
    };
    await fullView(cdp, feed);
    return cards.slice(0, limit)
      .map((c, i) => parseCard(c, loc, i + 1))
      .filter((m): m is Merchant => !!m);
  });
}

/**
 * "0x3040319be788b099:0xd747a498923e13e8" from the href. The second half is
 * the place's cid, which the ?cid= link form below resolves.
 */
const CID = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i;
const COORDS = /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/;
/**
 * "Buka · Tutup pukul 18.00", "Tutup · Buka pukul 09.00", "Buka 24 jam",
 * "Segera tutup · 22.00", "Segera buka · 08.30".
 */
const STATUS = /^(Buka|Tutup|Segera tutup|Segera buka)\b/;

export function parseCard(
  c: Card,
  loc: Location,
  rank: number | null = null,
): Merchant | null {
  const id = c.href.match(CID)?.[1];
  const xy = c.href.match(COORDS);
  if (!id || !xy) return null;

  const statusAt = c.lines.findIndex((l) => STATUS.test(l));
  const status = c.lines[statusAt] ?? "";
  const [state, ...rest] = status.split(" · ");
  // "Segera buka · 08.30" only makes sense whole; the others read fine after
  // the dot, and "Buka 24 jam" has nothing after it.
  const hours = state.startsWith("Segera") || state === "Buka 24 jam"
    ? status
    : rest.join(" · ");
  // Above the status line: name, maybe "4,5(39) · Rp 25–50 rb", then the type
  // line "Sate · Jl. X" (an empty price slot can leave "Sate ·  · Jl. X").
  const type = c.lines
    .slice(0, statusAt === -1 ? undefined : statusAt)
    .find((l) => l !== c.name && !/^\d,\d/.test(l) && l !== "Tidak ada ulasan")
    ?.split(" · ")[0].trim() ?? "";

  const votes = c.rating?.match(/(\d[\d.]*) Ulasan/)?.[1];

  return {
    source: "gmaps",
    id,
    name: c.name,
    // No status line means Maps lists no hours, not that the place is closed.
    open: state ? state.startsWith("Buka") || state === "Segera tutup" : null,
    hours,
    cuisine: type ? [type] : [],
    promos: [],
    distanceKm: km(loc, Number(xy[1]), Number(xy[2])),
    rating: c.rating ? parseFloat(c.rating.replace(",", ".")) : null,
    votes: votes ? Number(votes.replace(/\./g, "")) : 0,
    etaMinutes: null,
    price: c.price?.replace(/^Rp (\S+) ke Rp (\S+)$/, "Rp $1-$2") ?? null,
    rank,
    url: placeUrl(id),
  };
}

/** Opens the place in the Maps app on a phone, the site elsewhere. */
export function placeUrl(id: string): string {
  return `https://maps.google.com/?cid=${BigInt(id.split(":")[1])}`;
}

/** Straight-line distance; Maps gives no delivery distance to compare with. */
function km(loc: Location, lat: number, lng: number): number {
  const r = Math.PI / 180;
  const dLat = (lat - loc.latitude) * r;
  const dLng = (lng - loc.longitude) * r;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(loc.latitude * r) * Math.cos(lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** One place, read off its Maps page: what `resto` cannot see from a card. */
export type Place = {
  source: "gmaps";
  id: string;
  name: string;
  url: string;
  type: string;
  rating: number | null;
  votes: number;
  /** Reviews per star, 5 first: "5:364 4:65 3:17 2:7 1:24". */
  histogram: string;
  /** "Rp 25.000–50.000 per orang, dari 192 laporan" or "". */
  price: string;
  /** Google's own words: "Buka 24 jam", "Buka · Tutup pukul 22.00". */
  status: string;
  /** One entry per day, Google's wording: "Senin: 07.00 hingga 18.00". */
  hours: string[];
  /** "Saat ini 8% ramai, biasanya 2% ramai." or "". */
  busy: string;
  address: string;
  phone: string;
  website: string;
  menuUrl: string;
  /** Dishes Google highlights as popular. */
  popular: string[];
  /** The "Tentang" tab: services, diet options, ambience, parking. */
  about: string[];
  /** Review topics with mention counts: "luas (29)". */
  topics: string[];
  reviews: { stars: number | null; when: string; text: string }[];
};

const MAIN = `document.querySelector('[role="main"]')`;

/** Everything on the Ringkasan panel, raw; parsed in parsePlace. */
type Panel = {
  title: string;
  aria: string[];
  text: string[];
  items: [string, string, string | null][];
};

const PANEL_JS = `
  JSON.stringify({
    title: document.title,
    aria: [...${MAIN}.querySelectorAll("[aria-label]")]
      .map((e) => e.getAttribute("aria-label").trim()),
    text: ${MAIN}.innerText.split("\\n").map((s) => s.trim()).filter(Boolean),
    items: [...document.querySelectorAll("[data-item-id]")].map((e) => [
      e.getAttribute("data-item-id"),
      (e.getAttribute("aria-label") ?? "").trim(),
      e.getAttribute("href"),
    ]),
  })
`;

const TAB_JS = (name: string) => `
  (() => {
    const t = [...document.querySelectorAll('[role="tab"]')]
      .find((t) => (t.getAttribute("aria-label") ?? t.innerText).startsWith(${
  JSON.stringify(name)
}));
    if (t) t.click();
    return !!t;
  })()
`;

const REVIEWS_JS = `
  (() => {
    document.querySelectorAll('button[aria-label="Lihat lainnya"]')
      .forEach((b) => b.click());
    return JSON.stringify({
      topics: [...${MAIN}.querySelectorAll("[aria-label]")]
        .map((e) => e.getAttribute("aria-label").trim()),
      reviews: [...document.querySelectorAll("[data-review-id][aria-label]")]
        .map((r) => ({
          stars: r.querySelector('[role="img"][aria-label$="bintang"]')
            ?.getAttribute("aria-label") ?? null,
          lines: r.innerText.split("\\n").map((s) => s.trim()).filter(Boolean),
        })),
    });
  })()
`;

const DAY =
  /^(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu),(.+), Salin jam buka$/;

export function place(id: string): Promise<Place> {
  return browse(`${placeUrl(id)}&hl=id`, 90_000, async (cdp) => {
    const ready = async () => {
      while (!(await cdp.eval<boolean>(`!!${MAIN}?.querySelector("h1")`))) {
        if (Date.now() > cdp.deadline) {
          throw new Error("Google Maps never showed the place");
        }
        await sleep(300);
      }
      await sleep(1500);
    };
    await fullView(cdp, ready);
    const panel: Panel = JSON.parse(await cdp.eval<string>(PANEL_JS));

    let about: string[] = [];
    if (await cdp.eval<boolean>(TAB_JS("Tentang"))) {
      await sleep(1500);
      const tabs = new Set(
        await cdp.eval<string[]>(
          `[...document.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute("aria-label") ?? t.innerText)`,
        ),
      );
      about = (await cdp.eval<string[]>(
        `[...${MAIN}.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label").trim())`,
      )).filter((l) => l && !tabs.has(l) && !l.startsWith("Tentang "));
    }

    let topics: string[] = [];
    let reviews: Place["reviews"] = [];
    if (await cdp.eval<boolean>(TAB_JS("Ulasan"))) {
      await sleep(2000);
      const r = JSON.parse(await cdp.eval<string>(REVIEWS_JS));
      await sleep(500);
      const expanded = JSON.parse(await cdp.eval<string>(REVIEWS_JS));
      topics = (r.topics as string[])
        .map((l) => l.match(/^(.+), disebutkan dalam (\d+) ulasan$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => `${m[1]} (${m[2]})`);
      reviews = parseReviews(expanded.reviews);
    }

    return parsePlace(id, panel, about, topics, reviews);
  });
}

export function parsePlace(
  id: string,
  p: Panel,
  about: string[],
  topics: string[],
  reviews: Place["reviews"],
): Place {
  const find = (re: RegExp) =>
    p.aria.map((l) => l.match(re)).find((m): m is RegExpMatchArray => !!m);
  const item = (key: string) => p.items.find(([k]) => k.startsWith(key));

  const rating = find(/^(\d,\d) bintang$/);
  const votes = find(/^(\d[\d.]*) ulasan$/);
  const price = find(
    /^Rentang harga, (.+) per orang, Berdasarkan laporan (\d+) orang$/,
  );
  const histogram = p.aria
    .map((l) => l.match(/^Bintang (\d),([\d.]+) ulasan$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => `${m[1]}:${m[2].replace(/\./g, "")}`)
    .join(" ");
  // Tabs come right after the type line: "..., Restoran Sate, Ringkasan, ...".
  const typeAt = p.text.indexOf("Ringkasan");
  const type = typeAt > 0 && !/^[\d(]/.test(p.text[typeAt - 1])
    ? p.text[typeAt - 1]
    : "";

  return {
    source: "gmaps",
    id,
    name: p.title.replace(/ - Google Maps$/, ""),
    url: placeUrl(id),
    type,
    rating: rating ? parseFloat(rating[1].replace(",", ".")) : null,
    votes: votes ? Number(votes[1].replace(/\./g, "")) : 0,
    histogram,
    price: price ? `${price[1]} per orang, dari ${price[2]} laporan` : "",
    status: p.text.find((l) => STATUS.test(l)) ?? "",
    hours: p.aria
      .map((l) => l.match(DAY))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => `${m[1]}: ${m[2].trim()}`),
    busy: p.aria.find((l) => /^Saat ini .*ramai/.test(l)) ?? "",
    address: item("address")?.[1].replace(/^Alamat: /, "") ?? "",
    phone: item("phone:")?.[1].replace(/^Telepon: /, "") ?? "",
    website: item("authority")?.[2] ?? "",
    menuUrl: item("menu")?.[2] ?? "",
    popular: p.text.flatMap((l, i) => l === "Populer" ? [p.text[i + 1]] : []),
    about,
    topics,
    reviews,
  };
}

const NOISE = new Set(["BARU", "Suka", "Bagikan", "Lainnya", "Video"]);

export function parseReviews(
  raw: { stars: string | null; lines: string[] }[],
): Place["reviews"] {
  // Photo and text spans inside a review carry the same attributes as the
  // review itself; only the review has the star rating.
  return raw.filter((r) => r.stars).map((r) => {
    const whenAt = r.lines.findIndex((l) => /\blalu$/.test(l));
    const text = r.lines.slice(whenAt + 1)
      .filter((l) =>
        !NOISE.has(l) && !/^\+\d+$/.test(l) && !/^\d+ suka$/.test(l)
      )
      .join(" ")
      .replace(/ … Lainnya$/, " …");
    return {
      stars: r.stars ? Number(r.stars.split(" ")[0]) : null,
      when: whenAt === -1 ? "" : r.lines[whenAt],
      text,
    };
  }).filter((r) => r.text);
}
