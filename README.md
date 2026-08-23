# bitgolf

**A global peer-to-peer code-golf game for your terminal. Built with Pear and Bare.**

Generate an 8×8 bitmap with a tiny 10-instruction language. Find a program that matches the target, submit it, then make it shorter.

Every player joins the same global P2P game. There is no server, account, or central leaderboard.

```text
TARGET          YOUR OUTPUT

····█···       ····█···
···█····       ···█····
··███···       ··███···
···███··       ···███··
·██████·       ·██████·
····███·       ····███·
··████··       ··████··
···██···       ···██···

62 bytes · MATCH ✓
```

## Play

Install Bit Golf with Pear:

```sh
pear install pear://onzw8zpoon5ux1o8sap7kazrporj3hew3dhnqki66dcnjtubtmqo
```

Then run:

```sh
bitgolf
```

That's it.

New players can start with the interactive local tutorial before joining the global challenge.

## How it works

A Bit Golf program generates one 8×8 monochrome bitmap.

The entire language is:

```text
a b c d e f ! & | ^
```

`a b c` are vertical coordinate masks, from coarse to fine.

`d e f` are their horizontal equivalents.

The four operators combine images:

```text
!   invert
&   overlap
|   combine
^   xor
```

Programs use postfix notation, so:

```text
ad&
```

means `a AND d`.

And:

```text
cf^
```

produces a checkerboard:

```text
·█·█·█·█
█·█·█·█·
·█·█·█·█
█·█·█·█·
·█·█·█·█
█·█·█·█·
·█·█·█·█
█·█·█·█·
```

While you type, Bit Golf evaluates the program and redraws its output in real time.

Once your output exactly matches the target, submit it.

**Your score is the number of instructions in the program. Lower is better.**

## The challenge

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

Finding _a_ program is only the beginning.

The real game is discovering a smaller one.

Every valid submission is replicated through the P2P network, and every peer independently verifies it and computes the same leaderboard.

## Peer-to-peer by design

Bit Golf is built entirely on the Pear stack:

- **Bare** runs the standalone terminal application.
- **Hyperswarm** discovers and connects players directly.
- **Autobase + Corestore** replicate the shared multiwriter submission history.
- Every peer validates submissions and derives the leaderboard locally.
- **pear-runtime** delivers application updates over the Pear network.

There is no application server, hosted database, leaderboard API, or central game authority.

The terminal is the UI; networking and replicated game state run in Bare workers behind IPC.

## Try it with two local peers

Run two instances with separate local identities:

```sh
# terminal A
npm install
npm start -- --storage /tmp/bitgolf-a
```

```sh
# terminal B
npm start -- --storage /tmp/bitgolf-b
```

Both instances join the same global game.

Submit a solution from one terminal and watch the other converge on the same leaderboard.

## Development

Requirements:

- Node.js / npm for development
- Pear for installed builds

Run from source:

```sh
npm install
npm start
```

Tests and lint:

```sh
npm test
npm run lint
```

Source runs disable OTA updates for development. Installed builds use the published Pear release and receive updates through `pear-runtime`.

## Built for Aleph Hackathon 2026

Bit Golf is an entry for the **Pears Track**.

It demonstrates a standalone Bare CLI, real peer-to-peer multiwriter state, direct peer discovery and replication, persistent local identity/state, and Pear-native installation and OTA updates.

## License

MIT
