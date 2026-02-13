/**
 * @param {import('./types.js').ThreadPost} post
 * @param {number} index
 */
export function getCwPresentation(post, index) {
  const spoiler = (post.spoilerText || "").trim();
  const hasContentWarning = spoiler.length > 0;

  return {
    hasContentWarning,
    text: spoiler,
    startsCollapsed: hasContentWarning && index === 0,
  };
}
