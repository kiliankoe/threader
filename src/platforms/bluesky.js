import { buildMainlineThread } from "../core/threadBuilder.js";

const APPVIEW_BASE = "https://public.api.bsky.app/xrpc";
const REQUEST_GAP_MS = 140;
const RESPONSE_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 60 * 1000;

const inFlightByUrl = new Map();
const responseCacheByUrl = new Map();
const hostRequestChains = new Map();
const hostLastRequestAt = new Map();

class BlueskyError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status) {
    super(message);
    this.name = "BlueskyError";
    this.status = status;
  }
}

class BlueskyRateLimitError extends BlueskyError {
  /**
   * @param {string} message
   * @param {number} status
   * @param {number} retryAfterMs
   */
  constructor(message, status, retryAfterMs) {
    super(message, status);
    this.name = "BlueskyRateLimitError";
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
 * @param {string} url
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function runWithHostThrottle(url, task) {
  const host = new URL(url).host;
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
 * @param {string} method
 * @param {Record<string, string | number>} params
 */
function xrpcUrl(method, params) {
  const url = new URL(`${APPVIEW_BASE}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * @param {string} method
 * @param {Record<string, string | number>} params
 */
async function fetchJson(method, params) {
  const url = xrpcUrl(method, params);
  const cached = responseCacheByUrl.get(url);
  if (cached && Date.now() - cached.cachedAt <= RESPONSE_CACHE_TTL_MS) {
    return cloneJson(cached.value);
  }

  const inFlight = inFlightByUrl.get(url);
  if (inFlight) {
    return cloneJson(await inFlight);
  }

  const requestPromise = runWithHostThrottle(url, async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      mode: "cors",
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.message ? ` ${body.message}` : "";
      } catch {
        detail = "";
      }

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        throw new BlueskyRateLimitError(
          `Bluesky API is rate limiting requests. Retrying soon.${detail}`,
          response.status,
          retryAfterMs,
        );
      }

      throw new BlueskyError(
        `Bluesky API request failed (${response.status}).${detail}`,
        response.status,
      );
    }

    const json = await response.json();
    responseCacheByUrl.set(url, {
      value: json,
      cachedAt: Date.now(),
    });
    return json;
  }).finally(() => {
    inFlightByUrl.delete(url);
  });

  inFlightByUrl.set(url, requestPromise);
  return cloneJson(await requestPromise);
}

/**
 * @param {string} inputUrl
 */
function parseBlueskyPostUrl(inputUrl) {
  const url = new URL(inputUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL must start with http:// or https://");
  }

  if (url.hostname !== "bsky.app" && url.hostname !== "www.bsky.app") {
    throw new Error("That URL does not look like a Bluesky post.");
  }

  const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
  if (!match) {
    throw new Error("Could not find actor and post id in that Bluesky URL.");
  }

  const actor = decodeURIComponent(match[1]);
  const rkey = decodeURIComponent(match[2]);

  return {
    actor,
    rkey,
    canonicalUrl: `https://bsky.app/profile/${actor}/post/${rkey}`,
  };
}

/**
 * @param {string} uri
 */
function postRkeyFromAtUri(uri) {
  const parts = String(uri || "").split("/");
  return parts[parts.length - 1] || "";
}

/**
 * @param {string} atUri
 * @param {string} actor
 */
function atUriToWebUrl(atUri, actor) {
  const rkey = postRkeyFromAtUri(atUri);
  return `https://bsky.app/profile/${actor}/post/${rkey}`;
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {string} value
 */
function escapeAndBreak(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

/**
 * @param {number} codePoint
 */
function utf8Length(codePoint) {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

/**
 * @param {string} text
 */
function buildByteBoundaries(text) {
  const boundaries = [{ byte: 0, codeUnit: 0 }];
  let byte = 0;

  for (let codeUnit = 0; codeUnit < text.length; ) {
    const codePoint = text.codePointAt(codeUnit);
    const charLength = codePoint > 0xffff ? 2 : 1;
    byte += utf8Length(codePoint || 0);
    codeUnit += charLength;
    boundaries.push({ byte, codeUnit });
  }

  return boundaries;
}

/**
 * @param {{ byte: number, codeUnit: number }[]} boundaries
 * @param {number} byteIndex
 */
function byteToCodeUnitIndex(boundaries, byteIndex) {
  if (!boundaries.length || byteIndex <= 0) {
    return 0;
  }

  const last = boundaries[boundaries.length - 1];
  if (byteIndex >= last.byte) {
    return last.codeUnit;
  }

  let low = 0;
  let high = boundaries.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = boundaries[mid];
    if (candidate.byte === byteIndex) {
      return candidate.codeUnit;
    }
    if (candidate.byte < byteIndex) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return boundaries[Math.max(0, low - 1)].codeUnit;
}

/**
 * @param {any[]} features
 */
function pickFacetFeature(features) {
  if (!Array.isArray(features) || features.length === 0) {
    return null;
  }

  const priority = [
    "app.bsky.richtext.facet#link",
    "app.bsky.richtext.facet#mention",
    "app.bsky.richtext.facet#tag",
  ];

  for (const type of priority) {
    const match = features.find((feature) => feature?.$type === type);
    if (match) {
      return match;
    }
  }

  return features[0];
}

/**
 * @param {string} segment
 * @param {any} feature
 */
function renderFacetSegment(segment, feature) {
  const label = escapeAndBreak(segment);
  if (!feature || typeof feature !== "object") {
    return label;
  }

  let href = "";
  if (feature.$type === "app.bsky.richtext.facet#link") {
    href = String(feature.uri || "");
  } else if (feature.$type === "app.bsky.richtext.facet#mention") {
    href = `https://bsky.app/profile/${feature.did || ""}`;
  } else if (feature.$type === "app.bsky.richtext.facet#tag") {
    const tag = feature.tag || segment.replace(/^#/, "");
    href = `https://bsky.app/hashtag/${encodeURIComponent(tag)}`;
  }

  if (!href) {
    return label;
  }

  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
}

/**
 * @param {any} record
 */
function richTextToHtml(record) {
  const text = String(record?.text || "");
  if (!text) {
    return "";
  }

  const facets = Array.isArray(record?.facets) ? record.facets : [];
  if (!facets.length) {
    return `<p>${escapeAndBreak(text)}</p>`;
  }

  const boundaries = buildByteBoundaries(text);
  const ranges = [];

  for (const facet of facets) {
    const index = facet?.index || {};
    const byteStart = Number(index.byteStart);
    const byteEnd = Number(index.byteEnd);
    if (!Number.isFinite(byteStart) || !Number.isFinite(byteEnd) || byteEnd <= byteStart) {
      continue;
    }

    const start = byteToCodeUnitIndex(boundaries, byteStart);
    const end = byteToCodeUnitIndex(boundaries, byteEnd);
    if (end <= start) {
      continue;
    }

    const feature = pickFacetFeature(facet.features);
    if (!feature) {
      continue;
    }

    ranges.push({ start, end, feature });
  }

  if (!ranges.length) {
    return `<p>${escapeAndBreak(text)}</p>`;
  }

  ranges.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return a.end - b.end;
  });

  const nonOverlapping = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }
    nonOverlapping.push(range);
    cursor = range.end;
  }

  let html = "";
  cursor = 0;
  for (const range of nonOverlapping) {
    html += escapeAndBreak(text.slice(cursor, range.start));
    html += renderFacetSegment(text.slice(range.start, range.end), range.feature);
    cursor = range.end;
  }
  html += escapeAndBreak(text.slice(cursor));

  return `<p>${html}</p>`;
}

/**
 * @param {any} embed
 * @param {string} postId
 */
function attachmentsFromEmbed(embed, postId) {
  if (!embed || typeof embed !== "object") {
    return [];
  }

  if (embed.$type === "app.bsky.embed.images#view") {
    const images = Array.isArray(embed.images) ? embed.images : [];
    return images
      .map((image, index) => ({
        id: `${postId}-img-${index + 1}`,
        type: "image",
        url: image?.fullsize || image?.thumb || "",
        previewUrl: image?.thumb || image?.fullsize || null,
        description: image?.alt || "",
      }))
      .filter((image) => Boolean(image.url || image.previewUrl));
  }

  if (embed.$type === "app.bsky.embed.video#view") {
    const mediaType = embed.presentation === "gifv" ? "gifv" : "video";
    const url = embed.playlist || "";
    const previewUrl = embed.thumbnail || null;
    if (!url && !previewUrl) {
      return [];
    }

    return [
      {
        id: `${postId}-video`,
        type: mediaType,
        url,
        previewUrl,
        description: "",
      },
    ];
  }

  if (embed.$type === "app.bsky.embed.recordWithMedia#view") {
    return attachmentsFromEmbed(embed.media, postId);
  }

  return [];
}

/**
 * @param {string} url
 */
function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * @param {any} embed
 * @param {string} postId
 */
function linkEmbedsFromEmbed(embed, postId) {
  if (!embed || typeof embed !== "object") {
    return [];
  }

  if (embed.$type === "app.bsky.embed.external#view") {
    const external = embed.external || {};
    const url = String(external.uri || "");
    if (!url) {
      return [];
    }

    const title = String(external.title || "");
    const description = String(external.description || "");
    const imageUrl =
      typeof external.thumb === "string" && external.thumb
        ? external.thumb
        : null;

    if (!title && !description && !imageUrl) {
      return [];
    }

    return [
      {
        id: `${postId}-external`,
        url,
        title,
        description,
        siteName: hostFromUrl(url),
        imageUrl,
      },
    ];
  }

  if (embed.$type === "app.bsky.embed.recordWithMedia#view") {
    return linkEmbedsFromEmbed(embed.media, postId);
  }

  return [];
}

/**
 * @param {any} post
 */
function normalizePost(post) {
  const author = post?.author || {};
  const handle = author.handle || author.did || "unknown.bsky.social";
  const id = String(post?.uri || "");

  return {
    id,
    url: atUriToWebUrl(id, handle),
    createdAt: post?.record?.createdAt || post?.indexedAt || new Date().toISOString(),
    contentHtml: richTextToHtml(post?.record || {}),
    spoilerText: "",
    sensitive: false,
    inReplyToId: post?.record?.reply?.parent?.uri || null,
    counts: {
      replies: Number(post?.replyCount || 0),
      boosts: Number(post?.repostCount || 0),
      favourites: Number(post?.likeCount || 0),
    },
    account: {
      id: String(author.did || ""),
      username: handle,
      acct: handle,
      displayName: author.displayName || handle,
      url: `https://bsky.app/profile/${handle}`,
    },
    attachments: attachmentsFromEmbed(post?.embed, id),
    linkEmbeds: linkEmbedsFromEmbed(post?.embed, id),
  };
}

/**
 * @param {any} node
 * @param {Map<string, any>} byUri
 */
function collectThreadPosts(node, byUri) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (node.$type === "app.bsky.feed.defs#threadViewPost") {
    const post = node.post;
    if (post?.uri && !byUri.has(post.uri)) {
      byUri.set(post.uri, post);
    }

    if (node.parent) {
      collectThreadPosts(node.parent, byUri);
    }

    if (Array.isArray(node.replies)) {
      for (const reply of node.replies) {
        collectThreadPosts(reply, byUri);
      }
    }
  }
}

/**
 * @param {import('../core/types.js').ThreadPost[]} posts
 */
function comparePostsByDate(posts) {
  return [...posts].sort((a, b) => {
    const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (!Number.isNaN(delta) && delta !== 0) {
      return delta;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * @param {import('../core/types.js').ThreadPost[]} posts
 */
function buildChildrenMap(posts) {
  /** @type {Map<string, import('../core/types.js').ThreadPost[]>} */
  const map = new Map();
  for (const post of posts) {
    if (!post.inReplyToId) {
      continue;
    }
    const bucket = map.get(post.inReplyToId) || [];
    bucket.push(post);
    map.set(post.inReplyToId, bucket);
  }

  for (const children of map.values()) {
    children.sort((a, b) => {
      const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      if (!Number.isNaN(delta) && delta !== 0) {
        return delta;
      }
      return a.id.localeCompare(b.id);
    });
  }

  return map;
}

/**
 * @param {number | undefined} requestBudget
 */
function depthFromBudget(requestBudget) {
  const budget = Number(requestBudget || 3);
  return Math.max(30, Math.min(1000, Math.round(budget * 120)));
}

/**
 * @param {import('../core/types.js').Thread} thread
 * @param {import('../core/types.js').ThreadPost[]} discoveredSameAuthorPosts
 */
function continueFromTail(thread, discoveredSameAuthorPosts) {
  const seenIds = new Set(thread.posts.map((post) => post.id));
  const childrenByParent = buildChildrenMap(discoveredSameAuthorPosts);
  let cursor = thread.posts[thread.posts.length - 1];
  let hasAlternateBranches = false;
  const additions = [];

  for (const children of childrenByParent.values()) {
    if (children.length > 1) {
      hasAlternateBranches = true;
      break;
    }
  }

  while (cursor) {
    const candidates = (childrenByParent.get(cursor.id) || []).filter(
      (post) => !seenIds.has(post.id),
    );
    if (!candidates.length) {
      break;
    }

    const next = candidates[0];
    additions.push(next);
    seenIds.add(next.id);
    cursor = next;
  }

  return {
    additions,
    hasAlternateBranches,
  };
}

/**
 * @type {{
 * canHandleUrl: (inputUrl: string) => boolean,
 * parseUrl: (inputUrl: string) => { actor: string, rkey: string, canonicalUrl: string },
 * fetchThread: (inputUrl: string, options?: { initialContextRequests?: number }) => Promise<{ thread: import('../core/types.js').Thread, hasMore: boolean, addedCount: number, rateLimitedUntil: number }>,
 * continueThread: (thread: import('../core/types.js').Thread, options?: { maxContextRequests?: number }) => Promise<{ thread: import('../core/types.js').Thread, hasMore: boolean, addedCount: number, rateLimitedUntil: number }>
 * }}
 */
export const blueskyAdapter = {
  canHandleUrl(inputUrl) {
    const parsed = parseBlueskyPostUrl(inputUrl);
    return Boolean(parsed.actor && parsed.rkey);
  },

  parseUrl(inputUrl) {
    return parseBlueskyPostUrl(inputUrl);
  },

  async fetchThread(inputUrl, options = {}) {
    const parsed = parseBlueskyPostUrl(inputUrl);

    const profile = await fetchJson("app.bsky.actor.getProfile", {
      actor: parsed.actor,
    });

    const did = profile?.did;
    if (!did) {
      throw new BlueskyError("Could not resolve Bluesky profile DID for that URL.");
    }

    const seedUri = `at://${did}/app.bsky.feed.post/${parsed.rkey}`;
    const depth = depthFromBudget(options.initialContextRequests);

    const threadResponse = await fetchJson("app.bsky.feed.getPostThread", {
      uri: seedUri,
      depth,
      parentHeight: depth,
    });

    const root = threadResponse?.thread;
    if (!root || root.$type !== "app.bsky.feed.defs#threadViewPost") {
      throw new BlueskyError("Could not load that Bluesky thread.");
    }

    const byUri = new Map();
    collectThreadPosts(root, byUri);

    const seedRaw = byUri.get(seedUri) || root.post;
    if (!seedRaw) {
      throw new BlueskyError("Could not locate the seed post in that Bluesky thread.");
    }

    const seedPost = normalizePost(seedRaw);
    const authorId = seedPost.account.id;

    const normalizedById = new Map();
    for (const rawPost of byUri.values()) {
      const normalized = normalizePost(rawPost);
      if (normalized.account.id !== authorId) {
        continue;
      }
      normalizedById.set(normalized.id, normalized);
    }

    normalizedById.set(seedPost.id, seedPost);

    const descendants = comparePostsByDate(
      Array.from(normalizedById.values()).filter((post) => post.id !== seedPost.id),
    );

    const built = buildMainlineThread({
      seedPost,
      ancestors: [],
      descendants,
    });

    return {
      thread: {
        platform: "bluesky",
        instance: "public.api.bsky.app",
        seedPostId: seedPost.id,
        sourceUrl: parsed.canonicalUrl,
        fetchedAt: new Date().toISOString(),
        hasAlternateBranches: built.hasAlternateBranches,
        posts: built.posts,
        author: seedPost.account,
      },
      hasMore: true,
      addedCount: 0,
      rateLimitedUntil: 0,
    };
  },

  async continueThread(thread, options = {}) {
    if (!thread || thread.platform !== "bluesky" || !Array.isArray(thread.posts)) {
      throw new BlueskyError("Cannot continue thread: invalid Bluesky thread payload.");
    }

    if (!thread.posts.length) {
      return {
        thread,
        hasMore: false,
        addedCount: 0,
        rateLimitedUntil: 0,
      };
    }

    const tail = thread.posts[thread.posts.length - 1];
    const depth = depthFromBudget(options.maxContextRequests);

    let threadResponse;
    try {
      threadResponse = await fetchJson("app.bsky.feed.getPostThread", {
        uri: tail.id,
        depth,
        parentHeight: 0,
      });
    } catch (error) {
      if (error instanceof BlueskyRateLimitError) {
        return {
          thread,
          hasMore: true,
          addedCount: 0,
          rateLimitedUntil: Date.now() + error.retryAfterMs,
        };
      }
      throw error;
    }

    const root = threadResponse?.thread;
    if (!root || root.$type !== "app.bsky.feed.defs#threadViewPost") {
      return {
        thread,
        hasMore: false,
        addedCount: 0,
        rateLimitedUntil: 0,
      };
    }

    const byUri = new Map();
    collectThreadPosts(root, byUri);

    const sameAuthorPosts = comparePostsByDate(
      Array.from(byUri.values())
        .map((post) => normalizePost(post))
        .filter((post) => post.account.id === thread.author.id),
    );

    const continuation = continueFromTail(thread, sameAuthorPosts);
    const nextThread = {
      ...thread,
      fetchedAt: new Date().toISOString(),
      hasAlternateBranches:
        thread.hasAlternateBranches || continuation.hasAlternateBranches,
      posts: [...thread.posts, ...continuation.additions],
    };

    return {
      thread: nextThread,
      hasMore: continuation.additions.length > 0,
      addedCount: continuation.additions.length,
      rateLimitedUntil: 0,
    };
  },
};

export { BlueskyError, BlueskyRateLimitError };
