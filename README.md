# indogfood.ts

Food-finding tool calls for your AI agent. Lists open restaurants near you and
their menus from **GrabFood** and **GoFood**, plus places from **Google Maps**,
merged and sorted by distance, so the agent picks what fits your diet and you
place the order.

> [!IMPORTANT]
> Indonesia only, and run it from a home connection. GoFood blocks
> datacenter/VPN IPs; from one you still get Grab plus a warning line.

> [!NOTE]
> Read-only. It never orders, it only helps decide.

## Setup

```sh
brew install --cask chromium     # Debian/Ubuntu: sudo apt install -y chromium
cp .env.example .env             # then set your address
```

No login, no API key. Point it at where you are in `.env`:

```sh
FOOD_LAT=-6.175392
FOOD_LNG=106.827153
FOOD_ADDRESS="Monas, Gambir, Jakarta Pusat"
FOOD_COUNTRY=ID
```

`deno task locate "<alamat>" --write` fills those in for you (it geocodes via
OpenStreetMap and rewrites `.env`). Results are scoped to that point, so a wrong
address gives wrong answers.

## Usage

```sh
deno task resto                  # open restaurants nearby, both apps
deno task resto sate             # keyword search
deno task resto --cuisines       # list the food categories nearby
deno task resto --cuisine=sehat  # filter by category
deno task resto --promo          # only ones running an offer
deno task resto --promo=50       # only offers of 50% or more
deno task resto --all            # include closed ones
deno task resto --source=gofood  # one provider only (grab | gofood | gmaps)
deno task resto --limit=200      # page deeper on Grab (default 64)
deno task menu <id>              # full menu, provider inferred from the id
deno task menu <id> --all        # include out-of-stock items
deno task menu <id> --promo      # only discounted items (Grab only)
deno task place <id>             # Google Maps details: hours, price, reviews
deno task locate "<alamat>"      # address -> coordinates; --write updates .env
```

Add `--json` to any of them for structured output. IDs come from
`deno task resto`. Wiring this into an agent? Point it at
[AGENTS.md](AGENTS.md).

## Notes

- **`--cuisine`** matches each app's own tags by substring, so short roots work
  best: `ayam` hits Grab's `Hidangan Ayam` and GoFood's `Ayam & bebek`. Run
  `--cuisines` to see what's actually nearby.
- **`--promo`** reads real offer text. Almost every merchant runs something, so
  the threshold (`--promo=50`) is the useful form. Percent is the only unit both
  apps share, so rupiah offers (`Diskon Rp30.000`) pass bare `--promo` only.
- **`link`** opens the outlet, in the app on a phone, else the browser.
- **`was_rp`** on menus is the pre-discount price. Per-item discounts are Grab
  only; GoFood's offers apply to the whole cart, per the `discount:` line.
- **Bad flags stop the run** with a suggestion, and an empty result says which
  kind of empty it is, rather than failing silently.
- GoFood caps search at 12 results, so its coverage is shallower than Grab's.
- **Google Maps** rows are places to go to, not delivery outlets: no menu, no
  promo, no ETA, and `link` opens the place in Maps. They do carry what the apps
  lack: `votes` (review count), `price` (Google's per-person range) and `rank`
  (where Google put it in its own results). The keyword goes to Google as typed,
  so `deno task resto seafood dan oyster` finds restaurants that serve it, not
  just ones named after it. `open` is `-` when Google lists no hours. It drives
  a headless Chromium, so a run takes 10 to 20 seconds longer.
- **`deno task place <id>`** reads one Google Maps page: weekly hours, price
  range, how busy it is right now, phone, website, what Google calls popular,
  the "Tentang" attributes (dine-in, takeaway, vegetarian options, parking),
  review topics and the latest reviews. For deciding whether a place is worth
  the trip.
- Requests are paced on purpose so the apps don't rate-block you.
