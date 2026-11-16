/** Opens an https link in the system browser; the main process refuses anything else. */
export function openExternal(url: string): void {
  window.tfaf.openExternal(url).catch((error: unknown) => console.warn('Link could not be opened', error));
}
