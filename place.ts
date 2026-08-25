import { place } from "./net/gmaps.ts";
import { sourceOf } from "./net/types.ts";
import { header, nowLine, table } from "./util/report.ts";
import { checkFlags, die } from "./util/flags.ts";

checkFlags(Deno.args, { boolean: ["--json"], value: [] });

const id = Deno.args.find((a) => !a.startsWith("--"));

if (!id) {
  console.error("usage: deno task place <id> [--json]");
  console.error(
    "  <id> is a Google Maps id from `deno task resto`, 0x...:0x...",
  );
  Deno.exit(1);
}
if (sourceOf(id) !== "gmaps") {
  die(
    `"${id}" is not a Google Maps id`,
    "Google Maps ids look like 0x2e69f5d2e764b12d:0x3d2ad6ea86e3f1c9",
    "for a Grab or GoFood id use: deno task menu <id>",
  );
}

const p = await place(id).catch((e: Error) =>
  die(`could not read the Google Maps page for "${id}"`, e.message)
);

if (Deno.args.includes("--json")) {
  console.log(JSON.stringify({ now: new Date().toISOString(), ...p }, null, 2));
  Deno.exit(0);
}

console.log(header("indogfood place", {
  source: p.source,
  place: `${p.name} (${p.id})`,
  link: p.url,
  type: p.type || "-",
  rating: p.rating === null
    ? "no reviews"
    : `${p.rating} from ${p.votes} reviews` +
      (p.histogram ? ` (${p.histogram})` : ""),
  price: p.price || "not reported",
  status: p.status || "hours not listed",
  busy: p.busy || "-",
  address: p.address || "-",
  phone: p.phone || "-",
  website: p.website || "-",
  menu: p.menuUrl || "-",
  popular: p.popular.join(", ") || "-",
  about: p.about.join("; ") || "-",
  topics: p.topics.join(", ") || "-",
  now: nowLine().slice(5),
}));

console.log();
console.log(table(["day", "hours"], p.hours.map((h) => h.split(": "))));
console.log();
console.log(table(
  ["stars", "when", "review"],
  p.reviews.map((r) => [r.stars, r.when, r.text]),
));
if (!p.reviews.length) console.log("(no reviews shown by Google)");
