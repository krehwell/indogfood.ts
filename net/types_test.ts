import { assertEquals } from "@std/assert";
import { bestPromoPct, type Merchant } from "./types.ts";

const m = (...promos: string[]): Merchant => ({
  source: "grab",
  id: "x",
  name: "x",
  open: true,
  hours: "-",
  cuisine: [],
  promos,
  distanceKm: 0,
  rating: null,
  votes: 0,
  etaMinutes: null,
});

Deno.test("no offers scores 0 rather than -Infinity", () => {
  assertEquals(bestPromoPct(m()), 0);
});

Deno.test("takes the largest percent, not the first", () => {
  assertEquals(bestPromoPct(m("Diskon 30%", "Diskon 50%", "Diskon 25%")), 50);
});

Deno.test("reads a percent that is not at the start", () => {
  assertEquals(bestPromoPct(m("Flash sale 35%")), 35);
});

// The rupiah amount must not be read as a percentage: "Diskon Rp30.000" would
// otherwise score 30 and outrank a genuine 25% off.
Deno.test("a rupiah offer scores 0, its digits are not a percent", () => {
  assertEquals(bestPromoPct(m("Diskon Rp30.000")), 0);
  assertEquals(bestPromoPct(m("Diskon Rp30.000", "Diskon 25%")), 25);
});

// GoFood states the cap and the minimum in the same string; only the discount
// is a percentage, so the trailing rupiah figures must stay out of it.
Deno.test("GoFood's capped offer reads only its percent", () => {
  assertEquals(
    bestPromoPct(m("Diskon 31%, maks. 36rb (Min. pembelian 108rb)")),
    31,
  );
});
