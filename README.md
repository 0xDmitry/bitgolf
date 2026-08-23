# Bit Golf

Bit Golf is a global peer-to-peer terminal code-golf game built on Pear and Bare. Every installation joins the same Autobase, derives the same ordered submission log, and computes the leaderboard locally.

## Install and run

Install a published build with Pear, then start the CLI:

```sh
pear install pear://<published-bitgolf-app-key>
bitgolf
```

The Pear application key installs Bit Golf; it is separate from the Autobase bootstrap key described below.

Installed builds perform a mandatory OTA release check before opening the terminal or starting the game worker. If the release drive cannot be checked, startup fails closed. If a newer build is found, Bit Golf blocks input, installs it, and exits; restart the command to run the new version. A stalled installation fails instead of leaving the CLI hung indefinitely. Updates discovered during a session immediately close the editor and stop the game worker before installation.

To run from source:

```sh
npm install
npm start
```

`npm start` runs the Bare CLI from source with OTA updates disabled. This bypass is development-only; installed builds do not expose `--no-updates`. Source and installed builds use the same game bootstrap key, so a source client joins the shared game and can submit to it. Use `--storage` to choose a persistent development identity:

```sh
npm start -- --storage /tmp/bitgolf-dev
```

## Navigation

An interactive terminal opens on a short description and three choices: **Start tutorial**, **Solve challenge**, and **Leaderboard**. Use the arrow keys and Enter, or press `1`, `2`, or `3` as a shortcut. Escape returns to the menu without discarding the current program.

The tutorial introduces coordinate bits, postfix operators, and scoring. The challenge shows the target, the current output, and a live diff where each lit pixel marks a mismatch. In the challenge, Up/Down recalls program history. Only the dedicated leaderboard scrolls: Up/Down moves one row, Page Up/Page Down moves one screen, and Home/End jumps to the top or bottom. Interactive screens redraw automatically when the terminal is resized. Ctrl+C exits from any screen.

Piped input skips the menu and shows the same output, target, and diff. Each target-matching line submits automatically; the process waits for queued submission results before exiting at end-of-file.

## Game rules

A submission is a complete Bit Golf program. Bit Golf is a postfix Boolean stack language with ten one-character tokens:

```text
a b c d e f ! & | ^
```

The variables push coordinate bits for each pixel in an 8×8 bitmap: `abc` are the three bits of `x`, and `def` are the three bits of `y`. `!` negates the top stack value; `&`, `|`, and `^` pop two values and push their Boolean result. A complete program never underflows and ends with exactly one stack value.

The append-only challenge registry currently contains one challenge. Its content-derived ID is `0810381c7e0e3c18`, and a submission must render this bitmap exactly:

```text
····█···
···█····
··███···
···███··
·██████·
····███·
··████··
···██···
```

The terminal evaluates the current input after every edit and renders its bitmap with `█` and `·`. The target and mismatch diff remain visible beside the output when the terminal is wide enough. Incomplete programs are labeled calmly and, when possible, preview the top stack value. Enter submits only a complete exact match; Backspace, left/right arrows, and Ctrl+C retain their usual terminal behavior.

Scores are language-token counts. Whitespace inside a target-matching program is ignored for scoring, although the exact submitted text remains in the event log. Programs are stored as data and are never evaluated as JavaScript.

The selected challenge's leaderboard has one row per score. The first valid submission for that challenge encountered in the current Autobase event ordering owns that score. Later submissions with the same score remain in the Autobase event history but do not replace that row. If Autobase later reorders concurrent events, the pure reducer recomputes ownership from the new order.

Current submissions use protocol version 1 and have exactly these fields:

```js
const event = {
  v: 1,
  type: 'submission',
  challenge: '0810381c7e0e3c18',
  program: targetMatchingSource
}
```

Challenge descriptors do not store IDs. Each 8×8 target is packed row by row into eight bytes, with the leftmost pixel as the most-significant bit, and encoded as 16 lowercase hexadecimal characters. This encoding is collision-free for fixed-size Boolean bitmaps: identical targets always have the same ID, and changing any pixel changes the ID.

Every peer validates the event and derives both the score and authenticated author. The author is the full hexadecimal Autobase writer key from `node.from.key`. Local leaderboard entries are labeled `YOU`; other players are represented by a short key prefix. The local writer key is never printed in the UI.

Local submissions are fully validated before they are appended:

- the protocol version must be supported and its exact field set must match;
- the `(v, challenge)` pair must identify a deployed challenge definition;
- `program` must be a non-empty string that evaluates to the exact challenge target;
- program source may contain at most 4,096 characters (whitespace counts toward this resource limit, but not toward score);
- an encoded event may be at most 32 KiB;
- accepted authors must be full 64-character hexadecimal writer keys.

The replicated view admits only submissions supported and verified by the running release. Malformed, oversized, semantically invalid, unknown-protocol, and unknown-challenge events are neither acknowledged nor stored in the view. Mandatory OTA gating prevents a known-outdated installed CLI from joining the game while a release is being installed; source runs explicitly bypass that gate.

Every deployed protocol and challenge version shares one stable Autobase namespace. New releases append challenge definitions, protocol handlers, and rule handlers while retaining the older ones, so stored challenge history can still be replayed with each submission's original semantics. Prototype `stub-v1` entries already present in the reused namespace are archival and intentionally are not a challenge. Mandatory OTA removes the need for old installed binaries to retain future events they cannot understand; it does not remove the need for new binaries to understand deployed challenge history. Changing a target automatically creates a new challenge ID. Deployed definitions are never edited or removed, and the same target bitmap is never reused with different challenge rules or scoring.

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
   |-- challenge registry      append-only protocol/rules/target data
   |-- pure evaluator          syntax, bitmap generation, matching, and diff
   |-- verifier                historical protocol/challenge dispatch and scoring
   |-- events Hypercore view   verified ordered submissions
   `-- pure reducer            leaderboard
```

The updater completes its initial release check before the terminal or game worker starts. The game worker then owns all game storage and networking. It joins the Autobase discovery key, tracks locally connected peers, reads a snapshot of the complete current event view after updates, runs the reducer, and sends the resulting state to the CLI over framed IPC. State derivation is idempotent; no separately mutable leaderboard is persisted.

`workers/main.js` remains a separate worker responsible only for Pear Runtime and OTA updates. It compares the replicated release manifest with the running semantic version, reports a definitive current/update/error outcome, applies downloaded builds, and keeps the game blocked until the old process exits.

## Optimistic non-member submissions

The project pins Autobase `7.28.1` and enables optimistic writes on both the base and each submission append:

```js
await base.append(encodedEvent, { optimistic: true })
```

This allows a peer that is not an Autobase member to propose a block. During `apply()`, Bit Golf validates the installed protocol and challenge, verifies the target and score, and only then calls:

```js
await host.ackWriter(node.from.key)
```

The acknowledged submission is appended to the derived view with its authenticated author. `ackWriter()` acknowledges the optimistic writer without permanently adding it as a normal writer or indexer. Repeated submissions from the same non-member work: every submission is independently validated and acknowledged as it is applied. Invalid submissions are not acknowledged and do not enter the view. The reducer revalidates stored submissions while deriving challenge-scoped leaderboards.

Hyperswarm connections are replicated through Autobase itself:

```js
swarm.on('connection', (connection) => {
  base.replicate(connection)
})
```

Using `base.replicate(connection)` rather than only `store.replicate(connection)` is intentional in Autobase 7.28.1: it also registers Autobase's wakeup protocol on the replication stream.

## Stable bootstrap key

The checked-in bootstrap key is permanent across challenge and protocol upgrades. All source and installed clients use it. Do not replace it during a normal release: a different key starts a separate global game and cannot see the existing history.

To create a new, independent deployment, generate another unowned Autobase namespace once with:

```sh
npm run generate-bootstrap-key
```

The command prints a fresh bootstrap key without creating storage or retaining a private creator identity. Use it only when intentionally starting an independent game namespace. Clients use the stable key in `workers/game/constants.js`; tests generate isolated keys instead.

This works because every player submits as an optimistic non-member and every accepted event is acknowledged during `apply()`. The bootstrap key is only a shared namespace and discovery anchor; there is no privileged creator to keep online or recover later.

When adding a challenge, append its immutable descriptor to `workers/game/challenges.js`, add any new versioned protocol or rule handler, and update the UI to select it. Do not add an ID: it is derived from the target bitmap. Keep all older descriptors and handlers so historical events remain valid. Every target must be unique. The reducer maintains a separate leaderboard for every registered challenge, preventing equal scores from different challenges from competing.

## Two-terminal demo

Terminal A:

```sh
npm start -- --storage /tmp/bitgolf-a
```

Terminal B:

```sh
npm start -- --storage /tmp/bitgolf-b
```

Both source processes use separate local identities while joining the same shared game and its current challenge. Solve the target in either terminal and submit it; both peers should eventually show the same leaderboard row. Add a pair of negations (`!!`) to any exact solution to produce a valid program two tokens longer, then submit it from the other terminal to verify multi-score replication. For two programs with the same score in the same challenge, whichever submission appears first in the current Autobase event view owns that row.

## Persistence

The game Corestore lives under `<storage>/game`. Its namespace is derived from the Autobase bootstrap key. Reusing the same `--storage` path and bootstrap key preserves the local writer identity, replicated event history, and derived leaderboard across restarts and app upgrades. Changing the bootstrap key opens an isolated namespace with a new player identity and an empty game state; it is not a challenge-migration mechanism. Installed builds use Bare's persistent application directory by default; explicit storage paths are recommended for reproducible development and demos.

Do not run two clients against the same storage directory at the same time.

## Tests and lint

Run the Bare test suite and code-quality checks with:

```sh
npm test
npm run lint
```

The suite covers the mandatory updater gate and release comparison, immutable append-only challenge registry, collision-free bitmap-derived IDs, bitmap diff, exact evaluator masks, stack and operator semantics, token scoring and limits, historical protocol validation, target verification across peers, stable-key replay, deterministic challenge-scoped reduction and tie semantics, live terminal editing, worker IPC, persistence, direct in-process Autobase replication, repeated optimistic non-member submissions, and convergence after concurrent writes. Automated replication tests connect peers directly and do not depend on the public DHT.

## Main files

- `bin.mjs`, `terminal.js`, and `submission-coordinator.js` — CLI lifecycle, queued input, feedback, and rendering
- `app.js` — updater/game worker lifecycle and framed IPC
- `workers/main.js` and `workers/release-check.js` — mandatory OTA lifecycle and release comparison
- `workers/worker-task.js` — game IPC commands and state events
- `workers/game/index.js` — game lifecycle, Autobase event view, and derived state
- `workers/game/network.js` — Hyperswarm discovery, replication, and peer count
- `workers/game/challenges.js` — append-only immutable challenge definitions
- `workers/game/evaluator.js` — pure tokenization, stack/bitmap evaluation, matching, and diff
- `workers/game/protocol.js` — bitmap IDs, versioned event creation, validation, encoding, and bounds
- `workers/game/verifier.js` — event-aware target validation and token-derived scoring
- `workers/game/reducer.js` — pure challenge-scoped ordered-events-to-leaderboard reduction
- `scripts/generate-bootstrap-key.js` — one-time unowned bootstrap-key generator
