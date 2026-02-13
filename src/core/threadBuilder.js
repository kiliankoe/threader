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
 * Build a linear same-author mainline around the seed post.
 *
 * @param {{
 *   seedPost: import('./types.js').ThreadPost,
 *   ancestors: import('./types.js').ThreadPost[],
 *   descendants: import('./types.js').ThreadPost[]
 * }} input
 */
export function buildMainlineThread(input) {
  const byId = new Map();
  const candidates = [...input.ancestors, input.seedPost, ...input.descendants];

  for (const post of candidates) {
    byId.set(post.id, post);
  }

  /** @type {Map<string, import('./types.js').ThreadPost[]>} */
  const childrenByParent = new Map();
  for (const post of byId.values()) {
    if (!post.inReplyToId || !byId.has(post.inReplyToId)) {
      continue;
    }
    const bucket = childrenByParent.get(post.inReplyToId) || [];
    bucket.push(post);
    childrenByParent.set(post.inReplyToId, bucket);
  }

  for (const children of childrenByParent.values()) {
    children.sort(compareByDate);
  }

  const hasAlternateBranches = Array.from(childrenByParent.values()).some(
    (children) => children.length > 1
  );

  const beforeSeed = [];
  const visitedUp = new Set([input.seedPost.id]);
  let cursor = input.seedPost;

  while (cursor.inReplyToId && byId.has(cursor.inReplyToId)) {
    const parent = byId.get(cursor.inReplyToId);
    if (!parent || visitedUp.has(parent.id)) {
      break;
    }
    beforeSeed.unshift(parent);
    visitedUp.add(parent.id);
    cursor = parent;
  }

  const afterSeed = [];
  const visitedDown = new Set([input.seedPost.id]);
  cursor = input.seedPost;

  while (true) {
    const children = childrenByParent.get(cursor.id) || [];
    if (children.length === 0) {
      break;
    }

    const mainlineChild = children[0];
    if (!mainlineChild || visitedDown.has(mainlineChild.id)) {
      break;
    }

    afterSeed.push(mainlineChild);
    visitedDown.add(mainlineChild.id);
    cursor = mainlineChild;
  }

  return {
    posts: [...beforeSeed, input.seedPost, ...afterSeed],
    hasAlternateBranches,
  };
}
