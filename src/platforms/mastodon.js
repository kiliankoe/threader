import { buildMainlineThread } from "../core/threadBuilder.js";

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
    throw new FetchError(
      `Mastodon API request failed (${response.status}).${detail}`,
      response.status
    );
  }

  return response.json();
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
  };
}

/**
 * @type {{
 * canHandleUrl: (inputUrl: string) => boolean,
 * parseUrl: (inputUrl: string) => { instance: string, statusId: string, canonicalUrl: string },
 * fetchThread: (inputUrl: string) => Promise<import('../core/types.js').Thread>
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

  async fetchThread(inputUrl) {
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

    return {
      platform: "mastodon",
      instance: parsed.instance,
      seedPostId: seedPost.id,
      sourceUrl: parsed.canonicalUrl,
      fetchedAt: new Date().toISOString(),
      hasAlternateBranches: built.hasAlternateBranches,
      posts: built.posts,
      author: seedPost.account,
    };
  },
};

export { FetchError };
