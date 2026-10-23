import { BrowserContext, Frame, expect } from '@playwright/test'
import { BASE_URL, Session, inPeer } from '../helpers'
import { SCALE } from '../comm/helpers'

/**
 * A minimal Edrys module served from a fake cross-origin host, so tests run
 * through the real module path: iframe -> postMessage -> Modules.vue -> Peer ->
 * peer -> iframe -> $Edrys. It loads the app's own built `module/edrys.js`.
 *
 * Page-side state lives in `window.__probe`: `ready` once $Edrys.onReady fired,
 * `msgs` = every message its onMessage received, `aw` = its room awareness.
 */

export const MODULE_ORIGIN = 'http://e2e-module.test'
export const MODULE_URL = `${MODULE_ORIGIN}/probe.html`

const PROBE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>E2E Probe</title>
  <meta name="description" content="e2e probe module">
  <meta name="show-in" content="*">
  <script src="${BASE_URL}/module/edrys.js"></script>
</head>
<body>
  <div id="status">loading</div>
  <script>
    window.__probe = { ready: false, msgs: [] };
    Edrys.onReady(() => {
      Edrys.onMessage((m) => window.__probe.msgs.push({ subject: m.subject, body: m.body }));
      window.__probe.aw = Edrys.getState('e2e', 'Awareness');
      window.__probe.ready = true;
      document.getElementById('status').textContent = 'ready';
    });
  </script>
</body>
</html>`

/** Context hook: serve the probe module (CORS open, as scrapeModule fetches it). */
export async function routeProbeModule(context: BrowserContext) {
  await context.route(`${MODULE_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: PROBE_HTML,
    })
  )
}

/** Owner: make the probe the class's only module, via Classroom.saveClass (what Settings calls). */
export async function ownerAddProbeModule(owner: Session) {
  await inPeer(
    owner.page,
    `
    function walk(vn) {
      if (!vn) return;
      const c = vn.component;
      if (c && c.proxy && typeof c.proxy.saveClass === 'function') return c.proxy;
      const s = c && c.subTree && walk(c.subTree);
      if (s) return s;
      for (const k of Array.isArray(vn.children) ? vn.children : []) {
        const h = walk(k);
        if (h) return h;
      }
    }
    const classroom = walk(document.body.__vue_app__._container._vnode);
    if (!classroom) throw new Error('Classroom component not found');
    // Start from classroom.data like the Settings dialog does: unlike
    // configuration.data it carries the URL's communicationConfig, and dropping
    // that reads as a transport change (-> reload on every peer).
    const data = JSON.parse(JSON.stringify(classroom.data));
    data.modules = [{
      id: 'e2e-probe', url: ${JSON.stringify(MODULE_URL)},
      config: '', studentConfig: '', teacherConfig: '', stationConfig: '',
      showInCustom: '*', width: 'full', height: 'tall',
    }];
    // saveClass closes the Settings dialog via its ref, so open it first (cog button).
    classroom.showSettings = true;
    return (async () => {
      for (let i = 0; i < 50 && !classroom.$refs.Settings; i++) await new Promise((r) => setTimeout(r, 100));
      classroom.saveClass(data);
      classroom.showSettings = false;
      return true;
    })();
  `
  )
}

/** The session's probe iframe once its onReady fired. Re-resolved each call: frames die on reload/room change. */
export async function probe(s: Session, timeout = 30000 * SCALE): Promise<Frame> {
  let frame: Frame | undefined
  await expect
    .poll(
      async () => {
        frame = s.page.frames().find((f) => f.url().startsWith(MODULE_ORIGIN))
        return !!frame && (await frame.evaluate(() => (window as any).__probe?.ready === true).catch(() => false))
      },
      { timeout, message: `${s.peerId.slice(-6)}: probe module ready` }
    )
    .toBe(true)
  return frame!
}

/** Evaluate `fn(arg)` inside the session's probe module. */
export async function inProbe<T, A = undefined>(s: Session, fn: (arg: A) => T, arg?: A): Promise<T> {
  const frame = await probe(s)
  return frame.evaluate(fn as any, arg) as Promise<T>
}

/** Bodies of messages with `subject` the session's probe received, in arrival order. */
export function probeReceived(s: Session, subject: string): Promise<any[]> {
  return inProbe(
    s,
    (subj: string) => (window as any).__probe.msgs.filter((m: any) => m.subject === subj).map((m: any) => m.body),
    subject
  ).catch(() => [])
}
