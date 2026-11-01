export function registerAppUpdates() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  let controlled = Boolean(navigator.serviceWorker.controller);
  let pending = false;
  let reloading = false;
  let registration: ServiceWorkerRegistration | undefined;
  const reloadWhenSafe = () => {
    if (!pending || reloading || document.visibilityState !== "visible") return;
    if (
      document
        .querySelector("#save-status")
        ?.getAttribute("data-save-state") !== "saved"
    )
      return;
    if (
      document.querySelector(
        '[role="dialog"], [role="listbox"], [data-editor-settings], [data-drag-floating], [aria-busy="true"]',
      )
    )
      return;
    if (
      document.activeElement?.matches(
        'input, textarea, [contenteditable="true"]',
      )
    )
      return;
    reloading = true;
    window.location.reload();
  };
  const observer = new MutationObserver(reloadWhenSafe);
  const controllerChanged = () => {
    if (controlled) {
      pending = true;
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-save-state", "aria-busy"],
      });
      reloadWhenSafe();
    }
    controlled = true;
  };
  const checkForUpdate = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      void registration?.update().catch(() => {});
      reloadWhenSafe();
    }
  };
  const focusLeft = () => queueMicrotask(reloadWhenSafe);
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    controllerChanged,
  );
  window.addEventListener("focus", checkForUpdate);
  window.addEventListener("pageshow", checkForUpdate);
  window.addEventListener("online", checkForUpdate);
  document.addEventListener("visibilitychange", checkForUpdate);
  document.addEventListener("focusout", focusLeft);
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, {
      updateViaCache: "none",
    })
    .then((result) => {
      registration = result;
      checkForUpdate();
    })
    .catch(() => {});
}
