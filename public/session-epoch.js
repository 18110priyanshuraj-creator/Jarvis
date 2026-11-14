/**
 * Tracks authentication generations in the browser.
 *
 * Requests capture the current generation when they start. Once login/logout
 * advances it, late responses from the previous state must not change the UI.
 */
export function createSessionEpoch() {
  let generation = 0;

  return {
    capture() {
      return generation;
    },
    advance() {
      generation += 1;
      return generation;
    },
    isCurrent(candidate) {
      return candidate === generation;
    },
    runIfCurrent(candidate, action) {
      if (candidate !== generation) return false;
      action();
      return true;
    }
  };
}
