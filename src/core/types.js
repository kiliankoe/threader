/**
 * @typedef {Object} ThreadPost
 * @property {string} id
 * @property {string} url
 * @property {string} createdAt
 * @property {string} contentHtml
 * @property {string} spoilerText
 * @property {boolean} sensitive
 * @property {string|null} inReplyToId
 * @property {{ replies: number, boosts: number, favourites: number }} counts
 * @property {{ id: string, username: string, acct: string, displayName: string, url: string }} account
 * @property {Array<{ id: string, type: string, url: string, previewUrl: string|null, description: string }>} attachments
 */

/**
 * @typedef {Object} Thread
 * @property {"mastodon"} platform
 * @property {string} instance
 * @property {string} seedPostId
 * @property {string} sourceUrl
 * @property {string} fetchedAt
 * @property {boolean} hasAlternateBranches
 * @property {ThreadPost[]} posts
 * @property {{ id: string, username: string, acct: string, displayName: string, url: string }} author
 */

export {};
