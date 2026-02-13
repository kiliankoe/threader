import { getCwPresentation } from "../core/cwPolicy.js";
import { sanitizeHtml } from "../lib/sanitize.js";

const numberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * @param {number} value
 */
function formatCount(value) {
  return numberFormatter.format(Math.max(0, Number(value) || 0));
}

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
    if (!attachment.url) {
      continue;
    }

    const figure = document.createElement("figure");
    figure.className = "media-item";

    if (attachment.type === "image") {
      const anchor = document.createElement("a");
      anchor.href = attachment.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";

      const image = document.createElement("img");
      image.loading = "lazy";
      image.src = attachment.previewUrl || attachment.url;
      image.alt = attachment.description || "Attached image";
      anchor.append(image);
      figure.append(anchor);
    } else if (attachment.type === "video" || attachment.type === "gifv") {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.src = attachment.url;
      if (attachment.previewUrl) {
        video.poster = attachment.previewUrl;
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
 * @param {string} value
 */
function makeMetaItem(value) {
  const div = document.createElement("div");
  div.className = "post-meta-item";
  div.textContent = value;
  return div;
}

/**
 * @param {import('../core/types.js').ThreadPost} post
 * @param {number} index
 * @param {number} totalPosts
 */
export function renderPostCard(post, index, totalPosts) {
  const row = document.createElement("section");
  row.className = "post-row";

  const article = document.createElement("article");
  article.className = "post-card";

  const isSinglePost = totalPosts === 1;

  const cw = getCwPresentation(post, index);
  const safeContent = sanitizeHtml(post.contentHtml);

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "post-content";
  contentWrapper.innerHTML = safeContent;

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
    article.append(detailsWrap);
  } else {
    article.append(contentWrapper);
  }

  const media = renderMediaGallery(post.attachments);
  if (media) {
    article.append(media);
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

  if (cw.hasContentWarning) {
    const cwItem = makeMetaItem("⚠ CW");
    cwItem.classList.add("cw-tag");
    cwItem.tabIndex = 0;
    if (cw.text) {
      cwItem.dataset.cwText = cw.text;
      cwItem.title = cw.text;
      cwItem.setAttribute("aria-label", `Content warning: ${cw.text}`);
    } else {
      cwItem.dataset.cwText = "Content warning";
      cwItem.title = "Content warning";
      cwItem.setAttribute("aria-label", "Content warning");
    }
    meta.append(cwItem);
  }

  meta.append(makeMetaItem(`↩ ${formatCount(post.counts.replies)}`));
  meta.append(makeMetaItem(`↻ ${formatCount(post.counts.boosts)}`));
  meta.append(makeMetaItem(`★ ${formatCount(post.counts.favourites)}`));

  row.append(article);
  row.append(meta);

  return row;
}
