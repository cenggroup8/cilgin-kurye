# Shared fakes

Fake parts that more than one adapter needs (a fake game server, a fake phone, a fake board).
A fake may use only `contracts/`, `../src/` and other fakes, never a module folder:
then an adapter that uses a fake still runs without the other modules (`npm run check-imports`).

A fake that only one module needs stays in that module (for example `M2-network/test/fakes/`).
