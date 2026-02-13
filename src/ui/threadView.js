import { renderPostCard } from "./postCard.js";

/**
 * @param {HTMLElement} container
 * @param {import('../core/types.js').Thread} thread
 */
export function renderThread(container, thread) {
  container.innerHTML = "";

  if (!thread.posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No same-author thread posts were found.";
    container.append(empty);
    return;
  }

  const shell = document.createElement("section");
  shell.className = "thread-shell";

  const head = document.createElement("header");
  head.className = "thread-head";

  const title = document.createElement("h2");
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
    shell.append(renderPostCard(post, index));
  });

  container.append(shell);
}
