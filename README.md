# city-foodies.ts

List restaurants that are open near you, and their menus, so you can decide what
to order. Read-only: it never places an order.

Provider status: **GrabFood done**, GoFood not started.

## Usage

```sh
deno task resto                  # open restaurants near your address
deno task resto sate             # open restaurants matching a keyword
deno task resto --all            # include closed ones
deno task resto --limit=200      # page deeper (default 64)
deno task resto --json           # machine-readable, for tool calls

deno task menu 6-C6WXGYDDC24GC2  # full menu of one restaurant
deno task menu <id> --all        # include out-of-stock items
deno task menu <id> --json
```

Restaurant IDs come from `deno task resto`.

## Setup

Needs Deno and a Chromium (or Chrome) binary. On the VPS:

```sh
sudo pacman -S chromium          # Debian/Ubuntu: sudo apt install -y chromium
cp .env.example .env             # then set your address, see below
```

Nothing else. No login, no API key, no manual token step ever.

## Auth: self-contained, no maintenance

GrabFood's API needs a `passenger_authn_token` guest JWT. Minting one requires
an attestation token from Grab's Guardian anti-abuse SDK, which only runs in a
real browser — reimplementing it is not practical.

So the tool mints its own: it launches a throwaway headless Chromium, lets
GrabFood's own web app do the guest login, and reads the token out of the page's
`sessionStorage`. This is driven over the DevTools Protocol directly, so there
is no Playwright/Puppeteer dependency.

The token is cached in `.cache/` and reused until it has under a day left (Grab
issues 30-day tokens). A run therefore costs one browser launch a month; every
other run is a plain HTTP call.

Two failure modes are handled automatically, so the tool needs no babysitting:

- **Expired token** — a cached token under a day from expiry is re-minted before
  use.
- **Revoked token** — Grab allows only one guest session per identity, so if you
  browse food.grab.com yourself, your browser's login revokes ours. The next
  call gets a 401, re-mints, and retries once. Verified by corrupting a cached
  token and watching the run recover on its own.

Only the credential is cached, never restaurant or menu data, so results can
never be served stale.

Caveat worth knowing: this rides GrabFood's public web app. If Grab changes
their frontend or tightens anti-abuse, it needs a fix. That is inherent to the
approach, not something the design can rule out.

## Address

Results are scoped to a delivery address, so a wrong address gives silently
wrong answers. There is no safe default, so these are required in `.env`:

```sh
GRAB_LAT=-6.175392
GRAB_LNG=106.827153
GRAB_ADDRESS="Monas, Gambir, Jakarta Pusat"
GRAB_COUNTRY=ID
```

To get the numbers: on food.grab.com, set your delivery address, then read
`latitude`/`longitude` out of the `location` cookie. `GRAB_ADDRESS` is only a
display label; the coordinates are what Grab actually uses.

Set `CHROME_PATH` if Chromium lives somewhere non-standard.

## Layout

```
net/browserToken.ts   headless Chromium over CDP -> a fresh guest token
net/token.ts          token cache + expiry; the only thing cached to disk
net/grab.ts           GrabFood client: location, search, menu
restaurants.ts        runner: list open restaurants
menu.ts               runner: one restaurant's menu
```

## Notes

- "Open" is Grab's own `openHours.open`, computed server-side, not a local clock
  comparison against posted hours.
- Search page length is not an end-of-results signal: Grab returns a short first
  page before full ones, so paging follows the `hasMore` flag.
- `X-Country-Code` is required on every call; sending `X-GFC-Country` too makes
  Grab reject the request with 400.
