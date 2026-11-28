# Test bench

One page and one runner for the 4 December demo. Every module runs **alone**, with fake
input, and shows its output as graphs and pass/fail checks. The same scenarios also run
without the page, from the terminal.

Owners: Umutcan (core, M2, M6-1), Berk (M1, M4, M5, city map view),
Muhib (M3, M6-2, M6-3, LED board view).

## Rules

1. **A module runs without the other modules.** An adapter may use only:
   its own module folder, `contracts/`, `tools/testbench/fakes/` and `tools/testbench/src/`.
   A fake may use only `contracts/`, `src/` and other fakes.
   `npm run check-imports` (also part of `npm test`) fails if an import breaks this.
2. **The bench does not change module code.** It only calls the code (import or run a
   command). If a module needs a small hook (for example one more output line in its demo),
   that is a normal pull request to that module, reviewed by its owner.
3. The bench has its own `package.json`. Module `package.json` files, tests and CI do not change.
4. The bench does not replace the module tests. `npm test` / `make test` stay the source of truth.
5. A module without an adapter (or not ready) is shown grey with the reason. The page still works.

## Run

Node.js 20 or newer. Once: `npm ci` here and in every module folder an adapter uses
(for M2: `cd ../../M2-network && npm ci`).

```
cd tools/testbench && npm ci
npm run bench -- list               # modules, scenarios, what is not ready
npm run bench -- m2                 # every timed scenario of M2
npm run bench -- m2 loss30          # one scenario (name or a part of it)
npm run bench -- all                # every timed scenario of every ready module
npm run bench:replay -- runs/<file>.ndjson
npm run bench:ui                    # page on http://localhost:5173
npm test                            # tests of the bench itself + check-imports
```

Exit code 0 only when every scenario passed. Options: `--seconds N`, `--no-save`, `--verbose`.

On the page: choose a scenario on the left; it starts at once. A link can start one too:
`http://localhost:5173/#run=m2/3-loss30`, or play a saved run: `#replay=<file>.ndjson&speed=2`.

A scenario **passes** when it sent at least one check, every check is ok (the last one with
each name counts), and every name in `expect` came.

## Output

The adapter sends one record for each thing that happens. There are three kinds (and log):

| Kind | Fields | Shown as |
| --- | --- | --- |
| `metric` | `t`, `mod`, `name`, `value`, optional `unit` | line graph: one graph per unit, one line per name |
| `event` | `t`, `mod`, `name`, optional `data` | dot on the event time line, one row per name |
| `check` | `mod`, `name`, `ok`, optional `detail` | ✔ / ✘ row in the check list |
| `log` | `mod`, `text` | the log box |

`t` is in seconds from the start of the scenario, `mod` is the module (`M2`).
The runner adds both when the adapter leaves them out.
A metric whose name starts with `set_` is a value that was set (for example `set_delay_ms`
next to the measured `delay_ms`); it is drawn as a grey step line in the same graph.

Examples:

```
{"kind":"metric","name":"delay_ms","value":76.7,"unit":"ms"}
{"kind":"event","name":"hit","data":{"zone":4}}
{"kind":"check","name":"vibrate arrives once","ok":true,"detail":"2 sent, 2 arrived"}
```

**Program output (C++, existing demo scripts).** A program does not need JSON. The runner
reads its standard output line by line:

```
@metric delay_ms 2.1 ms
@event hit zone=4 strength=6
@check "no false event on a quiet table" ok
@check "zone right or next to it" fail 352/360
```

A JSON line works too. Every other line goes to the log box.

Every run is saved as `runs/<module>-<scenario>-<time>.ndjson`: one record per line, a
`run` line first and a `result` line last. A saved run can be played again on the page
(our backup on demo day). `runs/` is not committed, except demo runs added with `git add -f`.

## Scenario

One YAML file per scenario in `scenarios/<module>/`, for example `scenarios/m2/3-loss30.yaml`:

```yaml
module: M2
title: "30 % loss on both directions"
seconds: 12               # leave out (or null) for a live scenario: runs until Stop
params:                   # start values; the adapter knows what they mean
  loss_pct: 30
  expect_loss_pct: [18, 42]
inputs:                   # controls on the page
  - { name: loss_pct, type: slider, label: "Loss (%)", min: 0, max: 50, step: 10 }
  - { name: vibrate, type: button, label: "Vibrate all motors" }
  - { name: hit, type: button, label: "Hand hit, zone", options: [0, 1, 2, 3, 4, 5, 6, 7, 8] }
  - { name: phase, type: select, options: [lobby, playing], start: lobby }
  - { param: board.max_ma }          # range, start and label from the M1-5 parameter list
script:                   # timed inputs, the same as pressing on the page
  - { at: 2, input: vibrate }
  - { at: 3, input: hit, value: 0 }
expect: ["vibrate arrives once", "state loss 18–42 %"]
views: [board]            # module views (below), optional
```

A file name starting with a number keeps the order on the page (`1-clean`, `2-delay80`).

## Adapter

`adapters/<module>/index.ts` (module = `m1` … `m6`) exports `create()` and, if needed, `ready()`:

```ts
import type { Adapter, AdapterModule } from "../../src/adapter.js";

export function create(): Adapter {
  return {
    start(scenario, ctx) { /* start the module with fakes; ctx.emit({ kind: "metric", ... }) */ },
    input(name, value)   { /* a control on the page or a script step */ },
    async stop()         { /* stop everything, emit the last checks; must end within 2 s */ },
  };
}
export function ready() { return null; } // or the reason why it cannot run (shown grey)
export default { create, ready } satisfies AdapterModule;
```

`ctx` has `emit(record)`, `now()` (seconds since the start) and `done()` (the adapter has
finished before the time is over). The module code is imported with a relative path, for
example `../../../../M2-network/src/board/boardLink.js`. Use free ports (port 0), so two
adapters can run at the same time. `adapters/m2/index.ts` is a full example.

For a program (C++ test, `make demo`, a demo script) use the ready command adapter:

```ts
import { commandAdapter } from "../../src/adapter.js";
export const create = () => commandAdapter({
  cmd: "make", args: ["demo"], cwd: join(REPO_DIR, "M6-led-board/firmware/test/link"),
  inputLine: (name, value) => `${name} ${value}`,   // optional: page control → a line on stdin
});
```

It gives the scenario params to the program as `BENCH_<NAME>` environment variables
(and `BENCH_SECONDS`), reads its output as above, adds the check "program ends without error",
and stops the program (with everything it started) when the time is over.

## Views

Every run has the standard views: check list, line graphs, event time line, log.
A module can add its own view: `web/views/<name>.js`, named in `views:` of a scenario.

```js
export default function view(el, { head }) {   // el: an empty card on the page
  return {
    rec(r) { /* every record of the run */ },
    end(result) { /* the run is over (optional) */ },
  };
}
```

Colours: use the CSS variables of `web/style.css` (`--s1` … `--s8` for series in this order,
`--ink`, `--ink-2`, `--grid`, `--surface`); they also work in dark mode.
Planned views:

| View | Owner | Used by |
| --- | --- | --- |
| city map (2D, `contracts/city_plan.json`) | Berk | M1, M3, M5 |
| LED board (788 LEDs, from the `tools/emulators` board view) | Muhib | M6 |
| zone heat map (3 × 3 hits) and sensor signal | Muhib | M6-2 |

## Folders

```
tools/testbench/
  src/                 runner, output reader, CLI, page server, import check   (Umutcan)
  web/                 page and standard views; web/views/ module views         (Umutcan, views: owners)
  fakes/               shared fake server, board, phone                         (everyone)
  adapters/m1..m6/     one folder per module                                    (owners above)
  scenarios/m1..m6/
  runs/                saved runs
  test/                tests of the bench
```

## Not in this version

- No changes to module code, tests or contracts.
- No real board and no real phones; the bench uses only fakes.
- The bench is not a part of the game. It is for tests and the demo.
- The page server listens on this computer only (127.0.0.1).
