/**
 * Ready-made labs from the edrys-labs organisation on GitHub: every repo with
 * the topic `edrys-lab`, and in it every file that holds a classroom.
 *
 * Only the search goes to the GitHub API (its own limit: 10 a minute without a
 * login). The file list of each repo comes from jsDelivr, which mirrors GitHub
 * (a new file can take some hours to show up there; repos over 50 MB fall back
 * to GitHub's tree API), and the lab files from raw.githubusercontent.com,
 * which has no hourly limit. The summaries are
 * kept in localStorage for a day, so the dialog opens at once.
 */
import { parse, parseClassroom } from './Utils'

export interface Lab {
  repo: string
  path: string
  name: string
  description: string
  modules: string[]
  station: boolean
  raw: string
  html: string
}

export interface LabGroup {
  repo: string
  title: string
  html: string
  labs: Lab[]
}

const OWNER = 'edrys-labs'
const SEARCH = `https://api.github.com/search/repositories?q=topic:edrys-lab+fork:true+owner:${OWNER}&per_page=100`
const FILE_LIST = 'https://data.jsdelivr.com/v1/packages/gh'
const CACHE_KEY = 'edrys-labs'
const CACHE_HOURS = 24
const MAX_PER_REPO = 12

// Short names for the modules of the edrys-labs organisation, by repo name
const MODULE_LABELS: Record<string, string> = {
  'module-markdown-it': 'Markdown',
  'module-monaco-editor': 'Editor',
  'module-pyxtermjs': 'Terminal',
  'module-streaming': 'Camera',
  'module-avr8js': 'Arduino simulator',
  'module-blockly-duino-v2': 'BlockDuino',
  'module-serial': 'Serial',
  'module-micropython-webrepl': 'WebREPL',
  'module-micropython-simulator': 'MicroPython simulator',
  'module-arduinoview': 'Arduinoview',
  'module-survey': 'Survey',
  'module-code-logger': 'Code logger',
  'module-station-light-control': 'Light',
  'module-station-lights-module': 'Light',
  'module-liascript': 'LiaScript',
  'module-whiteboard': 'Whiteboard',
  'module-quill': 'Text editor',
  'module-iframe': 'Web page',
  'module-hardware-control': 'Hardware control',
}

// Repo names that don't read well when tidied
const REPO_TITLES: Record<string, string> = {
  'lab-avr8js-simulation': 'Arduino simulation',
  'lab-robot-operating-system': 'ROS 2',
  'lab-stm32': 'STM32',
  'lab-stm-programming-mbed': 'STM programming (mbed)',
  'lab-tubaf-embedded-systems': 'Embedded systems (TU Freiberg)',
  'lab-web-serial': 'Web Serial',
}

/** "lab-linux-programming" -> "Linux programming" */
export function repoTitle(repo: string): string {
  if (REPO_TITLES[repo]) return REPO_TITLES[repo]
  const words = repo.replace(/^lab-/, '').replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "Linux programming" -> "LP", "STM32" -> "ST" */
export function repoInitials(title: string): string {
  const words = title.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w))
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)
  return letters.toUpperCase()
}

/** A module's short name from its URL: https://edrys-labs.github.io/module-x/… */
export function moduleLabel(url: string): string {
  let name = ''
  try {
    const u = new URL(url)
    name = u.pathname.split('/').filter(Boolean)[0] || u.hostname
  } catch {
    return ''
  }
  if (MODULE_LABELS[name]) return MODULE_LABELS[name]
  const words = name.replace(/^module-/, '').replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The files of a repo that may hold a classroom. A YAML file wins over a JSON
 * file of the same name (labs often keep both, the JSON one generated).
 */
export function labFiles(paths: string[]): string[] {
  const files = paths
    .map((path) => path.replace(/^\/+/, ''))
    .filter((path) => /\.(ya?ml|json)$/i.test(path))
    .filter((path) => {
      const name = path.split('/').pop()!.toLowerCase()
      return (
        !path.startsWith('.') &&
        !path.includes('/.') &&
        !path.startsWith('node_modules/') &&
        !/^docker-compose/.test(name) &&
        !/^(package(-lock)?|tsconfig|jsconfig|composer)\.json$/.test(name)
      )
    })

  const stem = (path: string) => path.replace(/\.(ya?ml|json)$/i, '')
  const yamlStems = new Set(files.filter((p) => !/\.json$/i.test(p)).map(stem))
  return files
    .filter((p) => !/\.json$/i.test(p) || !yamlStems.has(stem(p)))
    .slice(0, MAX_PER_REPO)
}

/** A module runs on a station when its "show in" lists station. */
function onStation(module: any): boolean {
  const showIn = module?.showInCustom ?? module?.showIn ?? ''
  const places = Array.isArray(showIn) ? showIn : String(showIn).split(',')
  return places.some((p: any) => String(p).trim().toLowerCase() === 'station')
}

/**
 * The summary of a lab file, or undefined when it holds no classroom. A
 * classroom needs a non-empty list of modules: parseClassroom alone accepts
 * any object (a docker-compose file, say).
 */
export function summarize(
  text: string,
  file: { repo: string; path: string; raw: string; html: string }
): Lab | undefined {
  let raw: any
  try {
    raw = parse(text)
  } catch {
    return undefined
  }
  if (!raw || !Array.isArray(raw.modules) || raw.modules.length === 0) return undefined

  const data = parseClassroom(text)
  if (!data) return undefined

  const modules: string[] = []
  for (const m of data.modules) {
    const label = typeof m.url === 'string' ? moduleLabel(m.url) : ''
    if (label && !modules.includes(label)) modules.push(label)
  }

  return {
    ...file,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : file.path,
    description: typeof data.meta.description === 'string' ? data.meta.description.trim() : '',
    modules,
    station: data.modules.some(onStation),
  }
}

/** Groups that run in the browser alone come first, then by title. */
export function sortGroups(groups: LabGroup[]): LabGroup[] {
  const browserOnly = (g: LabGroup) => g.labs.some((l) => !l.station)
  return groups
    .filter((g) => g.labs.length > 0)
    .sort(
      (a, b) =>
        Number(browserOnly(b)) - Number(browserOnly(a)) || a.title.localeCompare(b.title)
    )
}

function readCache(): LabGroup[] | undefined {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (cache && Date.now() - cache.time < CACHE_HOURS * 3600 * 1000 && Array.isArray(cache.groups)) {
      return cache.groups
    }
  } catch {}
}

function writeCache(groups: LabGroup[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), groups }))
  } catch {}
}

async function json(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

/**
 * The paths in a repo: from jsDelivr, which has no hourly limit, else from
 * GitHub's tree API (jsDelivr refuses repos over 50 MB).
 */
async function repoFiles(name: string, branch: string, fetcher: typeof fetch): Promise<string[]> {
  try {
    const listing = await json(
      `${FILE_LIST}/${OWNER}/${name}@${encodeURIComponent(branch)}?structure=flat`,
      fetcher
    )
    if (Array.isArray(listing.files)) return listing.files.map((f: any) => String(f?.name ?? ''))
  } catch {}

  const tree = await json(
    `https://api.github.com/repos/${OWNER}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    fetcher
  )
  return (tree.tree || []).filter((t: any) => t.type === 'blob').map((t: any) => String(t.path))
}

async function loadRepo(repo: any, fetcher: typeof fetch): Promise<LabGroup> {
  const branch = repo.default_branch || 'main'
  const paths = await repoFiles(repo.name, branch, fetcher)

  const labs = await Promise.all(
    labFiles(paths).map(async (path) => {
      const file = {
        repo: repo.name,
        path,
        raw: `https://raw.githubusercontent.com/${OWNER}/${repo.name}/${branch}/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        html: `${repo.html_url}/blob/${branch}/${path}`,
      }
      try {
        const response = await fetcher(file.raw)
        return response.ok ? summarize(await response.text(), file) : undefined
      } catch {
        return undefined
      }
    })
  )

  return {
    repo: repo.name,
    title: repoTitle(repo.name),
    html: repo.html_url,
    labs: labs.filter((l): l is Lab => !!l),
  }
}

/**
 * All labs, grouped by repo. A repo that fails to load (the hourly limit,
 * say) is left out; the list is only cached when every repo loaded.
 */
export async function loadLabs(
  { fresh = false, fetcher = fetch.bind(globalThis) as typeof fetch } = {}
): Promise<LabGroup[]> {
  if (!fresh) {
    const cached = readCache()
    if (cached) return cached
  }

  const search = await json(SEARCH, fetcher)
  let complete = true
  const groups = await Promise.all(
    (search.items || []).map((repo: any) =>
      loadRepo(repo, fetcher).catch((e) => {
        console.warn('could not load lab repo', repo.name, e)
        complete = false
        return undefined
      })
    )
  )

  const sorted = sortGroups(groups.filter((g): g is LabGroup => !!g))
  if (sorted.length === 0) throw new Error('no labs found')
  if (complete) writeCache(sorted)
  return sorted
}

/** The classroom of a lab, ready to import (members and identity dropped). */
export async function fetchLab(lab: Lab, fetcher = fetch.bind(globalThis) as typeof fetch) {
  const response = await fetcher(lab.raw)
  if (!response.ok) throw new Error(`${response.status} ${lab.raw}`)
  const data = parseClassroom(await response.text())
  if (!data) throw new Error('not a classroom: ' + lab.raw)
  return data
}
