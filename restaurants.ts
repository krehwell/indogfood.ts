import * as grab from "./net/grab.ts";
import * as gofood from "./net/gofood.ts";
import {
  bestPromoPct,
  location,
  type Merchant,
  type Source,
} from "./net/types.ts";
import { header, nowLine, table } from "./util/report.ts";
import { checkFlags, die, intFlag } from "./util/flags.ts";

checkFlags(Deno.args, {
  boolean: ["--all", "--json", "--cuisines"],
  value: ["--cuisine", "--limit", "--source"],
  optional: ["--promo"],
});

const arg = (name: string) =>
  Deno.args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);

const flags = new Set(Deno.args.filter((a) => a.startsWith("--")));
const keyword = Deno.args.filter((a) => !a.startsWith("--")).join(" ");
const all = flags.has("--all");
const limit = intFlag(arg("--limit"), "--limit", 64);

const SOURCES: Source[] = ["grab", "gofood"];
const only = arg("--source") as Source | undefined;
if (only && !SOURCES.includes(only)) {
  die(`--source must be ${SOURCES.join(" or ")}, got "${only}"`);
}
// Substring, not equality: the tags are the providers' own free text ("Ayam
// Goreng", "Hidangan Ayam", "Ayam Geprek"), so --cuisine=ayam should catch all
// three rather than making you guess the exact label. --cuisines lists them.
const cuisine = arg("--cuisine")?.toLowerCase();
// `--promo` alone means any live offer, `--promo=50` at least 50% off. Percent
// is the only unit both apps state, so it is the only one worth a threshold;
// "Diskon Rp30.000" has no percent and so only survives the bare flag.
const promoRaw = arg("--promo");
let promoMin: number | undefined;
if (flags.has("--promo") || promoRaw !== undefined) {
  if (promoRaw === undefined) {
    promoMin = 0;
  } else {
    const n = Number(promoRaw.replace(/%$/, ""));
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      die(
        `--promo must be a percentage from 1 to 100, got "${promoRaw}"`,
        "pass --promo on its own for any offer at all",
      );
    }
    promoMin = n;
  }
}

const loc = location();

// One provider being down or rate-limited must not hide the other's results,
// so failures are reported alongside whatever did come back.
const errors: string[] = [];
async function from(src: Source, run: () => Promise<Merchant[]>) {
  if (only && only !== src) return [];
  try {
    return await run();
  } catch (e) {
    errors.push(`${src}: ${(e as Error).message.split("\n")[0]}`);
    return [];
  }
}

const [g, gf] = await Promise.all([
  from("grab", () => grab.search(loc, keyword, limit)),
  from(
    "gofood",
    () => keyword ? gofood.search(loc, keyword) : gofood.sweep(loc, limit),
  ),
]);

const warnings = () => {
  for (const e of errors) console.log(`\nwarning: ${e}`);
};

const scanned = [...g, ...gf].sort((a, b) => a.distanceKm - b.distanceKm);
const visible = all ? scanned : scanned.filter((m) => m.open);
const list = visible.filter((m) =>
  (!cuisine || m.cuisine.some((c) => c.toLowerCase().includes(cuisine))) &&
  (promoMin === undefined ||
    (m.promos.length > 0 && bestPromoPct(m) >= promoMin))
);

// A rupiah offer states no percent, so any numeric threshold drops it even
// when it is the better deal. Count them so the gap is visible instead of the
// offer just looking absent.
const shown = new Set(list);
const rupiahOnly = promoMin
  ? visible.filter((m) =>
    !shown.has(m) && m.promos.length > 0 && bestPromoPct(m) === 0
  ).length
  : 0;

// Which categories are actually around you, so --cuisine is a pick and not a
// guess. Counted over what you would otherwise see, so it respects --all.
if (flags.has("--cuisines")) {
  const count = new Map<string, number>();
  for (const m of visible) {
    for (const c of m.cuisine) count.set(c, (count.get(c) ?? 0) + 1);
  }
  const rows = [...count].sort((a, b) =>
    b[1] - a[1] || a[0].localeCompare(b[0])
  );
  console.log(table(["n", "cuisine"], rows.map(([c, n]) => [n, c])));
  console.log(
    `\n${rows.length} categories across ${visible.length} restaurants` +
      `\nnext: deno task resto --cuisine=<text>`,
  );
  // Without this an empty list reads as "no categories here" when the real
  // story is that a provider errored out.
  warnings();
  Deno.exit(0);
}

if (flags.has("--json")) {
  console.log(JSON.stringify(
    {
      now: new Date().toISOString(),
      location: loc,
      query: {
        keyword: keyword || null,
        cuisine: cuisine ?? null,
        showing: all ? "all" : "open",
      },
      errors,
      scanned: scanned.length,
      matched: list.length,
      merchants: list,
    },
    null,
    2,
  ));
  Deno.exit(0);
}

console.log(header("indogfood restaurants", {
  address: `${loc.address} (${loc.latitude},${loc.longitude})`,
  now: nowLine().slice(5),
  query: `keyword=${keyword ? JSON.stringify(keyword) : "-"}${
    cuisine ? ` cuisine=${JSON.stringify(cuisine)}` : ""
  }${
    promoMin === undefined
      ? ""
      : ` promo=${promoMin ? `>=${promoMin}%` : "any"}`
  } showing=${
    all ? "all" : "open-only"
  } scanned=${scanned.length} matched=${list.length}`,
  sources: `grab=${g.length} gofood=${gf.length}`,
}));

console.log();
console.log(table(
  [
    "src",
    "id",
    "open",
    "km",
    "eta_min",
    "rating",
    "votes",
    "hours",
    "cuisine",
    "promo",
    "name",
  ],
  list.map((m) => [
    m.source,
    m.id,
    m.open,
    m.distanceKm.toFixed(1),
    m.etaMinutes,
    m.rating,
    m.votes || null,
    m.hours,
    m.cuisine.join(", "),
    m.promos.join(" / "),
    m.name,
  ]),
));

warnings();
if (rupiahOnly) {
  console.log(
    `\nnote: ${rupiahOnly} more have an offer priced in rupiah with no ` +
      `percent, so --promo=${promoMin} cannot rank them; use --promo alone ` +
      `to include them.`,
  );
}
if (!list.length) {
  console.log(
    // A cuisine that matched nothing is a bad guess at the tag, not an empty
    // neighbourhood; saying "nothing nearby" there would be a lie.
    promoMin !== undefined && visible.length
      ? promoMin
        ? `(nothing at ${promoMin}% or more among ${visible.length} nearby; ` +
          `try a lower --promo, or --promo alone for any offer)`
        : `(no live offers among ${visible.length} nearby right now)`
      : cuisine && visible.length
      ? `(no ${JSON.stringify(cuisine)} among ${visible.length} nearby; ` +
        `run --cuisines to see what is)`
      : all
      ? "(nothing nearby; check FOOD_LAT/FOOD_LNG)"
      : "(nothing open right now; re-run with --all to see closed ones)",
  );
}
console.log(`\nnext: deno task menu <id>`);
