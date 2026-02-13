const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
};

/**
 * @param {string} html
 */
export function sanitizeHtml(html) {
  const unsafe = html || "";

  if (typeof window !== "undefined" && window.DOMPurify) {
    const cleaned = window.DOMPurify.sanitize(unsafe, SANITIZE_CONFIG);
    const doc = new DOMParser().parseFromString(cleaned, "text/html");
    for (const link of doc.querySelectorAll("a")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer nofollow");
    }
    return doc.body.innerHTML;
  }

  const div = document.createElement("div");
  div.textContent = unsafe;
  return div.innerHTML;
}
