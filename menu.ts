import * as grab from "./net/grab.ts";
import * as gofood from "./net/gofood.ts";
import { location, sourceOf } from "./net/types.ts";
import { header, nowLine, table } from "./util/report.ts";
import { checkFlags, die } from "./util/flags.ts";

checkFlags(Deno.args, { boolean: ["--all", "--json", "--promo"], value: [] });

const flags = new Set(Deno.args.filter((a) => a.startsWith("--")));
const id = Deno.args.find((a) => !a.startsWith("--"));

if (!id) {
  console.error("usage: deno task menu <id> [--all] [--promo] [--json]");
  console.error("  <id> comes from `deno task resto` (either source)");
  console.error("  grab:   6-C6WXGYDDC24GC2");
  console.error("  gofood: sate-apaleh-geurugok-aceh-de9561db-...");
  Deno.exit(1);
}

const loc = location();
const isGrab = sourceOf(id) === "grab";
// A bad id otherwise surfaces as an unhandled rejection and a stack trace,
// which buries the one thing worth saying: the id did not resolve.
const m = await (isGrab ? grab.menu(loc, id) : gofood.menu(loc, id))
  .catch((e: Error) =>
    die(
      `could not read the ${isGrab ? "GrabFood" : "GoFood"} menu for "${id}"`,
      e.message.split("\n")[0],
      "ids come from `deno task resto`; pass the whole id including the uuid",
    )
  );

const onlyPromo = flags.has("--promo");
const rows = m.categories.flatMap((c) =>
  c.items
    .filter((i) =>
      (flags.has("--all") || i.available) &&
      (!onlyPromo || i.priceBeforeRp !== null)
    )
    .map((
      i,
    ) => [
      c.name,
      i.name,
      i.priceRp,
      i.priceBeforeRp,
      i.available,
      i.description,
    ])
);

/**
 * Only GoFood actually reports stock. It has an item status enum with an
 * explicit OUT_OF_STOCK, and outlets do use it. Grab's guest menu sends
 * `available: true` or omits the field entirely: across 644 items from 8
 * merchants, not one came back false. So a Grab menu reading "all available"
 * means the provider said nothing, not that the kitchen confirmed anything,
 * and the header has to say which of the two it is.
 */
const allItems = m.categories.flatMap((c) => c.items);
const outOfStock = allItems.filter((i) => !i.available).length;

/**
 * Only Grab discounts individual items, and it already quoted the reduced
 * figure in price_rp, so without a was_rp column a cut price looked like the
 * normal one. GoFood has no per-item discount to show: its offers hang off the
 * outlet and are applied to the whole cart against a minimum spend.
 */
const cut = allItems.filter((i) => i.priceBeforeRp !== null);
const saved = cut.reduce((n, i) => n + (i.priceBeforeRp! - i.priceRp), 0);
const discountLine = m.source === "gofood"
  ? "not per item on GoFood; its offers apply to the whole cart"
  : cut.length
  ? `${cut.length} of ${allItems.length} items cut, up to Rp${
    Math.max(...cut.map((i) => i.priceBeforeRp! - i.priceRp)).toLocaleString(
      "id-ID",
    )
  } off (Rp${saved.toLocaleString("id-ID")} across all)`
  : "nothing discounted right now";
const stockLine = m.source === "grab"
  ? "not reported by Grab; every item reads available"
  : outOfStock
  ? `${outOfStock} of ${allItems.length} out of stock`
  : `all ${allItems.length} in stock`;

if (flags.has("--json")) {
  console.log(JSON.stringify({ now: new Date().toISOString(), ...m }, null, 2));
  Deno.exit(0);
}

console.log(header("indogfood menu", {
  source: m.source,
  restaurant: `${m.name} (${m.id})`,
  status: `${m.open ? "open" : "CLOSED"} hours=${m.hours}`,
  address: m.address || "-",
  now: nowLine().slice(5),
  items:
    `${rows.length} shown of ${allItems.length} in ${m.categories.length} categories`,
  stock: stockLine,
  discount: discountLine,
  currency:
    "IDR, price_rp is whole rupiah; was_rp is the price before discount",
}));

console.log();
console.log(table(
  ["category", "item", "price_rp", "was_rp", "available", "note"],
  rows,
));

if (onlyPromo && !rows.length) {
  console.log(
    m.source === "gofood"
      ? `\n(GoFood has no per-item discounts; check the outlet's offer in ` +
        `\`deno task resto --promo\` instead)`
      : `\n(nothing on this menu is discounted right now)`,
  );
}

if (!m.open) {
  console.log("\nwarning: restaurant is CLOSED, cannot order now");
}
