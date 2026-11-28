# Module demo page

One page for the module demo: pick **M1–M6**, see what the module takes and gives (the
input and output tables of the v2.1 document), which files a demo uses, what fake data it
gets instead of the other modules, and what it must give. **Başlat** runs the demo or the
tests with fake data and shows the output live, with ✓ or ✗ at the end.

```
cd tools/module-demo
npm start            # http://localhost:8099   (PORT=9000 npm start for another port)
```

Node.js 20 or newer, no packages. The first run of a demo installs that package's
packages (`npm ci`) once.

## How it works

- `modules.json` has everything the page shows. Each module has `inputs`, `outputs` and
  `runs`; a run has a `label`, the folder (`cwd`) and command (`cmd`), the `files` it uses,
  the `fake` data it gets, what it must give (`expect`), the files it `needs`, and the
  packages to `install` first.
- A run whose files are not on this branch yet shows the PR it comes in (`pr`). A run that
  needs a tool that is missing here (`tool`, for example `make` for the C++ tests) is shown
  but cannot start.
- `server.mjs` serves the page and runs **only** the commands in `modules.json`, only for
  this computer (127.0.0.1), and streams the output to the page.

## Add your package

Add a run to your module in `modules.json`, for example:

```json
{
  "label": "Bot drivers (M3-5)",
  "cwd": "M3-physics-traffic",
  "cmd": "npm run demo:bots",
  "needs": ["M3-physics-traffic/src/traffic/bots/bots.ts"],
  "files": ["M3-physics-traffic/src/traffic/bots/bots.ts"],
  "fake": "What the demo gets instead of the other modules",
  "expect": "What a person must see when it works",
  "install": ["M3-physics-traffic"]
}
```

The command must end by itself (a demo with a fixed time or a test run), so the page can
show ✓ or ✗.
