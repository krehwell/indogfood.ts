# indogfood.ts

Imagine asking your AI agent to find food around you so it fits your diet menu.
This tool was built exactly for that. _Note: Indonesia only._

It lists open restaurants near you and their menus, pulled from **GrabFood** and
**GoFood** together and sorted by distance. Read-only: it never places an order,
you (or your agent) just use it to decide what to order.

## Usage

```sh
deno task resto                  # open restaurants near you, both apps
deno task resto sate             # keyword search
deno task resto --cuisines       # what food categories are actually nearby
deno task resto --cuisine=sehat  # filter by category (substring: ayam, kopi, sehat)
deno task resto --all            # include closed ones
deno task resto --source=gofood  # one provider only (grab | gofood)
deno task resto --limit=200      # page deeper on Grab (default 64)
deno task menu <id>              # full menu; provider inferred from the id
deno task menu <id> --all        # include out-of-stock items

# add --json to either for a parsed object instead of the text report
```

Restaurant IDs come from `deno task resto`. Giving this to an agent? Feed it
[AGENT.md](AGENT.md).

`--cuisine` matches the apps' own tags by substring, so short roots work best:
`ayam` catches both Grab's `Hidangan Ayam` and GoFood's `Ayam & bebek`. Run
`--cuisines` first to see the real vocabulary instead of guessing.

## Setup

Needs Deno and a Chrome/Chromium binary.

```sh
brew install --cask chromium     # Debian/Ubuntu: sudo apt install -y chromium
cp .env.example .env             # then set your address, see below
```

No login, no API key. Just set where you are in `.env`:

```sh
FOOD_LAT=-6.175392
FOOD_LNG=106.827153
FOOD_ADDRESS="Monas, Gambir, Jakarta Pusat"
FOOD_COUNTRY=ID
```

To get the coordinates: set your delivery address on food.grab.com, then read
`latitude`/`longitude` out of the `location` cookie. Results are scoped to this
address, so a wrong one gives wrong answers.

## Good to know

- Run it from a home connection in Indonesia. GoFood blocks datacenter/VPN IPs;
  from one of those you still get Grab results plus a warning line.
- GoFood caps search at 12 results, so its coverage is shallower than Grab's.
- Be patient: requests are deliberately paced so the apps don't block you.
