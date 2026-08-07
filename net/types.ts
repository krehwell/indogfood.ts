/** Shared shapes so both providers land in one table. */

export type Source = "grab" | "gofood";

/** The delivery address every provider resolves results against. */
export type Location = {
  latitude: number;
  longitude: number;
  address: string;
  countryCode: string;
};

export type Merchant = {
  source: Source;
  /** Pass this back to `menu`; each provider's own handle. */
  id: string;
  name: string;
  open: boolean;
  hours: string;
  cuisine: string[];
  /**
   * Live offers as each app words them: "Diskon 50%", "Flash sale 35%",
   * "Diskon 31%, maks. 36rb (Min. pembelian 108rb)". Kept as display text
   * because the two apps express discounts in different units (percent, flat
   * rupiah, capped-with-minimum) and flattening them to one number would
   * quietly claim things the data does not say.
   */
  promos: string[];
  distanceKm: number;
  rating: number | null;
  votes: number;
  etaMinutes: number | null;
};

export type MenuItem = {
  name: string;
  /** Whole rupiah. Providers send minor units or "7.500" display strings. */
  priceRp: number;
  /**
   * Price before the item's own discount, or null when it is not discounted.
   *
   * Always null on GoFood, which has no per-item discount at all: its menu
   * items carry a single price and the offers live on the outlet, applied to
   * the cart against a minimum spend. So null means "not discounted" on Grab
   * and "this app does not do per-item discounts" on GoFood.
   */
  priceBeforeRp: number | null;
  available: boolean;
  description: string;
};

export type Menu = {
  source: Source;
  id: string;
  name: string;
  open: boolean;
  hours: string;
  address: string;
  categories: { name: string; items: MenuItem[] }[];
};

/**
 * Which app an id came from, so `menu` can route without being told.
 *
 * Decided on GoFood's shape because it is the stable one: every GoFood id ends
 * in a uuid. Grab issues at least three formats ("6-C7VKLXMASBE3JX",
 * "IDGFSTI00003crn", "AWfPkO00U0GQ11lNiASe"), so matching Grab's first format
 * instead sent chain outlets like KFC to GoFood, where they cannot exist.
 */
export function sourceOf(id: string): Source {
  return /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    ? "gofood"
    : "grab";
}

/**
 * Highest percentage stated across a merchant's offers.
 *
 * 0 means no offer states a percent, which is not the same as no discount:
 * "Diskon Rp30.000" is worth more than "Diskon 10%" on a small order but
 * scores 0 here. Callers thresholding on this must say so, or a real offer
 * looks absent.
 */
export function bestPromoPct(m: Merchant): number {
  return Math.max(
    0,
    ...m.promos.flatMap((p) =>
      [...p.matchAll(/(\d+)\s*%/g)].map((x) => Number(x[1]))
    ),
  );
}

/**
 * Every result is scoped to a delivery address, so a wrong one gives silently
 * wrong answers. There is no safe default, hence the hard failure.
 */
export function location(): Location {
  const env = (k: string) =>
    Deno.env.get(`FOOD_${k}`) ?? Deno.env.get(`GRAB_${k}`);
  const lat = env("LAT");
  const lng = env("LNG");
  if (!lat || !lng) {
    throw new Error(
      "FOOD_LAT and FOOD_LNG are required (see .env.example).\n" +
        "Get them from food.grab.com: set your delivery address, then read " +
        "latitude/longitude out of the `location` cookie.",
    );
  }
  return {
    latitude: Number(lat),
    longitude: Number(lng),
    address: env("ADDRESS") ?? `${lat},${lng}`,
    countryCode: env("COUNTRY") ?? "ID",
  };
}
