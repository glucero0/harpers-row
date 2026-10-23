// The master config lists every location the game can offer. It is plain data read once at startup.
// Pure logic only (no THREE, no DOM), so it is fully unit-testable.
//
// The file is served from the game's own origin, but it is still treated as untrusted input: it is
// size-capped, parsed with JSON.parse only, and every entry must be a bare `.json` file name. Paths,
// URLs and anything else are dropped, so a config can never point the game at another origin or
// another directory.

export const MASTER_CONFIG_URL = 'master_config.json';

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_LOCATIONS = 100;
// A bare file name: letters, digits, `_`, `-` and inner dots, ending in `.json`. No slashes, no `..`.
const LOCATION_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.json$/;
const MAX_NAME_LENGTH = 64;

export class MasterConfigError extends Error {
  constructor(message) {
    // Messages can end up on screen, so keep them short.
    super(String(message).slice(0, 200));
    this.name = 'MasterConfigError';
  }
}

export function isLocationFileName(value) {
  return typeof value === 'string' && value.length <= MAX_NAME_LENGTH && LOCATION_FILE.test(value);
}

// Turns parsed JSON into `{ hubLocation, locations, rejected }`.
// - `hubLocation` is the central hub's file name (where the player starts and respawns), or null when
//   the config does not name one. A hub that is named but is not a bare `.json` file name is an error,
//   not something to quietly skip: the player's spawn point depends on it.
// - `locations` is a frozen array of unique, valid file names in file order.
// - `rejected` counts the `locations` entries that were dropped.
export function parseMasterConfig(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new MasterConfigError('The master config must be a JSON object.');
  }
  let hubLocation = null;
  if (Object.hasOwn(data, 'hubLocation')) {
    if (!isLocationFileName(data.hubLocation)) {
      throw new MasterConfigError('The master config "hubLocation" must be a plain .json file name.');
    }
    hubLocation = data.hubLocation;
  }
  if (!Array.isArray(data.locations)) {
    throw new MasterConfigError('The master config needs a "locations" array.');
  }
  const seen = new Set();
  let rejected = 0;
  // Only the first MAX_LOCATIONS entries are looked at, so a huge array cannot make us walk millions.
  if (data.locations.length > MAX_LOCATIONS) rejected += data.locations.length - MAX_LOCATIONS;
  for (const entry of data.locations.slice(0, MAX_LOCATIONS)) {
    if (isLocationFileName(entry) && !seen.has(entry)) seen.add(entry);
    else rejected += 1;
  }
  return { hubLocation, locations: Object.freeze([...seen]), rejected };
}

// Fetches and validates the master config. `fetchImpl` is injectable for tests.
export async function loadMasterConfig(url = MASTER_CONFIG_URL, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new MasterConfigError('This browser cannot load the master config.');
  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-cache', credentials: 'same-origin' });
  } catch {
    throw new MasterConfigError('The master config could not be reached.');
  }
  if (!response || !response.ok) throw new MasterConfigError('The master config could not be loaded.');
  const text = await response.text();
  if (text.length > MAX_CONFIG_BYTES) throw new MasterConfigError('The master config is too large.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new MasterConfigError('The master config is not valid JSON.');
  }
  return parseMasterConfig(data);
}
