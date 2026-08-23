# Bit Golf

Bit Golf is a global peer-to-peer terminal code-golf game built on Pear and Bare. Every installation joins the same Autobase, derives the same ordered submission log, and computes the leaderboard locally.

## Install and run

Install a published build with Pear, then start the CLI:

```sh
pear install pear://<published-bitgolf-app-key>
bitgolf
```

The Pear application key installs Bit Golf; it is separate from the Autobase bootstrap key described below.

To run from source:

```sh
npm install
npm start
```

`npm start` runs the Bare CLI with OTA updates disabled. Use `--storage` to choose a persistent development identity:

```sh
npm start -- --storage /tmp/bitgolf-dev
```

## Game rules

A submission is a non-empty program string. The MVP verifier is intentionally a stub: it accepts every non-empty string and scores it with `program.length`. Programs are stored as data and are never executed.

The leaderboard has one row per score. The first valid submission encountered in the current Autobase event ordering owns that score. Later submissions with the same score remain in the Autobase event history but do not replace that row. If Autobase later reorders concurrent events, the pure reducer recomputes ownership from the new order.

Submitted protocol events have exactly these fields:

```js
{
  v: 1,
  type: 'submission',
  challenge: 'stub-v1',
  program: 'hello'
}
```

Every peer validates the event and derives both the score and authenticated author. The author is the full hexadecimal Autobase writer key from `node.from.key`; a short prefix is used only for display.

Protocol bounds are enforced before an optimistic writer is acknowledged:

- protocol version, type, challenge, and exact field set must match;
- `program` must be a non-empty string no longer than 4,096 characters;
- an encoded event may be at most 32 KiB;
- accepted authors must be full 64-character hexadecimal writer keys.

Malformed, unsupported, oversized, or unverifiable events are ignored.

## Architecture

```text
bin.mjs                         terminal input and rendering
   |
app.js                         worker lifecycle
   |
framed JSON IPC
   |
workers/index.js
   |
workers/worker-task.js         game commands and state events
   |
workers/game/
   |-- Corestore               persistent local identity and data
   |-- Autobase 7.28.1         deterministic multiwriter ordering
   |-- Hyperswarm              peer discovery and replication
   |-- events Hypercore view   accepted ordered submissions
   `-- pure reducer            leaderboard
```

The game worker owns all game storage and networking. It joins the Autobase discovery key, tracks locally connected peers, reads a snapshot of the complete current event view after updates, runs the reducer, and sends the resulting state to the CLI over framed IPC. State derivation is idempotent; no separately mutable leaderboard is persisted.

`workers/main.js` remains a separate worker responsible only for Pear Runtime and OTA updates.

## Optimistic non-member submissions

The project pins Autobase `7.28.1` and enables optimistic writes on both the base and each submission append:

```js
await base.append(encodedEvent, { optimistic: true })
```

This allows a peer that is not an Autobase member to propose a block. During `apply()`, Bit Golf validates the block, verifies the program, and only then calls:

```js
await host.ackWriter(node.from.key)
```

The acknowledged event is appended to the derived view with its authenticated author. `ackWriter()` acknowledges the optimistic writer without permanently adding it as a normal writer or indexer. Repeated submissions from the same non-member work: every valid optimistic block is independently validated and acknowledged as it is applied. Invalid blocks are not acknowledged and do not enter the view.

Hyperswarm connections are replicated through Autobase itself:

```js
swarm.on('connection', (connection) => {
  base.replicate(connection)
})
```

Using `base.replicate(connection)` rather than only `store.replicate(connection)` is intentional in Autobase 7.28.1: it also registers Autobase's wakeup protocol on the replication stream.

## Generate the bootstrap key

Generate a new unowned Autobase namespace once with:

```sh
npm run generate-bootstrap-key
```

The command prints a fresh bootstrap key without creating storage or retaining a private creator identity. Put the printed hexadecimal key in `GAME_BOOTSTRAP_HEX` in `workers/game/constants.js`. That checked-in constant is the production game bootstrap used by normal clients; tests generate their own keys instead.

This works because every player submits as an optimistic non-member and every accepted event is acknowledged during `apply()`. The bootstrap key is only a shared namespace and discovery anchor; there is no privileged creator to keep online or recover later.

Creating another key creates a different global game, so production bootstrap rotation must be deliberate.

## Two-terminal demo

Terminal A:

```sh
npm start -- --storage /tmp/bitgolf-a
```

Terminal B:

```sh
npm start -- --storage /tmp/bitgolf-b
```

Both processes use separate local identities while joining the same global game. Enter `hello` in either terminal and both peers should eventually show its score-5 row. Enter `x` in the other terminal and both should show score 1. For two score-5 programs, whichever submission appears first in the current Autobase event view owns that row.

## Persistence

The game Corestore lives under `<storage>/game`. Its namespace is derived from the Autobase bootstrap key. Reusing the same `--storage` path and bootstrap key preserves the local writer identity, replicated event history, and derived leaderboard across restarts. Changing the bootstrap key opens an isolated namespace with a new player identity and an empty game state. Installed builds use Bare's persistent application directory by default; explicit storage paths are recommended for reproducible development and demos.

Do not run two clients against the same storage directory at the same time.

## Tests and lint

Run the Bare test suite and code-quality checks with:

```sh
npm test
npm run lint
```

The suite covers protocol validation, the stub verifier, deterministic reduction and tie semantics, worker IPC, persistence, direct in-process Autobase replication, repeated optimistic non-member submissions, and convergence after concurrent writes. Automated replication tests connect peers directly and do not depend on the public DHT.

## Main files

- `bin.mjs` and `terminal.js` — CLI lifecycle, input, feedback, and rendering
- `app.js` — updater/game worker lifecycle and framed IPC
- `workers/main.js` — Pear Runtime and OTA updates
- `workers/worker-task.js` — game IPC commands and state events
- `workers/game/index.js` — game lifecycle, Autobase event view, and derived state
- `workers/game/network.js` — Hyperswarm discovery, replication, and peer count
- `workers/game/protocol.js` — event creation, validation, encoding, and bounds
- `workers/game/verifier.js` — replaceable MVP verifier
- `workers/game/reducer.js` — pure ordered-events-to-leaderboard reduction
- `scripts/generate-bootstrap-key.js` — one-time unowned bootstrap-key generator
