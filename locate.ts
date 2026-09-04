// deno task locate <alamat...> [--write]  — resolve an address to FOOD_* coordinates.
import { warpClient } from "./net/warpClient.ts";
import { header, table } from "./util/report.ts";
import { checkFlags, die } from "./util/flags.ts";

/** .env with FOOD_LAT/LNG/ADDRESS replaced in place, appended when missing. */
export function updatedEnv(
  text: string,
  v: { lat: string; lng: string; address: string },
): string {
  const set = {
    FOOD_LAT: v.lat,
    FOOD_LNG: v.lng,
    FOOD_ADDRESS: JSON.stringify(v.address),
  };
  for (const [key, value] of Object.entries(set)) {
    const line = `${key}=${value}`;
    text = new RegExp(`^${key}=`, "m").test(text)
      ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  return text;
}

type Hit = {
  lat: string;
  lon: string;
  type: string;
  display_name: string;
};

if (import.meta.main) {
  checkFlags(Deno.args, { boolean: ["--write", "--json"], value: [] });

  const query = Deno.args.filter((a) => !a.startsWith("--")).join(" ");
  if (!query) {
    console.error("usage: deno task locate <alamat> [--write] [--json]");
    console.error('  example: deno task locate "Monas, Jakarta Pusat" --write');
    console.error(
      "  --write puts the first match into .env as FOOD_LAT/LNG/ADDRESS",
    );
    Deno.exit(1);
  }

  const r = await fetch(
    "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=id&limit=5&q=" +
      encodeURIComponent(query),
    {
      client: warpClient,
      headers: { "User-Agent": "indogfood.ts (personal food finder)" },
    },
  ).catch((e: Error) =>
    die(`geocoder unreachable: ${e.message.split("\n")[0]}`)
  );
  if (!r.ok) die(`geocoder answered ${r.status}; wait a minute and retry`);
  const hits: Hit[] = await r.json();
  if (!hits.length) {
    die(
      `no place found for "${query}"`,
      "add the city or a nearby landmark and try again",
    );
  }

  if (Deno.args.includes("--json")) {
    console.log(JSON.stringify({ query, hits }, null, 2));
    Deno.exit(0);
  }

  const best = hits[0];
  console.log(header("indogfood locate", {
    query,
    matched: best.display_name,
    env: `FOOD_LAT=${best.lat} FOOD_LNG=${best.lon} FOOD_ADDRESS=${
      JSON.stringify(query)
    }`,
  }));
  if (hits.length > 1) {
    console.log();
    console.log(table(
      ["lat", "lng", "type", "name"],
      hits.map((h) => [h.lat, h.lon, h.type, h.display_name]),
    ));
  }

  if (Deno.args.includes("--write")) {
    const text = await Deno.readTextFile(".env").catch(() => "");
    await Deno.writeTextFile(
      ".env",
      updatedEnv(text, { lat: best.lat, lng: best.lon, address: query }),
    );
    console.log(`\nwrote first match to .env; others above were not used`);
  } else {
    console.log(`\nnext: deno task locate ${JSON.stringify(query)} --write`);
  }
}
