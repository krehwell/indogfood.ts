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
