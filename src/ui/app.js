import { getAdapterForUrl } from "../platforms/adapter.js";
import { renderThread } from "./threadView.js";

const CACHE_PREFIX = "threader-cache-v1:";
const THREAD_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const AUTO_LOAD_BOTTOM_THRESHOLD_PX = 1100;
const AUTO_LOAD_COOLDOWN_MS = 250;

/**
 * @param {string} url
 */
function cacheKey(url) {
  return `${CACHE_PREFIX}${encodeURIComponent(url)}`;
}

/**
 * @param {string} url
 * @param {import('../core/types.js').Thread} thread
 * @param {boolean} hasMore
 */
function saveThreadToCache(url, thread, hasMore = false) {
  try {
    const payload = {
      cachedAt: new Date().toISOString(),
      thread,
      hasMore,
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
 * @param {string} iso
 */
function isCacheFresh(iso) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return Date.now() - parsed <= THREAD_CACHE_TTL_MS;
}

/**
 * @param {any} result
 */
function normalizeAdapterResult(result) {
  if (result && result.thread && Array.isArray(result.thread.posts)) {
    return {
      thread: result.thread,
      hasMore: Boolean(result.hasMore),
      addedCount: Number(result.addedCount || 0),
      rateLimitedUntil: Number(result.rateLimitedUntil || 0),
    };
  }

  if (result && Array.isArray(result.posts)) {
    return {
      thread: result,
      hasMore: false,
      addedCount: 0,
      rateLimitedUntil: 0,
    };
  }

  throw new Error("Could not parse thread response from adapter.");
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
 * @param {{ showTimeGaps: boolean }} options
 */
function syncUrlQueryWithOptions(input, options) {
  const current = new URL(window.location.href);
  if (input.value.trim()) {
    current.searchParams.set("url", input.value.trim());
  } else {
    current.searchParams.delete("url");
  }

  if (options.showTimeGaps) {
    current.searchParams.set("gaps", "");
  } else {
    current.searchParams.delete("gaps");
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
  const pageParams = new URL(window.location.href).searchParams;
  let showTimeGaps = pageParams.has("gaps");

  const form = document.getElementById("unfurl-form");
  const input = document.getElementById("status-url");
  const button = document.getElementById("unfurl-button");
  const root = document.getElementById("thread-root");
  const statusLine = document.getElementById("status-line");
  const gapsSetting = document.getElementById("setting-gaps");

  if (
    !(form instanceof HTMLFormElement) ||
    !(input instanceof HTMLInputElement) ||
    !(button instanceof HTMLButtonElement) ||
    !(root instanceof HTMLElement) ||
    !(statusLine instanceof HTMLElement) ||
    !(gapsSetting instanceof HTMLInputElement)
  ) {
    throw new Error("App mount failed: missing required DOM elements.");
  }

  gapsSetting.checked = showTimeGaps;

  let activeAdapter = null;
  let activeThread = null;
  let activeUrl = "";
  let hasMoreThread = false;
  let loadingMore = false;
  let nextContinuationAllowedAt = 0;
  let activeSession = 0;
  let lastAutoLoadAttemptAt = 0;

  function isNearBottom() {
    return (
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - AUTO_LOAD_BOTTOM_THRESHOLD_PX
    );
  }

  function renderActiveThread() {
    if (!activeThread) {
      root.innerHTML = "";
      return;
    }
    renderThread(root, activeThread, {
      showTimeGaps,
    });
  }

  function canContinueThread() {
    return Boolean(
      activeAdapter &&
      typeof activeAdapter.continueThread === "function" &&
      activeThread &&
      hasMoreThread,
    );
  }

  async function maybeAutoLoadMore() {
    if (
      button.disabled ||
      !canContinueThread() ||
      loadingMore ||
      !isNearBottom()
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastAutoLoadAttemptAt < AUTO_LOAD_COOLDOWN_MS) {
      return;
    }
    if (now < nextContinuationAllowedAt) {
      return;
    }

    lastAutoLoadAttemptAt = now;
    loadingMore = true;
    const session = activeSession;

    try {
      const beforeCount = activeThread?.posts.length || 0;
      const previousScrollHeight = document.documentElement.scrollHeight;
      const previousScrollY = window.scrollY;

      setStatus(statusLine, "Loading more posts...");

      const raw = await activeAdapter.continueThread(activeThread, {
        maxContextRequests: 3,
      });
      if (session !== activeSession) {
        return;
      }

      const result = normalizeAdapterResult(raw);
      activeThread = result.thread;
      hasMoreThread = result.hasMore;

      if (result.rateLimitedUntil > Date.now()) {
        nextContinuationAllowedAt = result.rateLimitedUntil;
      }

      const addedCount =
        result.addedCount ||
        Math.max(0, activeThread.posts.length - beforeCount);

      if (addedCount === 0 && result.rateLimitedUntil <= Date.now()) {
        hasMoreThread = false;
      }

      if (addedCount > 0) {
        renderActiveThread();
        saveThreadToCache(activeUrl, activeThread, hasMoreThread);

        const newScrollHeight = document.documentElement.scrollHeight;
        const delta = newScrollHeight - previousScrollHeight;
        if (delta > 0 && isNearBottom()) {
          window.scrollTo({ top: previousScrollY + delta });
        }
      }

      if (result.rateLimitedUntil > Date.now()) {
        const seconds = Math.max(
          1,
          Math.ceil((result.rateLimitedUntil - Date.now()) / 1000),
        );
        setStatus(
          statusLine,
          `Rate limited by server. Continuing in about ${seconds}s...`,
          "warning",
        );
        window.setTimeout(
          () => {
            if (session === activeSession) {
              void maybeAutoLoadMore();
            }
          },
          Math.max(250, result.rateLimitedUntil - Date.now()),
        );
      } else {
        setStatus(statusLine, "");
      }

      if (hasMoreThread && addedCount > 0 && isNearBottom()) {
        window.requestAnimationFrame(() => {
          void maybeAutoLoadMore();
        });
      }
    } catch (error) {
      if (session !== activeSession) {
        return;
      }

      hasMoreThread = false;
      const message =
        error instanceof Error
          ? error.message
          : "Could not continue loading this thread.";
      setStatus(statusLine, message, "warning");
    } finally {
      if (session === activeSession) {
        loadingMore = false;
      }
    }
  }

  async function runLoad() {
    const submittedUrl = input.value.trim();
    if (!submittedUrl) {
      setStatus(
        statusLine,
        "Please paste a Mastodon or Bluesky post URL.",
        "error",
      );
      return;
    }

    const adapter = getAdapterForUrl(submittedUrl);
    if (!adapter) {
      setStatus(
        statusLine,
        "That URL does not look like a supported Mastodon or Bluesky post.",
        "error",
      );
      return;
    }

    const session = activeSession + 1;
    activeSession = session;
    activeAdapter = adapter;
    activeUrl = submittedUrl;
    activeThread = null;
    hasMoreThread = false;
    loadingMore = false;
    nextContinuationAllowedAt = 0;

    syncUrlQueryWithOptions(input, {
      showTimeGaps,
    });
    button.disabled = true;

    const cached = loadThreadFromCache(submittedUrl);
    if (cached?.thread) {
      activeThread = cached.thread;
      hasMoreThread = Boolean(cached.hasMore);
      renderActiveThread();
      document.title = `Thread by ${cached.thread.author.displayName} - Threader`;

      if (isCacheFresh(cached.cachedAt)) {
        setStatus(statusLine, "Loaded from local cache.");
        button.disabled = false;
        if (hasMoreThread) {
          window.requestAnimationFrame(() => {
            void maybeAutoLoadMore();
          });
        }
        return;
      }

      setStatus(
        statusLine,
        `Refreshing cached thread from ${formatCachedAt(cached.cachedAt)}...`,
      );
    } else {
      setStatus(statusLine, "Loading thread...");
    }

    try {
      const raw = await adapter.fetchThread(submittedUrl, {
        initialContextRequests: 3,
      });
      if (session !== activeSession) {
        return;
      }

      const result = normalizeAdapterResult(raw);
      activeThread = result.thread;
      hasMoreThread = result.hasMore;
      nextContinuationAllowedAt = Math.max(0, result.rateLimitedUntil || 0);

      renderActiveThread();
      saveThreadToCache(submittedUrl, activeThread, hasMoreThread);
      document.title = `Thread by ${activeThread.author.displayName} - Threader`;
      setStatus(statusLine, "");

      if (hasMoreThread && isNearBottom()) {
        window.requestAnimationFrame(() => {
          void maybeAutoLoadMore();
        });
      }
    } catch (error) {
      if (session !== activeSession) {
        return;
      }

      if (cached?.thread) {
        activeThread = cached.thread;
        hasMoreThread = Boolean(cached.hasMore);
        renderActiveThread();
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
        activeThread = null;
        hasMoreThread = false;
        renderActiveThread();
      }
    } finally {
      if (session === activeSession) {
        button.disabled = false;
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runLoad();
  });

  gapsSetting.addEventListener("change", () => {
    showTimeGaps = gapsSetting.checked;
    syncUrlQueryWithOptions(input, {
      showTimeGaps,
    });

    if (activeThread) {
      renderActiveThread();
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      void maybeAutoLoadMore();
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    void maybeAutoLoadMore();
  });

  const prefilled = new URL(window.location.href).searchParams.get("url");
  if (prefilled) {
    input.value = prefilled;
    void runLoad();
  }
}
