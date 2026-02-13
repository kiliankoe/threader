import { getCwPresentation } from "../core/cwPolicy.js";
import { sanitizeHtml } from "../lib/sanitize.js";
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
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        openMediaModal(attachment);
      });

      const image = document.createElement("img");
      image.loading = "lazy";
      image.src = attachment.url || attachment.previewUrl || "";
      image.alt = attachment.description || "Attached image";
      anchor.append(image);
      figure.append(anchor);
    } else if (attachment.type === "video" || attachment.type === "gifv") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "media-trigger";
      button.setAttribute("aria-label", "Open video attachment");
      button.addEventListener("click", () => {
        openMediaModal(attachment);
      });

      if (attachment.previewUrl) {
        const preview = document.createElement("img");
        preview.loading = "lazy";
        preview.src = attachment.previewUrl;
        preview.alt = attachment.description || "Attached video";
        button.append(preview);
      } else {
        const previewVideo = document.createElement("video");
        previewVideo.className = "media-preview-video";
        previewVideo.preload = "metadata";
        previewVideo.muted = true;
        previewVideo.playsInline = true;
        previewVideo.src = attachment.url;
        button.append(previewVideo);
      }

      figure.append(button);
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
    /^\s*\(?(\d{1,3})\s*\/\s*(\d{1,3})\)?(?:\s+|[\-:.)\]–—]\s+)/
  );
  if (slashWithTotal) {
    const current = Number(slashWithTotal[1]);
    const declaredTotal = Number(slashWithTotal[2]);
    const plausibleTotal =
      declaredTotal >= Math.max(3, totalPosts - 1) && declaredTotal <= totalPosts + 30;

    if (current === postNumber && declaredTotal >= current && plausibleTotal) {
      return text.slice(slashWithTotal[0].length);
    }
  }

  const ofWithTotal = text.match(
    /^\s*\(?(\d{1,3})\s+of\s+(\d{1,3})\)?(?:\s+|[\-:.)\]–—]\s+)/i
  );
  if (ofWithTotal) {
    const current = Number(ofWithTotal[1]);
    const declaredTotal = Number(ofWithTotal[2]);
    const plausibleTotal =
      declaredTotal >= Math.max(3, totalPosts - 1) && declaredTotal <= totalPosts + 30;

    if (current === postNumber && declaredTotal >= current && plausibleTotal) {
      return text.slice(ofWithTotal[0].length);
    }
  }

  const slashMarker = text.match(
    /^\s*(\d{1,3})\s*\/(?!\d)(?:\s+|[\-:.)\]–—]\s+)/
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
    /(?:^|[\s([\{\-–—:])\(?(\d{1,3})\s*\/\s*(\d{1,3})\)?(?:[.!?\])]+)?\s*$/
  );
  if (slashWithTotal) {
    const current = Number(slashWithTotal[1]);
    const declaredTotal = Number(slashWithTotal[2]);
    const plausibleTotal =
      declaredTotal >= Math.max(3, totalPosts - 1) && declaredTotal <= totalPosts + 30;

    if (current === postNumber && declaredTotal >= current && plausibleTotal) {
      return text.slice(0, text.length - slashWithTotal[0].length);
    }
  }

  const ofWithTotal = text.match(
    /(?:^|[\s([\{\-–—:])\(?(\d{1,3})\s+of\s+(\d{1,3})\)?(?:[.!?\])]+)?\s*$/i
  );
  if (ofWithTotal) {
    const current = Number(ofWithTotal[1]);
    const declaredTotal = Number(ofWithTotal[2]);
    const plausibleTotal =
      declaredTotal >= Math.max(3, totalPosts - 1) && declaredTotal <= totalPosts + 30;

    if (current === postNumber && declaredTotal >= current && plausibleTotal) {
      return text.slice(0, text.length - ofWithTotal[0].length);
    }
  }

  const slashMarker = text.match(
    /(?:^|[\s([\{\-–—:])(\d{1,3})\s*\/(?!\d)(?:[.!?\])]+)?\s*$/
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
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) {
    return html;
  }

  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_SKIP;
        }

        const tag = node.parentElement?.tagName || "";
        if (tag === "CODE" || tag === "PRE" || tag === "SCRIPT" || tag === "STYLE") {
          return NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

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
    totalPosts
  );
  if (cleanedLeading !== firstTextNode.nodeValue) {
    firstTextNode.nodeValue = cleanedLeading;
    changed = true;
  }

  const withoutLeadingNewlines = stripLeadingNewlinesFromText(firstTextNode.nodeValue);
  if (withoutLeadingNewlines !== firstTextNode.nodeValue) {
    firstTextNode.nodeValue = withoutLeadingNewlines;
    changed = true;
  }

  const lastTextNode = textNodes[textNodes.length - 1];
  if (lastTextNode && lastTextNode.nodeValue) {
    const cleanedTrailing = stripTrailingThreadMarkerFromText(
      lastTextNode.nodeValue,
      index,
      totalPosts
    );

    if (cleanedTrailing !== lastTextNode.nodeValue) {
      lastTextNode.nodeValue = cleanedTrailing;
      changed = true;
    }

    const withoutTrailingNewlines = stripTrailingNewlinesFromText(lastTextNode.nodeValue);
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
  const cleanedContent = stripLeadingThreadMarker(safeContent, index, totalPosts);

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "post-content";
  contentWrapper.innerHTML = cleanedContent;

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
