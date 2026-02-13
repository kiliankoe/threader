let modalRoot;
let modalPanel;
let modalContent;
let modalCaption;
let modalFoot;
let modalClose;

function getRemSize() {
  const size = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize || "16",
  );
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * @param {number} width
 * @param {number} height
 */
function sizeModalToMedia(width, height) {
  if (!modalPanel) {
    return;
  }

  modalPanel.style.removeProperty("width");

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return;
  }

  const maxWidth = Math.min(window.innerWidth * 0.96, 1400);
  const footerAllowance = getRemSize() * 4.2;
  const maxHeight = Math.max(220, window.innerHeight * 0.94 - footerAllowance);
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const targetWidth = Math.max(220, Math.round(width * scale));
  modalPanel.style.width = `${targetWidth}px`;
}

/**
 * @param {HTMLElement} mediaElement
 */
function sizeModalToRenderedMedia(mediaElement) {
  if (!modalPanel) {
    return;
  }

  requestAnimationFrame(() => {
    const rect = mediaElement.getBoundingClientRect();
    if (rect.width > 0) {
      modalPanel.style.width = `${Math.max(220, Math.round(rect.width))}px`;
    }
  });
}

function clearModalContent() {
  if (!modalContent) {
    return;
  }

  while (modalContent.firstChild) {
    modalContent.removeChild(modalContent.firstChild);
  }
}

export function closeMediaModal() {
  if (!modalRoot) {
    return;
  }

  modalRoot.classList.remove("is-open");
  document.body.classList.remove("modal-open");
  modalPanel?.style.removeProperty("width");
  clearModalContent();
}

function ensureModal() {
  if (modalRoot) {
    return;
  }

  modalRoot = document.createElement("div");
  modalRoot.className = "media-modal";
  modalRoot.setAttribute("role", "dialog");
  modalRoot.setAttribute("aria-modal", "true");
  modalRoot.setAttribute("aria-label", "Media viewer");

  modalPanel = document.createElement("div");
  modalPanel.className = "media-modal-panel";

  modalClose = document.createElement("button");
  modalClose.type = "button";
  modalClose.className = "media-modal-close";
  modalClose.setAttribute("aria-label", "Close media viewer");
  modalClose.textContent = "×";
  modalClose.addEventListener("click", () => {
    closeMediaModal();
  });

  modalContent = document.createElement("div");
  modalContent.className = "media-modal-content";

  modalFoot = document.createElement("div");
  modalFoot.className = "media-modal-foot";

  modalCaption = document.createElement("p");
  modalCaption.className = "media-modal-caption";

  modalFoot.append(modalCaption);
  modalPanel.append(modalContent, modalFoot, modalClose);
  modalRoot.append(modalPanel);
  document.body.append(modalRoot);

  modalRoot.addEventListener("click", (event) => {
    if (event.target === modalRoot) {
      closeMediaModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalRoot?.classList.contains("is-open")) {
      closeMediaModal();
    }
  });
}

/**
 * @param {{ type: string, url: string, previewUrl: string|null, description: string }} attachment
 */
export function openMediaModal(attachment) {
  ensureModal();

  if (!modalRoot || !modalContent || !modalCaption || !modalFoot) {
    return;
  }

  clearModalContent();

  const sourceUrl = attachment.url || attachment.previewUrl;
  if (!sourceUrl) {
    return;
  }

  if (attachment.type === "image") {
    const image = document.createElement("img");
    image.className = "media-modal-media";
    image.src = sourceUrl;
    image.alt = attachment.description || "Attachment image";
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      sizeModalToMedia(image.naturalWidth, image.naturalHeight);
    } else {
      image.addEventListener(
        "load",
        () => {
          sizeModalToMedia(image.naturalWidth, image.naturalHeight);
          sizeModalToRenderedMedia(image);
        },
        { once: true },
      );
    }
    modalContent.append(image);
    sizeModalToRenderedMedia(image);
  } else if (attachment.type === "video" || attachment.type === "gifv") {
    const video = document.createElement("video");
    video.className = "media-modal-media";
    video.controls = true;
    video.preload = "metadata";
    video.src = sourceUrl;
    video.addEventListener(
      "loadedmetadata",
      () => {
        sizeModalToMedia(video.videoWidth, video.videoHeight);
        sizeModalToRenderedMedia(video);
      },
      { once: true },
    );
    if (attachment.previewUrl) {
      video.poster = attachment.previewUrl;
    }
    modalContent.append(video);
    sizeModalToRenderedMedia(video);
  } else if (attachment.type === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = sourceUrl;
    modalContent.append(audio);
  } else {
    const link = document.createElement("a");
    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open attachment";
    modalContent.append(link);
    sizeModalToRenderedMedia(link);
  }

  if (attachment.description) {
    modalCaption.textContent = attachment.description;
    modalCaption.hidden = false;
  } else {
    modalCaption.textContent = "";
    modalCaption.hidden = true;
  }

  modalFoot.hidden = modalCaption.hidden;

  modalRoot.classList.add("is-open");
  document.body.classList.add("modal-open");
  if (attachment.type === "audio") {
    sizeModalToMedia(680, 120);
  }
  modalClose?.focus();
}
