import { test, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import LabsExplorer from '../../../src/components/LabsExplorer.vue';
import { loadLabs, fetchLab, type Lab, type LabGroup } from '../../../src/ts/Labs';

vi.mock('../../../src/ts/Labs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/ts/Labs')>()),
  loadLabs: vi.fn(),
  fetchLab: vi.fn(),
}));

const lab = (repo: string, name: string, more: Partial<Lab> = {}): Lab => ({
  repo,
  path: name.toLowerCase().replace(/\s+/g, '-') + '.yml',
  name,
  description: '',
  modules: [],
  station: false,
  raw: `https://raw.example/${repo}/${name}.yml`,
  html: `https://github.example/${repo}`,
  ...more,
});

const group = (title: string, labs?: Lab[]): LabGroup => {
  const repo = 'lab-' + title.toLowerCase().replace(/\s+/g, '-');
  return { repo, title, html: `https://github.example/${repo}`, labs: labs ?? [lab(repo, title)] };
};

// labs to search and filter in: one per kind, in two repos
const GROUPS = [
  group('Arduino', [
    lab('lab-arduino', 'Blink simulator', { description: 'An LED in the browser', modules: ['avr8js'] }),
    lab('lab-arduino', 'Remote Uno', { description: 'A real board', modules: ['terminal', 'camera'], station: true }),
  ]),
  group('Calliope', [lab('lab-calliope', 'Calliope mini', { modules: ['micropython'], station: true })]),
];

const CLASSROOM = { name: 'From the lab', meta: {}, modules: [] };

const mountExplorer = (mode: 'start' | 'settings') =>
  mount(LabsExplorer, {
    props: { mode },
    global: { stubs: { 'v-dialog': { template: '<div><slot /></div>' } } },
  });

/** The explorer with the labs loaded; on the start page already past the first choice. */
async function opened(mode: 'start' | 'settings', groups = GROUPS) {
  vi.mocked(loadLabs).mockReset().mockResolvedValue(groups);
  vi.mocked(fetchLab).mockReset().mockResolvedValue(CLASSROOM as any);
  const wrapper = mountExplorer(mode);
  await flushPromises();
  if (mode === 'start') {
    await wrapper.find('.choice:not(.choice--empty)').trigger('click');
    await flushPromises();
  }
  return wrapper;
}

const labNames = (wrapper: any) => wrapper.findAll('.lab-name').map((name: any) => name.text());
const labRow = (wrapper: any, name: string) =>
  wrapper.findAll('.lab').find((row: any) => row.find('.lab-name').text() === name)!;

/** Runs `body` with console.error silenced: the component logs what fails. */
async function quietly(body: () => Promise<void>) {
  const log = console.error;
  console.error = () => {};
  try {
    await body();
  } finally {
    console.error = log;
  }
}

test('the lab card keeps room for its tiles while the labs load, then shows them', async () => {
  let done: (groups: LabGroup[]) => void = () => {};
  vi.mocked(loadLabs).mockReset().mockImplementation(() => new Promise((resolve) => (done = resolve)));
  const wrapper = mountExplorer('start');
  await flushPromises();

  const loading = wrapper.findAll('.choice-tiles--loading span');
  expect(loading).toHaveLength(4);
  expect(loading.every((tile) => tile.text() === '')).toBe(true);

  done(['Arduino Simulator', 'Arduino Avr', 'Arduino Blink', 'Arduino Remote', 'More'].map((t) => group(t)));
  await flushPromises();
  expect(wrapper.find('.choice-tiles--loading').exists()).toBe(false);
  expect(wrapper.findAll('.choice-tiles span').map((tile) => tile.text())).toEqual(['AS', 'AA', 'AB', 'AR']);
});

test('without labs (they could not be loaded) the card has no tile row', async () => {
  vi.mocked(loadLabs).mockReset().mockImplementation(async () => {
    throw new Error('offline');
  });
  await quietly(async () => {
    const wrapper = mountExplorer('start');
    await flushPromises();
    expect(wrapper.find('.choice-tiles').exists()).toBe(false);
  });
});

test('in Settings, Use asks first: Replace hands over the lab, Cancel changes nothing', async () => {
  const wrapper = await opened('settings');
  const row = () => labRow(wrapper, 'Remote Uno');

  await row().find('button[aria-label="Use: Remote Uno"]').trigger('click');
  expect(row().find('[role=alertdialog]').exists()).toBe(true);
  expect(fetchLab).not.toHaveBeenCalled();

  await row().findAll('[role=alertdialog] button').find((b: any) => b.text() === 'Cancel')!.trigger('click');
  expect(row().find('[role=alertdialog]').exists()).toBe(false);
  expect(fetchLab).not.toHaveBeenCalled();
  expect(wrapper.emitted('use')).toBeUndefined();

  await row().find('button[aria-label="Use: Remote Uno"]').trigger('click');
  await row().findAll('[role=alertdialog] button').find((b: any) => b.text() === 'Replace')!.trigger('click');
  await flushPromises();
  expect(vi.mocked(fetchLab).mock.calls[0][0].name).toBe('Remote Uno');
  expect(wrapper.emitted('use')).toEqual([[CLASSROOM]]);
  expect(wrapper.emitted('close')).toHaveLength(1);
});

test('on the start page a lab creates the class at once, and Empty class one without a lab', async () => {
  const wrapper = await opened('start');
  await labRow(wrapper, 'Blink simulator').find('button[aria-label="Create a class from Blink simulator"]').trigger('click');
  await flushPromises();
  expect(wrapper.find('[role=alertdialog]').exists()).toBe(false);
  expect(wrapper.emitted('create')).toEqual([[CLASSROOM]]);
  expect(wrapper.emitted('close')).toHaveLength(1);

  vi.mocked(loadLabs).mockResolvedValue(GROUPS);
  const empty = mountExplorer('start');
  await flushPromises();
  await empty.find('.choice--empty').trigger('click');
  expect(empty.emitted('create')).toEqual([[null]]);
  expect(empty.emitted('close')).toHaveLength(1);
});

test('a lab that cannot be downloaded is marked, the dialog stays, and trying again clears the mark', async () => {
  const wrapper = await opened('start');
  vi.mocked(fetchLab).mockRejectedValueOnce(new Error('404'));
  const button = () => labRow(wrapper, 'Calliope mini').find('button[aria-label="Create a class from Calliope mini"]');

  await quietly(async () => {
    await button().trigger('click');
    await flushPromises();
  });
  expect(labRow(wrapper, 'Calliope mini').find('.lab-failed').exists()).toBe(true);
  expect(wrapper.emitted('create')).toBeUndefined();
  expect(wrapper.emitted('close')).toBeUndefined();

  await button().trigger('click');
  await flushPromises();
  expect(wrapper.find('.lab-failed').exists()).toBe(false);
  expect(wrapper.emitted('create')).toEqual([[CLASSROOM]]);
});

test('search looks in names, descriptions and modules; the filter keeps labs with or without a station', async () => {
  const wrapper = await opened('settings');
  const search = wrapper.find('input[type=search]');
  expect(labNames(wrapper)).toEqual(['Blink simulator', 'Remote Uno', 'Calliope mini']);

  await search.setValue('real board'); // description
  expect(labNames(wrapper)).toEqual(['Remote Uno']);
  await search.setValue('MICROPYTHON'); // module, any case
  expect(labNames(wrapper)).toEqual(['Calliope mini']);
  await search.setValue('arduino camera'); // every word, across repo and modules
  expect(labNames(wrapper)).toEqual(['Remote Uno']);
  await search.setValue('nothing like this');
  expect(labNames(wrapper)).toEqual([]);
  expect(wrapper.find('.no-match').exists()).toBe(true);

  await search.setValue('');
  await wrapper.find('input[name=labs-filter][value=browser]').setValue(true);
  expect(labNames(wrapper)).toEqual(['Blink simulator']);
  await wrapper.find('input[name=labs-filter][value=station]').setValue(true);
  expect(labNames(wrapper)).toEqual(['Remote Uno', 'Calliope mini']);
  // a repo with nothing left in it is not listed
  expect(wrapper.findAll('.lab-group h3').map((h) => h.text())).toEqual(['Arduino', 'Calliope']);
  await search.setValue('calliope');
  expect(wrapper.findAll('.lab-group h3').map((h) => h.text())).toEqual(['Calliope']);
});

test("a repo keeps its tile color when a search hides the repos before it", async () => {
  const wrapper = await opened('settings');
  const colors = (tile: any) => {
    const { background, color } = (tile.element as HTMLElement).style;
    return { background, color };
  };
  const calliopeTile = () =>
    colors(wrapper.findAll('.lab-group').find((g) => g.find('h3').text() === 'Calliope')!.find('.repo-tile'));
  const before = calliopeTile();
  expect(before).not.toEqual(colors(wrapper.find('.lab-group .repo-tile'))); // Arduino's

  await wrapper.find('input[type=search]').setValue('calliope');
  expect(calliopeTile()).toEqual(before);
});

test('when the labs cannot be loaded, Try again loads them fresh, not from the cache', async () => {
  vi.mocked(loadLabs).mockReset().mockRejectedValueOnce(new Error('rate limit')).mockResolvedValue(GROUPS);
  await quietly(async () => {
    const wrapper = mountExplorer('settings');
    await flushPromises();
    expect(wrapper.find('.labs-error').exists()).toBe(true);
    expect(vi.mocked(loadLabs).mock.calls[0][0]).toEqual({ fresh: false });

    await wrapper.findAll('.labs-error button').find((b) => b.text() === 'Try again')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(loadLabs).mock.calls[1][0]).toEqual({ fresh: true });
    expect(wrapper.find('.labs-error').exists()).toBe(false);
    expect(labNames(wrapper)).toEqual(['Blink simulator', 'Remote Uno', 'Calliope mini']);
  });
});
