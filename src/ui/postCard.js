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
function makeSeparatorItem(value) {
  const span = document.createElement("span");
  span.className = "separator-dot";
  span.textContent = value;
  return span;
}

/**
 * @param {import('../core/types.js').ThreadPost} post
 * @param {number} index
 */
export function renderPostCard(post, index) {
  const article = document.createElement("article");
  article.className = "post-card";

  const topline = document.createElement("div");
  topline.className = "post-topline";
  topline.textContent = `Post ${index + 1}`;
  article.append(topline);

  const cw = getCwPresentation(post, index);
  const safeContent = sanitizeHtml(post.contentHtml);

  const contentWrapper = document.createElement("div");
  contentWrapper.className = "post-content";
  contentWrapper.innerHTML = safeContent;

  if (cw.hasContentWarning && cw.startsCollapsed) {
    const banner = document.createElement("p");
    banner.className = "cw-banner";
    banner.textContent = `Main post has content warning: ${cw.text}`;
    article.append(banner);

    const detailsWrap = document.createElement("div");
    detailsWrap.className = "cw-content";

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = cw.text ? `Show content (${cw.text})` : "Show content";
    details.append(summary);
    details.append(contentWrapper);
    detailsWrap.append(details);
    article.append(detailsWrap);
  } else {
    if (cw.hasContentWarning) {
      const inline = document.createElement("p");
      inline.className = "cw-inline";
      inline.textContent = cw.text ? `CW: ${cw.text}` : "CW";
      article.append(inline);
    }
    article.append(contentWrapper);
  }

  const media = renderMediaGallery(post.attachments);
  if (media) {
    article.append(media);
  }

  const foot = document.createElement("footer");
  foot.className = "post-foot";
  foot.append(document.createTextNode(formatDate(post.createdAt)));
  foot.append(makeSeparatorItem(`replies ${formatCount(post.counts.replies)}`));
  foot.append(makeSeparatorItem(`boosts ${formatCount(post.counts.boosts)}`));
  foot.append(makeSeparatorItem(`favs ${formatCount(post.counts.favourites)}`));

  const openOriginal = document.createElement("a");
  openOriginal.className = "status-link separator-dot";
  openOriginal.href = post.url;
  openOriginal.target = "_blank";
  openOriginal.rel = "noopener noreferrer";
  openOriginal.textContent = "open original";
  foot.append(openOriginal);

  article.append(foot);

  return article;
}
