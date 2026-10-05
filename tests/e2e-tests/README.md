# End-to-end tests

Browser tests that run several real peers against a running dev server, over
the real signaling server or WebSocket relay. Each test opens isolated browser
contexts: an **owner** creates a fresh classroom (it is the signed
`setup.createdBy`), and participants join it. Tests drive each page's live
`Peer` (`inPeer` in [helpers.ts](helpers.ts)) or, where the app's own surfaces
are under test, the UI and module iframes.

Assertions read what the classroom renders, not the Y.Doc: inside an `inPeer`
body, `v.users`, `v.rooms`, `v.chat` and `v.setup` are the users and rooms
the Peer last handed to the UI, the chat it shows and the setup it applied.

| Suite            | What it checks                                                                 |
| ---------------- | ------------------------------------------------------------------------------ |
| [`comm/`](comm)  | the transports: shared state, module messages, awareness, leave/reload, stations, reverts |
| [`app/`](app)    | app surfaces: modules in real iframes via `$Edrys`, the owner's Settings → share → join flow |
| [`load/`](load)  | one station with 5 peers on mixed browsers and throttled networks              |

## Setup

1. **Node 24**.
2. **The dev server** on `http://localhost:6999`: `npm run watch`.
3. **Browsers**: `npx playwright install chromium firefox webkit`.

## Running

The npm scripts run `comm/` and `app/` with the right flags:

```bash
npm run test:e2e                          # WebRTC, chromium
npm run test:e2e:ws                       # over the WebSocket relay
E2E_BROWSER=firefox npm run test:e2e      # another browser (firefox, webkit)
npm run test:e2e -- --repeat-each=5       # extra Playwright flags go after --
npm run test:e2e:load                     # load/ (chromium only, see below)
```

Running Playwright directly, always pass one `--project` (browser) and
`--workers=1`: peers of parallel tests would share the signaling server and
the relay.

```bash
# WebRTC (the app's default transport)
npx playwright test tests/e2e-tests/comm --project=chromium --workers=1

# Over the WebSocket relay
E2E_TRANSPORT=ws npx playwright test tests/e2e-tests/comm --project=chromium --workers=1
```

Swap the folder for another suite, or the project for another browser:

```bash
npx playwright test tests/e2e-tests/comm tests/e2e-tests/app --project=firefox --workers=1
E2E_TRANSPORT=ws npx playwright test tests/e2e-tests/comm tests/e2e-tests/app --project=webkit --workers=1
```

`load/` launches its own mix of browsers, so run it with `--project=chromium`
only.

| Variable        | Default                 | Meaning                                                    |
| --------------- | ----------------------- | ---------------------------------------------------------- |
| `E2E_TRANSPORT` | `webrtc`                | `ws` runs over the WebSocket relay                          |
| `E2E_BROWSER`   | `chromium`              | browser for `npm run test:e2e` / `test:e2e:ws`              |
| `E2E_BASE_URL`  | `http://localhost:6999` | where the dev server is served                              |
| `ROUNDS`        | `3`                     | reload rounds in `comm.lifecycle`                           |

On WS, `createClassroom()` reloads the owner onto `#comm=ws` and returns a
join URL that carries it, so every peer ends up on the relay. WS converges
more slowly (identity rides 5s heartbeats), so timeouts scale up
automatically (`SCALE` / `TRANSPORT_TIMEOUT_SCALE`). Add `--repeat-each=N` to
check a suite for flakiness.

## `comm/` — transports

| File                     | Covers                                                                   |
| ------------------------ | ------------------------------------------------------------------------ |
| `comm.sync.spec.ts`      | verified identity both ways, rooms + room moves, chat, late joiner       |
| `comm.messaging.spec.ts` | module messages (3 peers): room-wide from owner/guest, targeted-only, 20-msg burst |
| `comm.awareness.spec.ts` | app awareness (module cursors): both directions, update, removal         |
| `comm.presence.spec.ts`  | 3 peers: everyone shown with their role on every peer, each guest's room move, one leaving is dropped by both others |
| `comm.lifecycle.spec.ts` | abrupt leave detected; reload x`ROUNDS` reconverges, old sessions reaped, no false "has left" on WS |
| `comm.station.spec.ts`   | station room/presence reaches peers, sees a participant, shutdown propagates |
| `comm.revert.spec.ts`    | peers that reverted a forged change keep propagating their own writes (3 peers) |

Failing tests in `messaging`/`station` attach `transport-log.txt`
(SimplePeerTransport + `ts:peer` debug lines from every page).

## `app/` — app surfaces

| File                  | Covers                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| `app.modules.spec.ts` | modules in iframes via `$Edrys`: messages both ways + targeted, awareness + removal, shared `Y.Text` both ways and across a guest reload |
| `app.setup.spec.ts`   | owner configures name/rooms/module in the Settings UI (WS: + "keep in URL"); guest joins from the Communication tab's Shareable Link: owner trust anchor enforced, signed setup applied (name, meta, module running, student role); promote to teacher via Members without reloading the owner; guest keeps the setup after the owner leaves |

[`probe-module.ts`](app/probe-module.ts) serves a minimal module from the fake
origin `http://e2e-module.test` (Playwright `context.route`; pass
`prepare: routeProbeModule` to `createClassroom`/`joinClassroom`). It loads
the app's built `module/edrys.js`, so it runs cross-origin like a real module;
sends and assertions run inside the frame (`inProbe`).

Notes:

- The owner adds the probe via `Classroom.saveClass`, built from
  `classroom.data` like the Settings dialog. `configuration.data` lacks the
  URL's `communicationConfig`, and saving without it reads as a transport
  change, which reloads every peer.
- The first Settings save on a WS run reloads the owner once: the class has no
  signed `communicationConfig` until that save pins `"ws"` (`settle()` waits
  it out).
- "Default number of rooms" is only checked in the setup: it is applied when a
  session starts with no rooms, not live.

## `load/` — station under load

[`station-load.spec.ts`](load/station-load.spec.ts) loads a real published lab
config (the way Settings → "Restore class from URL" does; swap `CONFIG_URL` for
another), opens a station and joins **5 participants** at once:

- 3 chromium contexts, each CDP-throttled to a network profile (`wifi`,
  `slow-4g`, `slow-3g`; `NETWORK_PROFILES` in [load/helpers.ts](load/helpers.ts)),
- 2 more on firefox and webkit, unthrottled (CDP network emulation is
  chromium-only).

All walk into the station's room; the station must see every one of them, and
keep seeing them for `DWELL_MS` (catches peers silently dropping, not just a
one-time convergence). It checks presence only, not module interaction.

Kept to 5 peers on purpose: each is a full browser process, and an earlier
10-peer version exhausted a developer machine. Raise `PEER_COUNT` /
`NETWORK_PROFILES` only on a machine provisioned for it (e.g. CI).
