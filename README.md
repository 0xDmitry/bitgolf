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

## Navigation

An interactive terminal opens on a short description and three choices: **Start tutorial**, **Solve challenge**, and **Leaderboard**. Use the arrow keys and Enter, or press `1`, `2`, or `3` as a shortcut. Escape returns to the menu without discarding the current program.

The tutorial introduces coordinate bits, postfix operators, and scoring. In the challenge, Up/Down recalls program history. Only the dedicated leaderboard scrolls: Up/Down moves one row, Page Up/Page Down moves one screen, and Home/End jumps to the top or bottom. Interactive screens redraw automatically when the terminal is resized. Ctrl+C exits from any screen.

Piped input skips the menu, so scripts can continue to submit one program per line.

## Game rules

A submission is a complete Bit Golf program. Bit Golf is a postfix Boolean stack language with ten one-character tokens:

```text
a b c d e f ! & | ^
```

The variables push coordinate bits for each pixel in an 8×8 bitmap: `abc` are the three bits of `x`, and `def` are the three bits of `y`. `!` negates the top stack value; `&`, `|`, and `^` pop two values and push their Boolean result. A complete program never underflows and ends with exactly one stack value. There is no target bitmap yet, so every syntactically complete program is submit-ready.

The terminal evaluates the current input after every edit and renders its bitmap with `█` and `·`. Incomplete programs are labeled calmly and, when possible, preview the top stack value. Enter submits only complete programs; Backspace, left/right arrows, and Ctrl+C retain their usual terminal behavior.

Scores are language-token counts. Whitespace is ignored, so `a b &` has score 3, although the exact submitted text remains in the event log. Programs are stored as data and are never evaluated as JavaScript.

The leaderboard has one row per score. The first valid submission encountered in the current Autobase event ordering owns that score. Later submissions with the same score remain in the Autobase event history but do not replace that row. If Autobase later reorders concurrent events, the pure reducer recomputes ownership from the new order.

Submitted protocol events have exactly these fields:

```js
{
  v: 1,
  type: 'submission',
  challenge: 'stub-v1',
  program: 'ab&'
}
```

Every peer validates the event and derives both the score and authenticated author. The author is the full hexadecimal Autobase writer key from `node.from.key`. Local leaderboard entries are labeled `YOU`; other players are represented by a short key prefix. The local writer key is never printed in the UI.

Protocol bounds are enforced before an optimistic writer is acknowledged:

- protocol version, type, challenge, and exact field set must match;
- `program` must be a non-empty string and pass the shared Bit Golf evaluator;
- program source may contain at most 4,096 characters (whitespace counts toward this resource limit, but not toward score);
- an encoded event may be at most 32 KiB;
- accepted authors must be full 64-character hexadecimal writer keys.

Malformed, unsupported, oversized, or unverifiable events are ignored.

This release intentionally keeps protocol `v: 1`, challenge `stub-v1`, and the existing global Autobase namespace. Because the verifier semantics changed under that protocol identifier, old and new binaries can derive different views while they coexist; deployments should update peers together. A future mixed-version rollout needs an explicit protocol or namespace migration.

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
   |-- pure evaluator          syntax, token score, and 8×8 bitmap
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

Both processes use separate local identities while joining the same global game. Enter `cf^` in either terminal to preview and submit a checkerboard; both peers should eventually show its score-3 row. Enter `a` in the other terminal and both should show score 1. For two programs with the same score, whichever submission appears first in the current Autobase event view owns that row.

## Persistence

The game Corestore lives under `<storage>/game`. Its namespace is derived from the Autobase bootstrap key. Reusing the same `--storage` path and bootstrap key preserves the local writer identity, replicated event history, and derived leaderboard across restarts. Changing the bootstrap key opens an isolated namespace with a new player identity and an empty game state. Installed builds use Bare's persistent application directory by default; explicit storage paths are recommended for reproducible development and demos.

Do not run two clients against the same storage directory at the same time.

## Tests and lint

Run the Bare test suite and code-quality checks with:

```sh
npm test
npm run lint
```

The suite covers exact evaluator masks, stack and operator semantics, token scoring and limits, protocol validation, distributed verification, deterministic reduction and tie semantics, live terminal editing, worker IPC, persistence, direct in-process Autobase replication, repeated optimistic non-member submissions, and convergence after concurrent writes. Automated replication tests connect peers directly and do not depend on the public DHT.

## Main files

- `bin.mjs` and `terminal.js` — CLI lifecycle, input, feedback, and rendering
- `app.js` — updater/game worker lifecycle and framed IPC
- `workers/main.js` — Pear Runtime and OTA updates
- `workers/worker-task.js` — game IPC commands and state events
- `workers/game/index.js` — game lifecycle, Autobase event view, and derived state
- `workers/game/network.js` — Hyperswarm discovery, replication, and peer count
- `workers/game/evaluator.js` — pure tokenization, stack evaluation, and bitmap generation
- `workers/game/protocol.js` — event creation, validation, encoding, and bounds
- `workers/game/verifier.js` — complete-program validation and token-derived scoring
- `workers/game/reducer.js` — pure ordered-events-to-leaderboard reduction
- `scripts/generate-bootstrap-key.js` — one-time unowned bootstrap-key generator
