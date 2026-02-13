import { mastodonAdapter } from "./mastodon.js";

const adapters = [mastodonAdapter];

/**
 * @param {string} inputUrl
 */
export function getAdapterForUrl(inputUrl) {
  for (const adapter of adapters) {
    try {
      if (adapter.canHandleUrl(inputUrl)) {
        return adapter;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export { adapters };
