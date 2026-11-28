# Shared fakes

Fake parts that more than one adapter needs (a fake game server, a fake phone, a fake board).
A fake may use only `contracts/`, `../src/` and other fakes, never a module folder:
then an adapter that uses a fake still runs without the other modules (`npm run check-imports`).

A fake that only one module needs stays in that module (for example `M2-network/test/fakes/`).

| Fake | Takes the place of | Used by |
| --- | --- | --- |
| `boardServer.ts` | the server side of the board link (M2-4), written only from `contracts/board_protocol.md`. Its bytes match `board_protocol_vectors.json` (test). | M6 (link part) |
