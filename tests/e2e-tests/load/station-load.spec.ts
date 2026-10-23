import { test, expect, chromium, firefox, webkit } from '@playwright/test'
import { createClassroom, closeSessions, sleep } from '../helpers'
import {
  NETWORK_PROFILES,
  PeerSession,
  openThrottledChromiumPeer,
  openPeer,
  openStationAsOwner,
  ownerImportConfigFromUrl,
  waitForLoadedConfigName,
  waitForPeerReady,
  stationUrl,
  enterStationRoom,
  getStationRoomName,
  waitForAllInRoom,
  TRANSPORT,
  TRANSPORT_TIMEOUT_SCALE,
} from './helpers'

/**
 * Load test: one classroom (loaded from a real published config), one
 * station, and 5 participant peers spread across browsers/network
 * conditions, all joining the station's room and holding there.
 *
 * - 3 chromium contexts, each CDP-throttled to a distinct network profile
 *   (see NETWORK_PROFILES in ./helpers).
 * - 2 more contexts on firefox and webkit (no throttling — CDP network
 *   emulation is chromium-only).
 *
 * Kept to 5 peers (not 10): each peer is a full separate browser process
 * (plus the owner + station pages), and running many browsers concurrently
 * on a local dev machine can exhaust RAM/CPU. Scale PEER_COUNT/profiles up
 * only on a machine provisioned for it (e.g. CI).
 *
 * TRANSPORT: default is WebRTC (the app's default provider). Set
 * E2E_TRANSPORT=ws to run over the WebSocket relay instead — same mechanism
 * as the other suites (createClassroom() already switches the owner to WS
 * and returns a joinUrl carrying `#comm=ws`; stationUrl() here preserves that
 * fragment for the station page too). WS converges slower than WebRTC, so
 * convergence/dwell-recheck timeouts are scaled by TRANSPORT_TIMEOUT_SCALE.
 *
 * PREREQUISITE: a running dev server (`npm run watch`) on E2E_BASE_URL
 * (default http://localhost:6999), and all three browsers installed
 * (`npx playwright install chromium firefox webkit`).
 */

const CONFIG_URL =
  'https://raw.githubusercontent.com/edrys-labs/lab-tubaf-embedded-systems/main/laboratory/de/task-1.yaml'

const PEER_COUNT = 5
const DWELL_MS = 60000 * TRANSPORT_TIMEOUT_SCALE

test.describe(`station load (${TRANSPORT}): 5 peers, mixed browsers/network conditions`, () => {
  test('all peers join the station and stay connected', async () => {
    test.setTimeout(6 * 60 * 1000 * TRANSPORT_TIMEOUT_SCALE)

    const ownerBrowser = await chromium.launch()
    const { owner, joinUrl } = await createClassroom(ownerBrowser)
    // Verifies the fetched config actually landed in the signed y.setup config
    // before we build anything on top of it (station, peers).
    const configName = await ownerImportConfigFromUrl(owner, CONFIG_URL)

    // Reload the owner's own page and confirm the config survives it before
    // opening the station off of it.
    await owner.page.reload()
    await waitForPeerReady(owner.page)
    await waitForLoadedConfigName(owner.page, configName)

    // joinUrl looks like BASE_URL + "/?/classroom/<id>/<owner>"
    const match = joinUrl.match(/\/classroom\/([^/]+)\/([^/?#]+)/)
    if (!match) throw new Error(`could not parse classroom id/owner out of ${joinUrl}`)
    const [, id, ownerParam] = match

    const stationJoinUrl = stationUrl(id, ownerParam)
    const station = await openStationAsOwner(owner, stationJoinUrl)
    const stationRoomName = await getStationRoomName(station)
    expect(stationRoomName).toMatch(/^Station /)

    const peers: PeerSession[] = []
    try {
      // 3 chromium peers, each on its own throttled network profile.
      const chromiumPeers = await Promise.all(
        NETWORK_PROFILES.map((profile) =>
          openThrottledChromiumPeer(chromium, joinUrl, profile)
        )
      )
      peers.push(...chromiumPeers)

      // 2 more peers split across firefox/webkit, no throttling.
      const otherPeers = await Promise.all([
        openPeer(firefox, joinUrl),
        openPeer(webkit, joinUrl),
      ])
      peers.push(...otherPeers)

      expect(peers).toHaveLength(PEER_COUNT)

      const byPeerId: Record<string, PeerSession> = Object.fromEntries(
        peers.map((p) => [p.peerId, p])
      )

      // Every peer walks into the station's room (the legit, signed path).
      await Promise.all(peers.map((peer) => enterStationRoom(peer, stationRoomName.replace(/^Station /, ''))))

      // Convergence gate: the station itself must see all 5 in its room.
      // CDP-throttled peers (slow-3g) need more than waitForMesh's
      // 2-peer 20s default budget, and a throttled link can drop the initial
      // gotoRoom write in flight — retry stragglers rather than just
      // widening the timeout.
      await waitForAllInRoom(
        station,
        stationRoomName,
        peers.map((p) => p.peerId),
        90000 * TRANSPORT_TIMEOUT_SCALE,
        { stragglers: byPeerId }
      )

      // Hold the station for a while — presence must remain stable, not just
      // momentarily reached (catches slow-network peers dropping out under load).
      const expectedIds = peers.map((p) => p.peerId)
      const holdUntil = Date.now() + DWELL_MS
      while (Date.now() < holdUntil) {
        await waitForAllInRoom(
          station,
          stationRoomName,
          expectedIds,
          10000 * TRANSPORT_TIMEOUT_SCALE,
          { stragglers: byPeerId }
        )
        await sleep(3000)
      }
    } finally {
      await Promise.all(peers.map((p) => p.close()))
      // station shares owner.context (same page-set) — closing owner covers both.
      await closeSessions(owner)
      await ownerBrowser.close().catch(() => {})
    }
  })
})
