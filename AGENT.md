# indogfood.ts: agent instructions

Find open restaurants near the user's address and read their menus, so you can
pick items (e.g. that fit their diet plan). Read-only: you never place an order;
the user orders themselves. Run everything from this directory.

GrabFood and GoFood are both queried and merged into one list sorted by
distance, so the same restaurant may appear twice, once per app, with slightly
different prices, distance and ETA. Say which app an item came from when you
recommend it, because that decides where the user orders.

## Workflow

1. `deno task resto [keyword]` lists open restaurants. Take the `id` column.
2. `deno task menu <id>` prints that restaurant's full menu.
3. Recommend items to the user; they order.

## Commands

```sh
deno task resto                  # open restaurants near the user's address
deno task resto sate             # filter by keyword
deno task resto --cuisines       # list the food categories actually nearby
deno task resto --cuisine=sehat  # filter by category (substring match)
deno task resto --all            # include closed ones
deno task resto --limit=200      # page deeper on Grab (default 64)
deno task resto --source=gofood  # one provider only (grab | gofood)
deno task menu 6-C6WXGYDDC24GC2  # full menu; provider inferred from the id
deno task menu <id> --all        # include out-of-stock items
```

Add `--json` to either for a parsed object instead of the text report. The
`deno task` banner goes to stderr, so stdout is clean:
`deno task resto --json 2>/dev/null` pipes straight into a JSON parser.

## Reading the output

Context is `key: value` lines above the table; the table has a header naming
every field, one record per line, pipe-separated. Missing values are `-`,
booleans are `yes`/`no`. The closing `next:` line names the command to run with
the IDs just returned.

```
# indogfood restaurants
address: Monas, Gambir, Jakarta Pusat (-6.175392,106.827153)
now: 2026-08-02 03:55:12 Asia/Jakarta (2026-08-01T20:55:12.350Z)
query: keyword="sate" showing=open-only scanned=128 matched=18
sources: grab=64 gofood=64

src|id|open|km|eta_min|rating|votes|hours|cuisine|name
grab|6-C6WXGYDDC24GC2|yes|4.0|26|4.7|878|00:00-23:59|Beverage|Sate Apaleh - Batoh
gofood|sate-kacang-nusantara-de9561db-...|yes|0.4|15|4.2|-|18:00-23:59|Satay|Sate Kacang Nusantara

next: deno task menu <id>
```

`src` tells you which app, and `id` is that app's own handle: Grab ids look like
`6-XXXXXXXX`, GoFood ids are slugs ending in a uuid. Pass either straight to
`deno task menu`; it routes to the right provider.

Menu rows are `category|item|price_rp|available|note`. `price_rp` is whole
rupiah as an integer (`7500`), never `7.5`.

## Notes

- "Open" is each app's own server-side status, already correct for the current
  time - don't second-guess it against the `hours` column.
- Results are scoped to the address in `.env`; auth is automatic (a cached guest
  token, re-minted headlessly when needed). No login or manual step.
- A run may take longer about once a month when the token is re-minted; a 401 is
  retried automatically. If a run fails outright, report the error, don't
  fabricate restaurants or menus.
- If one app fails, the other's results are still printed and the failure shows
  as a `warning:` line. Report that gap rather than implying you saw everything.
- On the VPS, GoFood is currently blocked by its WAF (datacenter IP), so expect
  Grab-only results there. Say the list is GrabFood-only instead of implying
  nothing exists on GoFood.
- GoFood caps each search at 12 results and has no paging, so with no keyword it
  sweeps a set of common cuisines. Its coverage is shallower than Grab's; a
  keyword search is the reliable way to find something specific there.
- `--cuisine` filters the `cuisine` column, which is the apps' own free-text
  tags, so it covers cuisine (`Masakan Jepang`), dish (`Ayam Geprek`) and type
  (`Sehat`, `Sarapan`, `Camilan`) in one namespace. Match is a case-insensitive
  substring, so `--cuisine=ayam` catches `Ayam Goreng`, `Hidangan Ayam` and
  `Bubur Ayam`. Run `--cuisines` first and pick from it rather than guessing a
  tag; a tag that does not exist returns nothing and that is not the same as
  nothing being open.
- Both apps are queried in Indonesian, but they word tags differently: chicken
  is `Hidangan Ayam` on Grab and `Ayam & bebek` on GoFood, healthy is `Sehat`
  versus `Makanan sehat`. Prefer a short root (`ayam`, `nasi`, `sehat`) so one
  search covers both apps; a full label usually matches only the app it came
  from.
- `--cuisine` filters what was already fetched, it does not ask the app for that
  category. So a narrow tag on the default `--limit=64` can look empty when the
  restaurants exist further down; raise `--limit` before concluding there are
  none.
- Grab rate-limits with a `429` if you fetch large pages repeatedly. It shows as
  a `warning: grab: ... -> 429` line and an empty list. Wait a minute and retry
  rather than reporting that nothing is nearby.
