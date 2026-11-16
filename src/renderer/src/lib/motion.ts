// The launcher's animation setting. It marks the root element, and styles.css stills the interface under the mark;
// until the settings answer, animations stay on.
let enabled = true;

function apply(): void {
  if (enabled) {
    delete document.documentElement.dataset.animations;
  } else {
    document.documentElement.dataset.animations = 'off';
  }
}

window.tfaf.settings.get().then(
  (settings) => setAnimations(settings.animations),
  () => undefined,
);

/** Applies the setting saved in the settings. */
export function setAnimations(value: boolean): void {
  enabled = value;
  apply();
}

/** For motion the styles cannot reach, such as scrolling to an element. */
export function animationsEnabled(): boolean {
  return enabled;
}
