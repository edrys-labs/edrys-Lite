import { expect, TestInfo } from '@playwright/test'
import { writeFileSync } from 'fs'
import { inPeer, sleep, Session, TRANSPORT } from '../helpers'

/**
 * Helpers for the communication suite: assert that legitimate state and
 * messages DO arrive at the other peers.
 */

// WS goes through a relay and verifies identity via 5s awareness heartbeats.
export const SCALE = TRANSPORT === 'ws' ? 2 : 1

/**
 * Poll `body` (statement block, `p` = the Peer, returns boolean) on `s` until
 * true. Evaluation errors count as false — the page may be mid-reload.
 */
export async function eventually(
  s: Session,
  body: string,
  what: string,
  timeout = 20000 * SCALE
) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await inPeer<boolean>(s.page, body).catch(() => false)) return
    await sleep(1000)
  }
  expect(false, `${what} — not reached within ${timeout}ms`).toBe(true)
}

/** `a` has completed the identity handshake with `b` (messages from b are accepted). */
export async function waitForVerified(a: Session, b: Session) {
  const id = JSON.stringify(b.peerId)
  const body =
    TRANSPORT === 'ws'
      ? `return p.provider._verifiedUsers.has(${id})`
      : `return !!p.provider.transport.peerIdForUser(${id})`
  try {
    // Leaves room for one stalled connection to time out (15s) and rebuild.
    await eventually(a, body, `${a.peerId} verified ${b.peerId}`, 45000 * SCALE)
  } catch (e) {
    console.log(`verify ${a.peerId.slice(-6)} -> ${b.peerId.slice(-6)} failed:`, JSON.stringify(await transportState(a).catch(String)))
    throw e
  }
}

/** Diagnostic snapshot of a peer's transport, for failure messages. */
export function transportState(s: Session) {
  return inPeer(
    s.page,
    TRANSPORT === 'ws'
      ? `const a = p.provider; return { verified: [...a._verifiedUsers].map((u) => u.slice(-6)), hb: [...a._lastHeartbeats.keys()].map((u) => u.slice(-6)), users: Object.keys(p.y.users.toJSON()).map((u) => u.slice(-6)) }`
      : `const t = p.provider.transport; return {
          self: t.peerId,
          peers: [...t.peers.values()].map((x) => [x.peerId, x.connected, x.peer.destroyed, x.peer._pc && x.peer._pc.connectionState].join('/')),
          announced: [...t.announcedPeers],
          verified: [...t._userIdToPeer.entries()].map(([u, id]) => u.slice(-6) + '=' + id),
          pending: t._pending ? [...t._pending.keys()] : null,
          signaling: t.signalingHealth,
          users: Object.keys(p.y.users.toJSON()).map((u) => u.slice(-6)),
        }`
  )
}

/** Record every module message delivered to this peer in `window.__e2eMsgs`. */
export async function tapMessages(s: Session) {
  await inPeer(
    s.page,
    `
    window.__e2eMsgs = [];
    const orig = p.update.bind(p);
    p.update = function (event, msg) {
      if (event === 'message') window.__e2eMsgs.push(JSON.parse(JSON.stringify(msg)));
      return orig(event, msg);
    };
    return true;
  `
  )
}

/** Bodies of tapped messages with the given subject, in arrival order. */
export function received(s: Session, subject: string): Promise<any[]> {
  return s.page.evaluate(
    (subj) => ((window as any).__e2eMsgs || []).filter((m: any) => m.subject === subj).map((m: any) => m.body),
    subject
  )
}

/** Module message, the same shape Modules.vue sends via `broadcast`. */
export function sendModuleMessage(s: Session, subject: string, body: any, user?: string) {
  const msg = { from: 'e2e', subject, body, user, module: 'e2e' }
  return inPeer(s.page, `p.broadcast(p.user().get('room'), ${JSON.stringify(msg)}); return true`)
}

/**
 * Init script: turn on SimplePeerTransport debug logging as soon as the
 * transport exists (it is created before the page can be scripted otherwise).
 */
export const enableTransportDebug = () => {
  try {
    localStorage.setItem('debug', 'ts:peer')
  } catch {}
  const iv = setInterval(() => {
    const root = (document.body as any)?.__vue_app__?._container?._vnode
    const walk = (vn: any): any => {
      if (!vn) return
      const c = vn.component
      if (c?.proxy?.communication?.provider) return c.proxy.communication
      const s = c?.subTree && walk(c.subTree)
      if (s) return s
      for (const k of Array.isArray(vn.children) ? vn.children : []) {
        const h = walk(k)
        if (h) return h
      }
    }
    const t = root && walk(root)?.provider?.transport
    if (t?.options) {
      t.options.debug = true
      clearInterval(iv)
    }
  }, 20)
}

/** Collect transport/peer console lines per session; attach them to a failed test. */
export function transportLog() {
  const t0 = Date.now()
  const lines: string[] = []
  return {
    watch(name: string, s: Session) {
      s.page.on('console', (m) => {
        const text = m.text()
        if (/SimplePeerTransport|ts:peer/.test(text))
          lines.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name} ${text.slice(0, 240)}`)
      })
    },
    async attachIfFailed(info: TestInfo) {
      if (info.status === info.expectedStatus) return
      const path = info.outputPath('transport-log.txt')
      writeFileSync(path, lines.join('\n'))
      await info.attach('transport-log', { path, contentType: 'text/plain' })
    },
  }
}

/** Unique marker so concurrent/leftover state can't satisfy an assertion. */
export const marker = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
