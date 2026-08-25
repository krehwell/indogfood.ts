/**
 * Drive a throwaway headless Chromium over the DevTools Protocol, with no
 * automation library. Used where a site only answers a real browser: Grab's
 * guest token is gated on a client-side anti-abuse SDK, and Google Maps has no
 * public data route at all.
 */

import { warpEnabled } from "./warpClient.ts";

const CANDIDATES = [
  Deno.env.get("CHROME_PATH"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
].filter((p): p is string => !!p);

function chromePath(): string {
  for (const p of CANDIDATES) {
    try {
      if (Deno.statSync(p).isFile) return p;
    } catch { /* next */ }
  }
  throw new Error(
    "No Chromium/Chrome found. Install one (Arch: `sudo pacman -S chromium`,\n" +
      "Debian: `sudo apt install -y chromium`) or point CHROME_PATH at the binary.",
  );
}

export type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<
    // deno-lint-ignore no-explicit-any
    any
  >;
  /** Run JS in the page and return its value. */
  eval: <T>(expression: string) => Promise<T>;
  close: () => void;
  deadline: number;
};

async function firstPage(port: number, deadline: number): Promise<string> {
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`))
        .json();
      // deno-lint-ignore no-explicit-any
      const page = list.find((t: any) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* devtools not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("browser never opened a page");
}

async function attach(wsUrl: string, deadline: number): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = () => res(null);
    ws.onerror = () => rej(new Error("devtools websocket failed"));
  });

  let id = 0;
  // deno-lint-ignore no-explicit-any
  const pending = new Map<number, (v: any) => void>();
  const send: Cdp["send"] = (method, params = {}) => {
    const myId = ++id;
    ws.send(JSON.stringify({ id: myId, method, params }));
    return new Promise((res) => pending.set(myId, res));
  };

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)!(m.result);
  };

  // Without this Runtime.evaluate silently returns nothing.
  await send("Runtime.enable");

  return {
    send,
    eval: async (expression) =>
      (await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }))?.result?.value,
    close: () => ws.close(),
    deadline,
  };
}

/** Open `url` in a fresh browser, run `fn` against the page, then tear down. */
export async function browse<T>(
  url: string,
  timeoutMs: number,
  fn: (cdp: Cdp) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const profile = Deno.makeTempDirSync({ prefix: "indogfood-" });

  const proc = new Deno.Command(chromePath(), {
    args: [
      "--headless=new",
      // 0 = let Chrome pick a free port; it writes the real one to
      // DevToolsActivePort, so concurrent runs never collide.
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--lang=id",
      // Headless Chrome says so in its UA, and Google Maps answers that with a
      // "limited view" that hides review counts and prices.
      "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      "--window-size=1280,2000",
      // Only where WARP is actually listening. Passing this unconditionally
      // points the Mac's Chromium at a dead port, so it reaches nothing and
      // the run times out with no clue why.
      ...(warpEnabled ? ["--proxy-server=socks5://127.0.0.1:40000"] : []),
      // Required when the VPS runs this as root, harmless otherwise.
      "--no-sandbox",
      url,
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();

  const portFile = `${profile}/DevToolsActivePort`;
  let port = 0;
  while (!port) {
    if (Date.now() > deadline) break;
    try {
      port = Number(Deno.readTextFileSync(portFile).split("\n")[0]);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  let cdp: Cdp | undefined;
  try {
    if (!port) throw new Error("browser did not start");
    cdp = await attach(await firstPage(port, deadline), deadline);
    return await fn(cdp);
  } finally {
    cdp?.close();
    try {
      proc.kill();
    } catch { /* already gone */ }
    await proc.status;
    try {
      Deno.removeSync(profile, { recursive: true });
    } catch { /* best effort */ }
  }
}
