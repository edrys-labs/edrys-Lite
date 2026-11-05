import { describe, test, expect, beforeEach } from 'vitest'
import {
  labFiles,
  summarize,
  moduleLabel,
  repoTitle,
  repoInitials,
  sortGroups,
  loadLabs,
  fetchLab,
  LabGroup,
} from '../../../src/ts/Labs'

const file = { repo: 'lab-x', path: 'lab.yml', raw: 'https://raw/lab.yml', html: 'https://gh/lab.yml' }

const STATION_LAB = `
name: Arduino - Blink
meta:
  description: Blink a LED
members:
  teacher: [someone]
createdBy: someone
modules:
  - url: https://edrys-labs.github.io/module-markdown-it/index.html
    showInCustom: lobby
    stationConfig: { content: "" }
  - url: https://edrys-labs.github.io/module-monaco-editor/
    showInCustom: station
  - url: https://edrys-labs.github.io/module-markdown-it/index.html
    showInCustom: station
  - url: https://edrys-labs.github.io/module-pyxtermjs/index.html
    showIn: [station, teacher-only]
`

const BROWSER_LAB = `
name: Simulation
modules:
  - url: https://edrys-labs.github.io/module-avr8js/index.html
    showInCustom: Room 1
    stationConfig: { content: "" }
`

describe('lab files in a repo tree', () => {
  test('yaml and json files, without tooling and dot folders', () => {
    const paths = [
      '/lab.yaml',
      '/labs/a.yml',
      '/.github/workflows/deploy.yml',
      '/docker-compose.yml',
      '/package.json',
      '/package-lock.json',
      '/tsconfig.json',
      '/README.md',
    ]
    expect(labFiles(paths)).toEqual(['lab.yaml', 'labs/a.yml'])
  })

  test('a yaml file wins over the json file of the same name', () => {
    const paths = ['laboratory/c.json', 'laboratory/c.yaml', 'laboratory/d.json']
    expect(labFiles(paths)).toEqual(['laboratory/c.yaml', 'laboratory/d.json'])
  })
})

describe('lab summary', () => {
  test('name, description, distinct module names, station', () => {
    const lab = summarize(STATION_LAB, file)!
    expect(lab.name).toBe('Arduino - Blink')
    expect(lab.description).toBe('Blink a LED')
    expect(lab.modules).toEqual(['Markdown', 'Editor', 'Terminal'])
    expect(lab.station).toBe(true)
    expect(lab.raw).toBe(file.raw)
  })

  test('a station config alone does not make it a station lab', () => {
    expect(summarize(BROWSER_LAB, file)!.station).toBe(false)
  })

  test('files without modules are not labs', () => {
    expect(summarize('services:\n  web:\n    image: x\n', file)).toBeUndefined()
    expect(summarize('name: x\nmodules: []\n', file)).toBeUndefined()
    expect(summarize('{{{ not yaml', file)).toBeUndefined()
  })

  test('a lab without a name is called after its file', () => {
    expect(summarize(BROWSER_LAB.replace('name: Simulation', ''), file)!.name).toBe('lab.yml')
  })
})

describe('names', () => {
  test('module names from their URL', () => {
    expect(moduleLabel('https://edrys-labs.github.io/module-streaming/index.html')).toBe('Camera')
    expect(moduleLabel('https://example.org/module-my-thing/')).toBe('My thing')
    expect(moduleLabel('not a url')).toBe('')
  })

  test('repo titles and initials', () => {
    expect(repoTitle('lab-linux-programming')).toBe('Linux programming')
    expect(repoTitle('edrys-exercises')).toBe('Edrys exercises')
    expect(repoTitle('lab-stm32')).toBe('STM32')
    expect(repoInitials('Linux programming')).toBe('LP')
    expect(repoInitials('STM32')).toBe('ST')
    expect(repoInitials('ROS 2')).toBe('R2')
  })
})

test('groups that run in the browser come first, empty groups go', () => {
  const group = (title: string, station: boolean[]): LabGroup => ({
    repo: title,
    title,
    html: '',
    labs: station.map((s) => ({ ...file, name: title, description: '', modules: [], station: s })),
  })
  const sorted = sortGroups([group('B', [true]), group('C', []), group('Z', [false, true]), group('A', [true])])
  expect(sorted.map((g) => g.title)).toEqual(['Z', 'A', 'B'])
})

describe('loading', () => {
  const repos = [
    { name: 'lab-one', default_branch: 'main', html_url: 'https://github.com/edrys-labs/lab-one' },
    { name: 'lab-two', default_branch: 'main', html_url: 'https://github.com/edrys-labs/lab-two' },
  ]

  function fakeFetch(failing: string[] = []) {
    const calls: string[] = []
    const fetcher = (async (url: string) => {
      calls.push(url)
      const ok = (body: any) => ({ ok: true, json: async () => body, text: async () => body })
      if (failing.some((f) => url.includes(f))) return { ok: false, status: 403 }
      if (url.includes('/search/')) return ok({ items: repos })
      if (url.includes('/git/trees/')) return ok({ tree: [{ path: 'lab.yml', type: 'blob' }, { path: 'labs', type: 'tree' }] })
      if (url.includes('data.jsdelivr.com')) return ok({ files: [{ name: '/lab.yml' }, { name: '/docker-compose.yml' }] })
      if (url.includes('lab-one')) return ok(STATION_LAB)
      return ok(BROWSER_LAB)
    }) as any
    return { fetcher, calls }
  }

  beforeEach(() => localStorage.clear())

  test('groups per repo, cached for the next time', async () => {
    const { fetcher, calls } = fakeFetch()
    const groups = await loadLabs({ fetcher })
    expect(groups.map((g) => g.repo)).toEqual(['lab-two', 'lab-one'])
    expect(groups[1].labs[0].raw).toBe('https://raw.githubusercontent.com/edrys-labs/lab-one/main/lab.yml')
    expect(groups[1].labs[0].html).toBe('https://github.com/edrys-labs/lab-one/blob/main/lab.yml')
    expect(calls.some((c) => c.includes('docker-compose'))).toBe(false)
    // only the search uses the GitHub API and its limit
    expect(calls.filter((c) => c.includes('api.github.com'))).toHaveLength(1)

    const again = fakeFetch()
    expect(await loadLabs({ fetcher: again.fetcher })).toEqual(groups)
    expect(again.calls).toEqual([])
  })

  test('a repo jsDelivr refuses (over 50 MB) is listed through the GitHub API', async () => {
    const { fetcher, calls } = fakeFetch(['gh/edrys-labs/lab-one@'])
    const groups = await loadLabs({ fetcher })
    expect(groups.map((g) => g.repo)).toEqual(['lab-two', 'lab-one'])
    expect(groups[1].labs.map((l) => l.path)).toEqual(['lab.yml'])
    expect(calls.filter((c) => c.includes('/git/trees/'))).toEqual([
      'https://api.github.com/repos/edrys-labs/lab-one/git/trees/main?recursive=1',
    ])
  })

  test('a repo that fails is left out and nothing is cached', async () => {
    const groups = await loadLabs({ fetcher: fakeFetch(['gh/edrys-labs/lab-one@', 'repos/edrys-labs/lab-one/']).fetcher })
    expect(groups.map((g) => g.repo)).toEqual(['lab-two'])
    expect(localStorage.getItem('edrys-labs')).toBeNull()
  })

  test('a failed search throws', async () => {
    await expect(loadLabs({ fetcher: fakeFetch(['/search/']).fetcher })).rejects.toThrow()
  })

  test('a lab is fetched without members or identity', async () => {
    const lab = summarize(STATION_LAB, { ...file, raw: 'https://raw/lab-one/lab.yml' })!
    const data = await fetchLab(lab, fakeFetch().fetcher)
    expect(data.name).toBe('Arduino - Blink')
    expect(data.members).toEqual({ teacher: [], student: [] })
    expect(data.createdBy).toBeUndefined()
  })
})
