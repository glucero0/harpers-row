// Game-wide state that outlives a single run: what the master config offers (the central hub and the
// list of locations). A small factory with private state, like the rest of the codebase. It owns no GPU
// resources and no listeners, so there is nothing to dispose.

export function createGameState() {
  let locations = Object.freeze([]);
  let hubLocation = null;
  // 'idle' until a load starts, then 'loading', and finally 'ready' or 'failed'.
  let status = 'idle';
  let error = null;
  let rejected = 0;
  let spokes = Object.freeze([]);
  let worldError = null;

  return {
    // Read-only views: callers cannot change the values behind the state's back.
    get locations() {
      return locations;
    },
    // File name of the central hub, where the player starts and comes back after dying. Null when the
    // config names none.
    get hubLocation() {
      return hubLocation;
    },
    get masterConfigStatus() {
      return status;
    },
    get masterConfigError() {
      return error;
    },
    get rejectedLocations() {
      return rejected;
    },
    // Which hub path leads to which location file, once the two lists have been checked and joined.
    get spokes() {
      return spokes;
    },
    get worldError() {
      return worldError;
    },
    beginMasterConfigLoad() {
      status = 'loading';
      error = null;
    },
    // Takes the result of `parseMasterConfig`.
    setMasterConfig(config) {
      locations = Object.freeze([...config.locations]);
      hubLocation = config.hubLocation ?? null;
      rejected = config.rejected ?? 0;
      status = 'ready';
      error = null;
    },
    setSpokes(list) {
      spokes = Object.freeze(list.map((item) => Object.freeze({
        name: String(item.name),
        location: String(item.location),
      })));
      worldError = null;
    },
    setWorldError(message) {
      spokes = Object.freeze([]);
      worldError = String(message);
    },
    failMasterConfig(message) {
      locations = Object.freeze([]);
      hubLocation = null;
      rejected = 0;
      spokes = Object.freeze([]);
      worldError = null;
      status = 'failed';
      error = String(message);
    },
  };
}
