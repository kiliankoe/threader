/**
 * @param {Array<{ shortcode: string, url: string }>} emojis
 */
function buildEmojiMap(emojis) {
  const byShortcode = new Map();
  for (const emoji of emojis || []) {
    const shortcode = typeof emoji?.shortcode === "string" ? emoji.shortcode : "";
    const url = typeof emoji?.url === "string" ? emoji.url : "";
    if (!shortcode || !url || byShortcode.has(shortcode)) {
      continue;
    }
    byShortcode.set(shortcode, url);
  }
  return byShortcode;
}

/**
 * @param {Map<string, string>} emojiMap
 * @param {string} text
 */
function hasEmojiShortcode(emojiMap, text) {
  if (!emojiMap.size || !text || text.indexOf(":") === -1) {
    return false;
  }

  for (const shortcode of emojiMap.keys()) {
    if (text.includes(`:${shortcode}:`)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {Map<string, string>} emojiMap
 * @param {string} text
 */
function createEmojiFragment(emojiMap, text) {
  const fragment = document.createDocumentFragment();
  const tokenPattern = /:([a-zA-Z0-9_+-]+):/g;
  let cursor = 0;

  while (true) {
    const match = tokenPattern.exec(text);
    if (!match) {
      break;
    }

    const start = match.index;
    const end = tokenPattern.lastIndex;
    const shortcode = match[1];
    const emojiUrl = emojiMap.get(shortcode);
    if (!emojiUrl) {
      continue;
    }

    if (start > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, start)));
    }

    const image = document.createElement("img");
    image.className = "custom-emoji";
    image.alt = `:${shortcode}:`;
    image.src = emojiUrl;
    image.loading = "lazy";
    image.decoding = "async";
    fragment.append(image);

    cursor = end;
  }

  if (cursor === 0) {
    return null;
  }

  if (cursor < text.length) {
    fragment.append(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}

/**
 * @param {Node} root
 * @param {Map<string, string>} emojiMap
 */
function replaceShortcodesInTree(root, emojiMap) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_SKIP;
      }

      const tag = node.parentElement?.tagName || "";
      if (
        tag === "CODE" ||
        tag === "PRE" ||
        tag === "SCRIPT" ||
        tag === "STYLE" ||
        tag === "TEXTAREA"
      ) {
        return NodeFilter.FILTER_SKIP;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  while (true) {
    const next = walker.nextNode();
    if (!next) {
      break;
    }
    textNodes.push(next);
  }

  for (const textNode of textNodes) {
    const value = textNode.nodeValue || "";
    if (!hasEmojiShortcode(emojiMap, value)) {
      continue;
    }

    const fragment = createEmojiFragment(emojiMap, value);
    if (!fragment) {
      continue;
    }

    textNode.replaceWith(fragment);
  }
}

/**
 * @param {HTMLElement} container
 * @param {Array<{ shortcode: string, url: string }>} emojis
 */
export function replaceCustomEmojiShortcodes(container, emojis) {
  const emojiMap = buildEmojiMap(emojis);
  if (!emojiMap.size) {
    return;
  }
  replaceShortcodesInTree(container, emojiMap);
}

/**
 * @param {HTMLElement} container
 * @param {string} text
 * @param {Array<{ shortcode: string, url: string }>} emojis
 */
export function appendTextWithCustomEmoji(container, text, emojis) {
  container.textContent = text;
  replaceCustomEmojiShortcodes(container, emojis);
}
