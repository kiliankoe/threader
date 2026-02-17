import { renderPostCard } from "./postCard.js";

/**
 * @param {number} value
 * @param {string} unit
 */
function formatUnit(value, unit) {
  const amount = Math.max(1, Math.round(value));
  const suffix = amount === 1 ? "" : "s";
  return `${amount} ${unit}${suffix} later`;
}

/**
 * @param {string} fromIso
 * @param {string} toIso
 */
function formatGapLabel(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return null;
  }

  const diffMs = to - from;
  if (diffMs <= 0) {
    return null;
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diffMs <= 10 * minute) {
    return null;
  }
  if (diffMs < 90 * minute) {
    return formatUnit(diffMs / minute, "minute");
  }
  if (diffMs < 36 * hour) {
    return formatUnit(diffMs / hour, "hour");
  }
  if (diffMs < 10 * day) {
    return formatUnit(diffMs / day, "day");
  }
  if (diffMs < 8 * week) {
    return formatUnit(diffMs / week, "week");
  }
  if (diffMs < 18 * month) {
    return formatUnit(diffMs / month, "month");
  }

  return formatUnit(diffMs / year, "year");
}

/**
 * @param {HTMLElement} container
 * @param {import('../core/types.js').Thread} thread
 * @param {{ showTimeGaps?: boolean }} [options]
 */
export function renderThread(container, thread, options = {}) {
  container.innerHTML = "";

  if (!thread.posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No same-author thread posts were found.";
    container.append(empty);
    return;
  }

  const shell = document.createElement("article");
  shell.className = "thread-shell";

  const head = document.createElement("header");
  head.className = "thread-head";

  const title = document.createElement("h1");
  title.textContent = `Thread by ${thread.author.displayName}`;
  head.append(title);

  const meta = document.createElement("p");
  meta.className = "thread-meta";
  const postLabel = thread.posts.length === 1 ? "post" : "posts";
  meta.textContent = `${thread.posts.length} ${postLabel} from @${thread.author.acct}`;
  head.append(meta);

  if (thread.hasAlternateBranches) {
    const note = document.createElement("p");
    note.className = "branch-note";
    note.textContent =
      "Multiple same-author reply branches exist; showing the oldest mainline only.";
    head.append(note);
  }

  shell.append(head);

  thread.posts.forEach((post, index) => {
    shell.append(renderPostCard(post, index, thread.posts.length));

    if (!options.showTimeGaps || index >= thread.posts.length - 1) {
      return;
    }

    const nextPost = thread.posts[index + 1];
    const gapLabel = formatGapLabel(post.createdAt, nextPost.createdAt);
    if (!gapLabel) {
      return;
    }

    const gap = document.createElement("p");
    gap.className = "post-gap-note";
    gap.textContent = gapLabel;
    shell.append(gap);
  });

  container.append(shell);
}
