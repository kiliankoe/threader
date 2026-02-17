import { getCwPresentation } from "../core/cwPolicy.js";
import { sanitizeHtml } from "../lib/sanitize.js";
import { replaceCustomEmojiShortcodes } from "./customEmoji.js";
import { openMediaModal } from "./mediaModal.js";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * @param {string} value
 */
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return dateFormatter.format(date);
}

/**
 * @param {import('../core/types.js').ThreadPost['attachments']} attachments
 */
function renderMediaGallery(attachments) {
  if (!attachments.length) {
    return null;
  }

  const useHighResInlineImages = attachments.length === 1;

  const shouldUseModal =
    typeof window !== "undefined" &&
    !window.matchMedia("(max-width: 720px)").matches;

  const gallery = document.createElement("div");
  gallery.className = "media-grid";

  for (const attachment of attachments) {
    if (!attachment.url && !attachment.previewUrl) {
      continue;
    }

    const figure = document.createElement("figure");
    figure.className = "media-item";

    if (attachment.type === "image") {
      const anchor = document.createElement("a");
      anchor.className = "media-trigger-link";
      anchor.href = attachment.url || attachment.previewUrl;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.addEventListener("click", (event) => {
        if (!shouldUseModal) {
          return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        openMediaModal(attachment);
      });

      const image = document.createElement("img");
      image.loading = "lazy";
      image.src = useHighResInlineImages
        ? attachment.url || attachment.previewUrl || ""
        : attachment.previewUrl || attachment.url || "";
      image.alt = attachment.description || "Attached image";
      anchor.append(image);
      figure.append(anchor);
    } else if (attachment.type === "video" || attachment.type === "gifv") {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "none";
      video.playsInline = true;
      video.src = attachment.url || attachment.previewUrl || "";
      if (attachment.previewUrl) {
        video.poster = attachment.previewUrl;
      }
      if (attachment.description) {
        video.setAttribute("aria-label", attachment.description);
      } else {
        video.setAttribute("aria-label", "Video attachment");
      }

      figure.append(video);
    } else if (attachment.type === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = attachment.url;
      figure.append(audio);
    } else {
      const anchor = document.createElement("a");
      anchor.href = attachment.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = "Open attachment";
      figure.append(anchor);
    }

    if (attachment.description) {
      const caption = document.createElement("figcaption");
      caption.textContent = attachment.description;
      figure.append(caption);
    }

    gallery.append(figure);
  }

  return gallery.childElementCount > 0 ? gallery : null;
}

/**
 * @param {string} text
 * @param {number} index
 * @param {number} totalPosts
 */
function stripLeadingThreadMarkerFromText(text, index, totalPosts) {
  if (totalPosts < 3) {
    return text;
  }

  const postNumber = index + 1;

  const slashWithTotal = text.match(
    /^\s*\(?(\d{1,3})\s*\/\s*(\d{1,3})\)?(?:\s+|[\-:.)\]–—]\s+)/,
  );
  if (slashWithTotal) {
    const current = Number(slashWithTotal[1]);
    const declaredTotal = Number(slashWithTotal[2]);
    const plausibleTotal =
      declaredTotal >= Math.max(3, totalPosts - 1) &&
      declaredTotal <= totalPosts + 30;

    if (current === postNumber && declaredTotal >= current && plausibleTotal) {
      return text.slice(slashWithTotal[0].length);
    }
  }

  const ofWithTotal = text.match(
    /^\s*\(?(\d{1,3})\s+of\s+(\d{1,3})\)?(?:\s+|[\-:.)\]–—]\s+)/i,
  );
  if (ofWithTotal) {
    const current = Number(ofWithTotal[1]);
    const declaredTotal = Number(ofWithTotal[2]);
    const plausibleTotal =
      declaredTotal >= Math.max(3, totalPosts - 1) &&
      declaredTotal <= totalPosts + 30;

    if (current === postNumber && declaredTotal >= current && plausibleTotal) {
      return text.slice(ofWithTotal[0].length);
    }
  }

  const slashMarker = text.match(
    /^\s*(\d{1,3})\s*\/(?!\d)(?:\s+|[\-:.)\]–—]\s+)/,
  );
  if (slashMarker) {
    const current = Number(slashMarker[1]);
    if (current === postNumber) {
      return text.slice(slashMarker[0].length);
    }
  }

  return text;
}

/**
 * @param {string} text
 * @param {number} index
 * @param {number} totalPosts
 */
function stripTrailingThreadMarkerFromText(text, index, totalPosts) {
  if (totalPosts < 3) {
    return text;
  }

  const postNumber = index + 1;

  const slashWithTotal = text.match(
    /(?:^|[\s([\{\-–—:])\(?(\d{1,3})\s*\/\s*(\d{1,3})\)?(?:[.!?\])]+)?\s*$/,
  );
  if (slashWithTotal) {
    const current = Number(slashWithTotal[1]);
    const declaredTotal = Number(slashWithTotal[2]);
    const plausibleTotal =
      declaredTotal >= Math.max(3, totalPosts - 1) &&
      declaredTotal <= totalPosts + 30;

    if (current === postNumber && declaredTotal >= current && plausibleTotal) {
      return text.slice(0, text.length - slashWithTotal[0].length);
    }
  }

  const ofWithTotal = text.match(
    /(?:^|[\s([\{\-–—:])\(?(\d{1,3})\s+of\s+(\d{1,3})\)?(?:[.!?\])]+)?\s*$/i,
  );
  if (ofWithTotal) {
    const current = Number(ofWithTotal[1]);
    const declaredTotal = Number(ofWithTotal[2]);
    const plausibleTotal =
      declaredTotal >= Math.max(3, totalPosts - 1) &&
      declaredTotal <= totalPosts + 30;

    if (current === postNumber && declaredTotal >= current && plausibleTotal) {
      return text.slice(0, text.length - ofWithTotal[0].length);
    }
  }

  const slashMarker = text.match(
    /(?:^|[\s([\{\-–—:])(\d{1,3})\s*\/(?!\d)(?:[.!?\])]+)?\s*$/,
  );
  if (slashMarker) {
    const current = Number(slashMarker[1]);
    if (current === postNumber) {
      return text.slice(0, text.length - slashMarker[0].length);
    }
  }

  return text;
}

/**
 * @param {string} text
 */
function stripLeadingNewlinesFromText(text) {
  return text.replace(/^(?:\s*\r?\n)+\s*/, "");
}

/**
 * @param {string} text
 */
function stripTrailingNewlinesFromText(text) {
  return text.replace(/\s*(?:\r?\n\s*)+$/, "");
}

/**
 * @param {string} html
 * @param {number} index
 * @param {number} totalPosts
 */
function stripLeadingThreadMarker(html, index, totalPosts) {
  const doc = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  const root = doc.body.firstElementChild;
  if (!root) {
    return html;
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_SKIP;
      }

      const tag = node.parentElement?.tagName || "";
      if (
        tag === "CODE" ||
        tag === "PRE" ||
        tag === "SCRIPT" ||
        tag === "STYLE"
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

  const firstTextNode = textNodes[0];
  if (!firstTextNode || !firstTextNode.nodeValue) {
    return html;
  }

  let changed = false;

  const cleanedLeading = stripLeadingThreadMarkerFromText(
    firstTextNode.nodeValue,
    index,
    totalPosts,
  );
  if (cleanedLeading !== firstTextNode.nodeValue) {
    firstTextNode.nodeValue = cleanedLeading;
    changed = true;
  }

  const withoutLeadingNewlines = stripLeadingNewlinesFromText(
    firstTextNode.nodeValue,
  );
  if (withoutLeadingNewlines !== firstTextNode.nodeValue) {
    firstTextNode.nodeValue = withoutLeadingNewlines;
    changed = true;
  }

  const lastTextNode = textNodes[textNodes.length - 1];
  if (lastTextNode && lastTextNode.nodeValue) {
    const cleanedTrailing = stripTrailingThreadMarkerFromText(
      lastTextNode.nodeValue,
      index,
      totalPosts,
    );

    if (cleanedTrailing !== lastTextNode.nodeValue) {
      lastTextNode.nodeValue = cleanedTrailing;
      changed = true;
    }

    const withoutTrailingNewlines = stripTrailingNewlinesFromText(
      lastTextNode.nodeValue,
    );
    if (withoutTrailingNewlines !== lastTextNode.nodeValue) {
      lastTextNode.nodeValue = withoutTrailingNewlines;
      changed = true;
    }
  }

  if (!changed) {
    return html;
  }

  return root.innerHTML;
}

/**
 * @param {URL} url
 */
function parseYouTubeStartSeconds(url) {
  const startValue = url.searchParams.get("start") || url.searchParams.get("t");
  if (!startValue) {
    return null;
  }

  if (/^\d+$/.test(startValue)) {
    const seconds = Number(startValue);
    return seconds > 0 ? seconds : null;
  }

  const match = startValue.match(
    /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i,
  );
  if (!match) {
    return null;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return totalSeconds > 0 ? totalSeconds : null;
}

/**
 * @param {string} href
 */
function getYouTubeEmbedUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = null;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || null;
  } else if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else {
      const pathMatch = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      videoId = pathMatch ? pathMatch[1] : null;
    }
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  const startSeconds = parseYouTubeStartSeconds(url);
  if (startSeconds) {
    embedUrl.searchParams.set("start", String(startSeconds));
  }
  return embedUrl.toString();
}

/**
 * @param {string} href
 */
function getPeerTubeEmbedUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  let videoId = null;
  const watchMatch = url.pathname.match(/^\/videos\/watch\/([^/?#]+)/);
  const embedMatch = url.pathname.match(/^\/videos\/embed\/([^/?#]+)/);
  const shortMatch = url.pathname.match(/^\/w\/([^/?#]+)/);

  if (watchMatch) {
    videoId = watchMatch[1];
  } else if (embedMatch) {
    videoId = embedMatch[1];
  } else if (shortMatch && /^[a-zA-Z0-9_-]{6,}$/.test(shortMatch[1])) {
    videoId = shortMatch[1];
  }

  if (!videoId) {
    return null;
  }

  const embedUrl = new URL(`/videos/embed/${videoId}`, `${url.protocol}//${url.host}`);
  const startSeconds = parseYouTubeStartSeconds(url);
  if (startSeconds) {
    embedUrl.searchParams.set("start", String(startSeconds));
  }

  return embedUrl.toString();
}

/**
 * @param {string} href
 */
function getEmbeddableVideoUrl(href) {
  return getYouTubeEmbedUrl(href) || getPeerTubeEmbedUrl(href);
}

/**
 * @param {string} href
 */
function normalizeUrlKey(href) {
  try {
    return new URL(href).toString();
  } catch {
    return String(href || "");
  }
}

/**
 * @param {string} sourceUrl
 * @param {string} embedUrl
 */
function createVideoEmbed(sourceUrl, embedUrl) {
  const embed = document.createElement("div");
  embed.className = "youtube-embed";

  const iframe = document.createElement("iframe");
  iframe.src = embedUrl;
  iframe.loading = "lazy";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.title = "Embedded video";
  embed.append(iframe);

  const sourceLink = document.createElement("a");
  sourceLink.className = "youtube-embed-link";
  sourceLink.href = sourceUrl;
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener noreferrer nofollow";
  sourceLink.textContent = sourceUrl;
  embed.append(sourceLink);

  return embed;
}

/**
 * @param {HTMLAnchorElement} link
 */
function getStandalonePlacement(link) {
  const parent = link.parentElement;
  if (!parent) {
    return null;
  }

  let standaloneByParent = true;
  for (const node of parent.childNodes) {
    if (node === link) {
      continue;
    }

    if (node.nodeType === Node.TEXT_NODE && !(node.nodeValue || "").trim()) {
      continue;
    }

    standaloneByParent = false;
    break;
  }

  if (standaloneByParent) {
    return {
      parent,
      replaceParent: true,
    };
  }

  let previousSignificant = null;
  let cursor = link.previousSibling;
  while (cursor) {
    if (cursor.nodeType === Node.TEXT_NODE && !(cursor.nodeValue || "").trim()) {
      cursor = cursor.previousSibling;
      continue;
    }
    previousSignificant = cursor;
    break;
  }

  let nextSignificant = null;
  cursor = link.nextSibling;
  while (cursor) {
    if (cursor.nodeType === Node.TEXT_NODE && !(cursor.nodeValue || "").trim()) {
      cursor = cursor.nextSibling;
      continue;
    }
    nextSignificant = cursor;
    break;
  }

  const previousIsBreak =
    previousSignificant instanceof HTMLBRElement ||
    previousSignificant?.nodeName === "BR";
  const nextIsBreakOrMissing =
    !nextSignificant ||
    nextSignificant instanceof HTMLBRElement ||
    nextSignificant?.nodeName === "BR";

  if (!previousIsBreak || !nextIsBreakOrMissing) {
    return null;
  }

  return {
    parent,
    replaceParent: false,
  };
}

/**
 * @param {HTMLElement} container
 */
function processVideoLinksInContent(container) {
  const inlineVideoKeys = new Set();
  const deferredVideoUrls = new Map();
  const links = Array.from(container.querySelectorAll("a[href]"));

  for (const link of links) {
    if (!(link instanceof HTMLAnchorElement)) {
      continue;
    }

    const embedUrl = getEmbeddableVideoUrl(link.href);
    if (!embedUrl) {
      continue;
    }

    const urlKey = normalizeUrlKey(link.href);
    const standalonePlacement = getStandalonePlacement(link);
    if (!standalonePlacement) {
      if (!deferredVideoUrls.has(urlKey)) {
        deferredVideoUrls.set(urlKey, link.href);
      }
      continue;
    }

    const embed = createVideoEmbed(link.href, embedUrl);
    if (standalonePlacement.replaceParent) {
      standalonePlacement.parent.replaceWith(embed);
    } else {
      link.replaceWith(embed);
    }
    inlineVideoKeys.add(urlKey);
    deferredVideoUrls.delete(urlKey);
  }

  return {
    inlineVideoKeys,
    deferredVideoUrls,
  };
}

/**
 * @param {import('../core/types.js').ThreadPost['linkEmbeds']} linkEmbeds
 * @param {{ inlineVideoKeys: Set<string>, deferredVideoUrls: Map<string, string> }} videoLinkState
 */
function renderLinkEmbeds(linkEmbeds, videoLinkState) {
  if (
    (!Array.isArray(linkEmbeds) || !linkEmbeds.length) &&
    (!videoLinkState || videoLinkState.deferredVideoUrls.size === 0)
  ) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "link-embed-list";
  const renderedVideoKeys = new Set(videoLinkState?.inlineVideoKeys || []);

  for (const [urlKey, sourceUrl] of videoLinkState?.deferredVideoUrls || []) {
    if (renderedVideoKeys.has(urlKey)) {
      continue;
    }

    const embedUrl = getEmbeddableVideoUrl(sourceUrl);
    if (!embedUrl) {
      continue;
    }

    wrapper.append(createVideoEmbed(sourceUrl, embedUrl));
    renderedVideoKeys.add(urlKey);
  }

  for (const embed of linkEmbeds) {
    if (!embed || !embed.url) {
      continue;
    }

    const urlKey = normalizeUrlKey(embed.url);
    const videoEmbedUrl = getEmbeddableVideoUrl(embed.url);
    if (videoEmbedUrl) {
      if (renderedVideoKeys.has(urlKey)) {
        continue;
      }

      wrapper.append(createVideoEmbed(embed.url, videoEmbedUrl));
      renderedVideoKeys.add(urlKey);
      continue;
    }

    const hasPreviewData = Boolean(
      embed.title || embed.description || embed.imageUrl || embed.siteName,
    );
    if (!hasPreviewData) {
      continue;
    }

    const card = document.createElement("article");
    card.className = "link-preview-card";

    const cardLink = document.createElement("a");
    cardLink.className = "link-preview-main";
    cardLink.href = embed.url;
    cardLink.target = "_blank";
    cardLink.rel = "noopener noreferrer nofollow";

    if (embed.imageUrl) {
      const image = document.createElement("img");
      image.className = "link-preview-image";
      image.loading = "lazy";
      image.src = embed.imageUrl;
      image.alt = "";
      cardLink.append(image);
    }

    const body = document.createElement("div");
    body.className = "link-preview-body";

    if (embed.title) {
      const title = document.createElement("p");
      title.className = "link-preview-title";
      title.textContent = embed.title;
      body.append(title);
    }

    if (embed.description) {
      const description = document.createElement("p");
      description.className = "link-preview-description";
      description.textContent = embed.description;
      body.append(description);
    }

    if (embed.siteName) {
      const meta = document.createElement("p");
      meta.className = "link-preview-meta";
      meta.textContent = embed.siteName;
      body.append(meta);
    }

    cardLink.append(body);
    card.append(cardLink);

    wrapper.append(card);
  }

  return wrapper.childElementCount > 0 ? wrapper : null;
}

/**
 * @param {import('../core/types.js').ThreadPost} post
 * @param {number} index
 * @param {number} totalPosts
 */
export function renderPostCard(post, index, totalPosts) {
  const row = document.createElement("div");
  row.className = "post-row";

  const content = document.createElement("div");
  content.className = "post-card";

  const isSinglePost = totalPosts === 1;

  const cw = getCwPresentation(post, index);
  const safeContent = sanitizeHtml(post.contentHtml);
  const cleanedContent = stripLeadingThreadMarker(
    safeContent,
    index,
    totalPosts,
  );

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "post-content";
  contentWrapper.innerHTML = cleanedContent;
  const videoLinkState = processVideoLinksInContent(contentWrapper);
  replaceCustomEmojiShortcodes(contentWrapper, post.customEmojis || []);

  if (cw.hasContentWarning && cw.startsCollapsed) {
    const detailsWrap = document.createElement("div");
    detailsWrap.className = "cw-content";

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = cw.text
      ? isSinglePost
        ? `Show post (CW: ${cw.text})`
        : `Show content (${cw.text})`
      : isSinglePost
        ? "Show post"
        : "Show content";
    details.append(summary);
    details.append(contentWrapper);
    detailsWrap.append(details);
    content.append(detailsWrap);
  } else {
    content.append(contentWrapper);
  }

  const linkEmbeds = renderLinkEmbeds(post.linkEmbeds || [], videoLinkState);
  if (linkEmbeds) {
    content.append(linkEmbeds);
  }

  const media = renderMediaGallery(post.attachments);
  if (media) {
    content.append(media);
  }

  const meta = document.createElement("aside");
  meta.className = "post-meta";

  const dateItem = document.createElement("div");
  dateItem.className = "post-meta-item post-meta-date";

  const dateLink = document.createElement("a");
  dateLink.className = "status-link post-meta-date-link";
  dateLink.href = post.url;
  dateLink.target = "_blank";
  dateLink.rel = "noopener noreferrer";
  dateLink.textContent = formatDate(post.createdAt);
  dateItem.append(dateLink);
  meta.append(dateItem);

  row.append(content);
  row.append(meta);

  return row;
}
