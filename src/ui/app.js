import { getAdapterForUrl } from "../platforms/adapter.js";
import { renderThread } from "./threadView.js";

const CACHE_PREFIX = "threader-cache-v1:";

/**
 * @param {string} url
 */
function cacheKey(url) {
  return `${CACHE_PREFIX}${encodeURIComponent(url)}`;
}

/**
 * @param {string} url
 * @param {import('../core/types.js').Thread} thread
 */
function saveThreadToCache(url, thread) {
  try {
    const payload = {
      cachedAt: new Date().toISOString(),
      thread,
    };
    localStorage.setItem(cacheKey(url), JSON.stringify(payload));
  } catch {
    // Ignore localStorage quota and privacy mode failures.
  }
}

/**
 * @param {string} url
 */
function loadThreadFromCache(url) {
  try {
    const raw = localStorage.getItem(cacheKey(url));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.thread) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {HTMLElement} statusLine
 * @param {string} message
 * @param {"info" | "error" | "warning"} tone
 */
function setStatus(statusLine, message, tone = "info") {
  statusLine.textContent = message;
  if (tone === "info") {
    statusLine.removeAttribute("data-tone");
    return;
  }
  statusLine.dataset.tone = tone;
}

/**
 * @param {HTMLInputElement} input
 */
function syncUrlQuery(input) {
  const current = new URL(window.location.href);
  if (input.value.trim()) {
    current.searchParams.set("url", input.value.trim());
  } else {
    current.searchParams.delete("url");
  }
  window.history.replaceState({}, "", current);
}

/**
 * @param {string} iso
 */
function formatCachedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) {
    return "a previous session";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function mountApp() {
  const form = document.getElementById("unfurl-form");
  const input = document.getElementById("status-url");
  const button = document.getElementById("unfurl-button");
  const root = document.getElementById("thread-root");
  const statusLine = document.getElementById("status-line");

  if (
    !(form instanceof HTMLFormElement) ||
    !(input instanceof HTMLInputElement) ||
    !(button instanceof HTMLButtonElement) ||
    !(root instanceof HTMLElement) ||
    !(statusLine instanceof HTMLElement)
  ) {
    throw new Error("App mount failed: missing required DOM elements.");
  }

  async function runLoad() {
    const submittedUrl = input.value.trim();
    if (!submittedUrl) {
      setStatus(statusLine, "Please paste a Mastodon status URL.", "error");
      return;
    }

    const adapter = getAdapterForUrl(submittedUrl);
    if (!adapter) {
      setStatus(
        statusLine,
        "That URL does not look like a supported Mastodon status.",
        "error",
      );
      return;
    }

    syncUrlQuery(input);
    setStatus(statusLine, "Loading thread...");
    button.disabled = true;

    try {
      const thread = await adapter.fetchThread(submittedUrl);
      renderThread(root, thread);
      saveThreadToCache(submittedUrl, thread);
      document.title = `Thread by ${thread.author.displayName} - Threader`;
      setStatus(statusLine, "");
    } catch (error) {
      const cached = loadThreadFromCache(submittedUrl);
      if (cached?.thread) {
        renderThread(root, cached.thread);
        document.title = `Thread by ${cached.thread.author.displayName} - Threader`;
        setStatus(
          statusLine,
          `Could not refresh from network. Showing cached thread from ${formatCachedAt(cached.cachedAt)}.`,
          "warning",
        );
      } else {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown error while loading.";
        setStatus(statusLine, message, "error");
        root.innerHTML = "";
      }
    } finally {
      button.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runLoad();
  });

  const prefilled = new URL(window.location.href).searchParams.get("url");
  if (prefilled) {
    input.value = prefilled;
    void runLoad();
  }
}
