import { describe, expect, it, vi } from 'vitest';
import { createGameState } from './game-state.js';
import {
  isLocationFileName,
  loadMasterConfig,
  MasterConfigError,
  parseMasterConfig,
} from './master-config.js';
import shipped from '../public/master_config.json';

const respond = (body, ok = true) => vi.fn(async () => ({ ok, text: async () => body }));

describe('the shipped master_config.json', () => {
  it('names the hub and lists valid locations', () => {
    const { hubLocation, locations, rejected } = parseMasterConfig(shipped);
    expect(hubLocation).toBe('campfireHub.json');
    expect(locations).toEqual(['smRuins.json', 'lgRuins.json', 'medRuins.json']);
    expect(rejected).toBe(0);
  });
});

describe('hubLocation', () => {
  it('is read when valid', () => {
    expect(parseMasterConfig({ hubLocation: 'hub-castle.json', locations: [] }).hubLocation).toBe('hub-castle.json');
  });

  it('is null when the config does not name one', () => {
    expect(parseMasterConfig({ locations: ['a.json'] }).hubLocation).toBeNull();
  });

  it('is an error when named but not a plain .json file name', () => {
    const bad = ['../hub.json', 'https://example.com/hub.json', 'hub.js', '', null, 5, ['hub.json'], {}];
    for (const hubLocation of bad) {
      expect(() => parseMasterConfig({ hubLocation, locations: [] })).toThrow(MasterConfigError);
    }
  });

  it('ignores a hub name that is only inherited, not set in the file', () => {
    const data = Object.create({ hubLocation: 'evil.json' });
    data.locations = [];
    expect(parseMasterConfig(data).hubLocation).toBeNull();
  });
});

describe('isLocationFileName', () => {
  it('accepts bare .json file names', () => {
    for (const name of ['dungeon1.json', 'seed3000.json', 'a-b_c.json', 'v1.2.json']) {
      expect(isLocationFileName(name)).toBe(true);
    }
  });

  it('rejects paths, URLs, other extensions, and non-strings', () => {
    const bad = [
      '../dungeon.json',
      'a/b.json',
      'a\\b.json',
      '/etc/passwd.json',
      'https://example.com/x.json',
      '//example.com/x.json',
      '..json',
      '.json',
      '.hidden.json',
      'a..json',
      'dungeon.js',
      'dungeon.json ',
      'dungeon.json\n',
      `${'a'.repeat(70)}.json`,
      '',
      7,
      null,
      undefined,
      {},
      ['dungeon1.json'],
    ];
    for (const name of bad) expect(isLocationFileName(name)).toBe(false);
  });
});

describe('parseMasterConfig', () => {
  it('keeps valid names in order, drops duplicates and bad entries, and counts them', () => {
    const result = parseMasterConfig({
      locations: ['b.json', 'a.json', 'b.json', '../x.json', 5, 'c.json'],
    });
    expect(result.locations).toEqual(['b.json', 'a.json', 'c.json']);
    expect(result.rejected).toBe(3);
  });

  it('returns a frozen list', () => {
    const { locations } = parseMasterConfig({ locations: ['a.json'] });
    expect(Object.isFrozen(locations)).toBe(true);
  });

  it('accepts an empty list', () => {
    expect(parseMasterConfig({ locations: [] }).locations).toEqual([]);
  });

  it('caps how many entries it reads', () => {
    const many = Array.from({ length: 500 }, (_, i) => `d${i}.json`);
    const result = parseMasterConfig({ locations: many });
    expect(result.locations).toHaveLength(100);
    expect(result.rejected).toBe(400);
  });

  it('throws MasterConfigError for the wrong shape', () => {
    for (const data of [null, [], 'text', 3, {}, { locations: 'a.json' }, { locations: {} }]) {
      expect(() => parseMasterConfig(data)).toThrow(MasterConfigError);
    }
  });

  it('is not fooled by a polluted prototype key', () => {
    const data = JSON.parse('{"__proto__": {"locations": ["x.json"]}}');
    expect(() => parseMasterConfig(data)).toThrow(MasterConfigError);
  });
});

describe('loadMasterConfig', () => {
  it('fetches the url from the same origin without caching and parses it', async () => {
    const fetchImpl = respond(JSON.stringify({ locations: ['dungeon1.json'] }));
    const result = await loadMasterConfig('master_config.json', fetchImpl);
    expect(result.locations).toEqual(['dungeon1.json']);
    expect(fetchImpl).toHaveBeenCalledWith('master_config.json', { cache: 'no-cache', credentials: 'same-origin' });
  });

  it('fails with short messages on network errors, bad status, bad JSON, and oversize bodies', async () => {
    const network = vi.fn(async () => {
      throw new TypeError('secret internal detail');
    });
    await expect(loadMasterConfig('x', network)).rejects.toThrow('could not be reached');
    await expect(loadMasterConfig('x', respond('{}', false))).rejects.toThrow('could not be loaded');
    await expect(loadMasterConfig('x', respond('<!doctype html>'))).rejects.toThrow('not valid JSON');
    await expect(loadMasterConfig('x', respond(' '.repeat(70 * 1024)))).rejects.toThrow('too large');
    await expect(loadMasterConfig('x', respond('{"locations": 4}'))).rejects.toThrow(MasterConfigError);
  });

  it('fails cleanly when fetch is unavailable', async () => {
    await expect(loadMasterConfig('x', undefined)).rejects.toThrow(MasterConfigError);
  });
});

describe('createGameState', () => {
  it('starts empty and idle', () => {
    const state = createGameState();
    expect(state.locations).toEqual([]);
    expect(state.hubLocation).toBeNull();
    expect(state.masterConfigStatus).toBe('idle');
    expect(state.masterConfigError).toBeNull();
  });

  it('stores the hub and a frozen copy of the loaded list', () => {
    const state = createGameState();
    state.beginMasterConfigLoad();
    expect(state.masterConfigStatus).toBe('loading');
    const source = ['a.json', 'b.json'];
    state.setMasterConfig({ hubLocation: 'hub.json', locations: source, rejected: 2 });
    source.push('c.json');
    expect(state.hubLocation).toBe('hub.json');
    expect(state.locations).toEqual(['a.json', 'b.json']);
    expect(Object.isFrozen(state.locations)).toBe(true);
    expect(state.rejectedLocations).toBe(2);
    expect(state.masterConfigStatus).toBe('ready');
    expect(() => {
      'use strict';
      state.locations.push('x.json');
    }).toThrow(TypeError);
  });

  it('has no setters on its public fields', () => {
    const state = createGameState();
    expect(() => {
      'use strict';
      state.locations = ['x.json'];
    }).toThrow(TypeError);
    expect(() => {
      'use strict';
      state.hubLocation = 'x.json';
    }).toThrow(TypeError);
  });

  it('records a failure and clears the hub and the list', () => {
    const state = createGameState();
    state.setMasterConfig({ hubLocation: 'hub.json', locations: ['a.json'], rejected: 0 });
    state.failMasterConfig('nope');
    expect(state.locations).toEqual([]);
    expect(state.hubLocation).toBeNull();
    expect(state.masterConfigStatus).toBe('failed');
    expect(state.masterConfigError).toBe('nope');
  });
});
