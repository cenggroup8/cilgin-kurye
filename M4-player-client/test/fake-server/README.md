# Player controls demo

Use Node 24 or later. From this directory, run `npm ci` and `npm run demo`. Open
`http://localhost:5174` on a computer or use the computer's LAN address on a phone.
Join with the code `DEMO`. The server prints each accepted input and its sequence
number. Hold two controls at once on a phone or use the arrow keys or WASD.

`npm run demo -- --delay-ms 150 --loss 0.2` delays or drops gameplay messages
in both directions. Join and ping still work. Set `--port` to use another port.

The fake server uses MessagePack over `/ws`. The hello and welcome messages
follow #58. The fixture uses provisional join replies, state, control and ping
fields until #35 publishes the shared contract. For M4-1 and M4-3, the recording
is in `recording.ts` and the wire messages are in `fakeServer.ts`.

To hook up a game screen, give its four buttons the `data-control` values
`left`, `right`, `throttle` and `brake`. Use `touch-action: none` on those buttons.
Bind the game container with `bindControls()` and pass `Controls` a callback
that sends the numbered sample through M4-3. Unbind and stop the controls
when leaving the game. A prediction tick can call `publish()` to send the
same freshly numbered sample to the network and predictor.

Run `npm test` and `npm run typecheck` here.
