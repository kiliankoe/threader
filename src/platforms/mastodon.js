import { buildMainlineThread } from "../core/threadBuilder.js";

const INITIAL_PARENT_LOOKUPS = 12;
const INITIAL_CONTEXT_EXPANSION_REQUESTS = 3;
const CONTINUE_CONTEXT_EXPANSION_REQUESTS = 3;
const REQUEST_GAP_MS = 180;
const RESPONSE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 60 * 1000;

const inFlightJsonByEndpoint = new Map();
const responseCacheByEndpoint = new Map();
const hostRequestChains = new Map();
const hostLastRequestAt = new Map();

class FetchError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status) {
    super(message);
    this.name = "FetchError";
    this.status = status;
  }
}

class RateLimitError extends FetchError {
  /**
   * @param {string} message
   * @param {number} status
   * @param {number} retryAfterMs
   */
  constructor(message, status, retryAfterMs) {
    super(message, status);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * @param {number} ms
 */
function delay(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

/**
 * @param {string | null} value
 */
function parseRetryAfterMs(value) {
  if (!value) {
    return 2_000;
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.round(asNumber * 1000)));
  }

  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, asDate - Date.now()));
  }

  return 2_000;
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneJson(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * @template T
 * @param {string} endpoint
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function runWithHostThrottle(endpoint, task) {
  const host = new URL(endpoint).host;
  const previous = hostRequestChains.get(host) || Promise.resolve();

  const next = previous.catch(() => {}).then(async () => {
    const now = Date.now();
    const lastAt = hostLastRequestAt.get(host) || 0;
    const waitMs = REQUEST_GAP_MS - (now - lastAt);
    if (waitMs > 0) {
      await delay(waitMs);
    }
    hostLastRequestAt.set(host, Date.now());
    return task();
  });

  const settled = next.finally(() => {
    if (hostRequestChains.get(host) === settled) {
      hostRequestChains.delete(host);
    }
  });

  hostRequestChains.set(host, settled);
  return settled;
}

/**
 * @param {string} inputUrl
 */
function parseMastodonStatusUrl(inputUrl) {
  const url = new URL(inputUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL must start with http:// or https://");
  }

  const path = url.pathname.replace(/\/+$/, "");
  const looksLikeStatusPath =
    path.includes("/@") ||
    path.includes("/statuses/") ||
    /\/@[^/]+\/\d+$/.test(path);

  if (!looksLikeStatusPath) {
    throw new Error("That URL does not look like a Mastodon status.");
  }

  const idMatch = path.match(/\/(\d+)$/);
  const statusId = idMatch ? idMatch[1] : null;

  if (!statusId) {
    throw new Error("Could not find a status id in that URL.");
  }

  return {
    instance: url.hostname,
    statusId,
    canonicalUrl: `https://${url.hostname}${path}`,
  };
}

/**
 * @param {string} endpoint
 */
async function fetchJson(endpoint) {
  const cached = responseCacheByEndpoint.get(endpoint);
  if (cached && Date.now() - cached.cachedAt <= RESPONSE_CACHE_TTL_MS) {
    return cloneJson(cached.value);
  }

  const inFlight = inFlightJsonByEndpoint.get(endpoint);
  if (inFlight) {
    return cloneJson(await inFlight);
  }

  const requestPromise = runWithHostThrottle(endpoint, async () => {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
      },
      mode: "cors",
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.error ? ` ${body.error}` : "";
      } catch {
        detail = "";
      }

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        throw new RateLimitError(
          `Mastodon API is rate limiting requests. Retrying soon.${detail}`,
          response.status,
          retryAfterMs,
        );
      }

      throw new FetchError(
        `Mastodon API request failed (${response.status}).${detail}`,
        response.status,
      );
    }

    const json = await response.json();
    responseCacheByEndpoint.set(endpoint, {
      value: json,
      cachedAt: Date.now(),
    });
    return json;
  }).finally(() => {
    inFlightJsonByEndpoint.delete(endpoint);
  });

  inFlightJsonByEndpoint.set(endpoint, requestPromise);

  return cloneJson(await requestPromise);
}

/**
 * @param {any} card
 * @param {string} postId
 */
function linkEmbedsFromCard(card, postId) {
  if (!card || typeof card !== "object") {
    return [];
  }

  const url = typeof card.url === "string" ? card.url : "";
  if (!url) {
    return [];
  }

  const title = typeof card.title === "string" ? card.title : "";
  const description = typeof card.description === "string" ? card.description : "";
  const siteName =
    typeof card.provider_name === "string" ? card.provider_name : "";
  const imageUrl = typeof card.image === "string" && card.image ? card.image : null;

  if (!title && !description && !imageUrl) {
    return [];
  }

  return [
    {
      id: `${postId}-card`,
      url,
      title,
      description,
      siteName,
      imageUrl,
    },
  ];
}

/**
 * @param {any} raw
 * @param {string} instance
 */
function normalizeStatus(raw, instance) {
  const account = raw.account || {};
  const username = account.username || "unknown";
  return {
    id: String(raw.id),
    url: raw.url || `https://${instance}/@${username}/${raw.id}`,
    createdAt: raw.created_at,
    contentHtml: raw.content || "",
    spoilerText: raw.spoiler_text || "",
    sensitive: Boolean(raw.sensitive),
    inReplyToId: raw.in_reply_to_id ? String(raw.in_reply_to_id) : null,
    counts: {
      replies: Number(raw.replies_count || 0),
      boosts: Number(raw.reblogs_count || 0),
      favourites: Number(raw.favourites_count || 0),
    },
    account: {
      id: String(account.id || ""),
      username,
      acct: account.acct || username,
      displayName: account.display_name || username,
      url: account.url || `https://${instance}/@${username}`,
    },
    attachments: Array.isArray(raw.media_attachments)
      ? raw.media_attachments.map((attachment) => ({
          id: String(attachment.id || ""),
          type: attachment.type || "unknown",
          url: attachment.url || "",
          previewUrl: attachment.preview_url || null,
          description: attachment.description || "",
        }))
      : [],
    linkEmbeds: linkEmbedsFromCard(raw.card, String(raw.id || "")),
  };
}

function asTimestamp(value) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function compareByDate(a, b) {
  const delta = asTimestamp(a.createdAt) - asTimestamp(b.createdAt);
  if (delta !== 0) {
    return delta;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Fetch missing same-author ancestors by following in_reply_to_id chain.
 *
 * @param {{
 *   instance: string,
 *   authorId: string,
 *   posts: import('../core/types.js').ThreadPost[],
 *   seenIds: Set<string>
 * }} input
 */
async function extendAncestors(input) {
  const maxLookups = Number(input.maxLookups || INITIAL_PARENT_LOOKUPS);
  const posts = input.posts;
  let head = posts[0];
  let checks = 0;
  let rateLimitedUntil = 0;

  while (
    head &&
    head.inReplyToId &&
    !input.seenIds.has(head.inReplyToId) &&
    checks < maxLookups
  ) {
    checks += 1;
    const endpoint = `https://${input.instance}/api/v1/statuses/${head.inReplyToId}`;

    try {
      const raw = await fetchJson(endpoint);
      const parent = normalizeStatus(raw, input.instance);
      if (parent.account.id !== input.authorId) {
        break;
      }

      posts.unshift(parent);
      input.seenIds.add(parent.id);
      head = parent;
    } catch (error) {
      if (error instanceof RateLimitError) {
        rateLimitedUntil = Date.now() + error.retryAfterMs;
      }
      break;
    }
  }

  return {
    rateLimitedUntil,
  };
}

/**
 * Expand same-author descendants past context cutoffs by walking contexts
 * from the current tail post.
 *
 * @param {{
 *   instance: string,
 *   authorId: string,
 *   posts: import('../core/types.js').ThreadPost[],
 *   seenIds: Set<string>
 * }} input
 */
async function extendDescendants(input) {
  const maxRequests = Number(
    input.maxContextRequests || CONTINUE_CONTEXT_EXPANSION_REQUESTS,
  );

  let hasAlternateBranches = false;
  let tail = input.posts[input.posts.length - 1];
  let addedCount = 0;
  let rateLimitedUntil = 0;
  let requests = 0;
  let hasMore = true;

  if (!tail) {
    return {
      addedCount,
      hasAlternateBranches,
      hasMore: false,
      rateLimitedUntil,
    };
  }

  while (tail && requests < maxRequests) {
    requests += 1;
    let contextRaw;
    try {
      contextRaw = await fetchJson(
        `https://${input.instance}/api/v1/statuses/${tail.id}/context`,
      );
    } catch (error) {
      if (error instanceof RateLimitError) {
        rateLimitedUntil = Date.now() + error.retryAfterMs;
        hasMore = true;
      } else {
        hasMore = false;
      }
      break;
    }

    const sameAuthorDescendants = (contextRaw.descendants || [])
      .map((status) => normalizeStatus(status, input.instance))
      .filter((status) => status.account.id === input.authorId);

    if (sameAuthorDescendants.length === 0) {
      hasMore = false;
      break;
    }

    /** @type {Map<string, import('../core/types.js').ThreadPost[]>} */
    const childrenByParent = new Map();
    for (const status of sameAuthorDescendants) {
      if (!status.inReplyToId) {
        continue;
      }
      const bucket = childrenByParent.get(status.inReplyToId) || [];
      bucket.push(status);
      childrenByParent.set(status.inReplyToId, bucket);
    }

    for (const children of childrenByParent.values()) {
      children.sort(compareByDate);
      if (children.length > 1) {
        hasAlternateBranches = true;
      }
    }

    let progressed = false;
    while (true) {
      const candidates = (childrenByParent.get(tail.id) || []).filter(
        (status) => !input.seenIds.has(status.id),
      );

      if (candidates.length === 0) {
        break;
      }

      const next = candidates[0];
      input.posts.push(next);
      input.seenIds.add(next.id);
      tail = next;
      addedCount += 1;
      progressed = true;
    }

    if (!progressed) {
      hasMore = false;
      break;
    }
  }

  if (requests >= maxRequests && hasMore !== false) {
    hasMore = true;
  }

  return {
    addedCount,
    hasAlternateBranches,
    hasMore,
    rateLimitedUntil,
  };
}

/**
 * @param {{
 *  parsed: { instance: string, canonicalUrl: string },
 *  seedPost: import('../core/types.js').ThreadPost,
 *  posts: import('../core/types.js').ThreadPost[],
 *  hasAlternateBranches: boolean
 * }} input
 */
function buildThreadResult(input) {
  return {
    platform: "mastodon",
    instance: input.parsed.instance,
    seedPostId: input.seedPost.id,
    sourceUrl: input.parsed.canonicalUrl,
    fetchedAt: new Date().toISOString(),
    hasAlternateBranches: input.hasAlternateBranches,
    posts: input.posts,
    author: input.seedPost.account,
  };
}

/**
 * @type {{
 * canHandleUrl: (inputUrl: string) => boolean,
 * parseUrl: (inputUrl: string) => { instance: string, statusId: string, canonicalUrl: string },
 * fetchThread: (inputUrl: string, options?: { initialContextRequests?: number, maxParentLookups?: number }) => Promise<{ thread: import('../core/types.js').Thread, hasMore: boolean, addedCount: number, rateLimitedUntil: number }>,
 * continueThread: (thread: import('../core/types.js').Thread, options?: { maxContextRequests?: number }) => Promise<{ thread: import('../core/types.js').Thread, hasMore: boolean, addedCount: number, rateLimitedUntil: number }>
 * }}
 */
export const mastodonAdapter = {
  canHandleUrl(inputUrl) {
    const parsed = parseMastodonStatusUrl(inputUrl);
    return Boolean(parsed.instance && parsed.statusId);
  },

  parseUrl(inputUrl) {
    return parseMastodonStatusUrl(inputUrl);
  },

  async fetchThread(inputUrl, options = {}) {
    const parsed = parseMastodonStatusUrl(inputUrl);
    const base = `https://${parsed.instance}/api/v1/statuses/${parsed.statusId}`;

    const [seedRaw, contextRaw] = await Promise.all([
      fetchJson(base),
      fetchJson(`${base}/context`),
    ]);

    const seedPost = normalizeStatus(seedRaw, parsed.instance);
    const authorId = seedPost.account.id;

    const ancestors = (contextRaw.ancestors || [])
      .map((status) => normalizeStatus(status, parsed.instance))
      .filter((status) => status.account.id === authorId);

    const descendants = (contextRaw.descendants || [])
      .map((status) => normalizeStatus(status, parsed.instance))
      .filter((status) => status.account.id === authorId);

    const built = buildMainlineThread({
      seedPost,
      ancestors,
      descendants,
    });

    const posts = [...built.posts];
    const seenIds = new Set(posts.map((post) => post.id));
    let hasAlternateBranches = built.hasAlternateBranches;

    const ancestorResult = await extendAncestors({
      instance: parsed.instance,
      authorId,
      posts,
      seenIds,
      maxLookups: options.maxParentLookups || INITIAL_PARENT_LOOKUPS,
    });

    const descendantResult = await extendDescendants({
      instance: parsed.instance,
      authorId,
      posts,
      seenIds,
      maxContextRequests:
        options.initialContextRequests || INITIAL_CONTEXT_EXPANSION_REQUESTS,
    });

    hasAlternateBranches =
      hasAlternateBranches || descendantResult.hasAlternateBranches;

    const thread = buildThreadResult({
      parsed,
      seedPost,
      posts,
      hasAlternateBranches,
    });

    return {
      thread,
      hasMore: descendantResult.hasMore,
      addedCount: descendantResult.addedCount,
      rateLimitedUntil: Math.max(
        ancestorResult.rateLimitedUntil,
        descendantResult.rateLimitedUntil,
      ),
    };
  },

  async continueThread(thread, options = {}) {
    if (!thread || thread.platform !== "mastodon" || !Array.isArray(thread.posts)) {
      throw new Error("Cannot continue thread: invalid thread payload.");
    }

    if (!thread.posts.length) {
      return {
        thread,
        hasMore: false,
        addedCount: 0,
        rateLimitedUntil: 0,
      };
    }

    const posts = [...thread.posts];
    const seenIds = new Set(posts.map((post) => post.id));
    const authorId = thread.author?.id || posts[0].account.id;

    const descendantResult = await extendDescendants({
      instance: thread.instance,
      authorId,
      posts,
      seenIds,
      maxContextRequests:
        options.maxContextRequests || CONTINUE_CONTEXT_EXPANSION_REQUESTS,
    });

    const nextThread = {
      ...thread,
      fetchedAt: new Date().toISOString(),
      hasAlternateBranches:
        thread.hasAlternateBranches || descendantResult.hasAlternateBranches,
      posts,
    };

    return {
      thread: nextThread,
      hasMore: descendantResult.hasMore,
      addedCount: descendantResult.addedCount,
      rateLimitedUntil: descendantResult.rateLimitedUntil,
    };
  },
};

export { FetchError, RateLimitError };
