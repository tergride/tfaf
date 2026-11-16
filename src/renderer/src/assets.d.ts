// Images and sounds imported from code resolve to the URL Vite gives the bundled file.

declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.svg' {
  const url: string;
  export default url;
}

declare module '*.jpg' {
  const url: string;
  export default url;
}

declare module '*.mp3' {
  const url: string;
  export default url;
}

declare module '*.ogg' {
  const url: string;
  export default url;
}

// The one form of Vite's import.meta.glob the renderer uses, without pulling in all of vite/client.
interface ImportMeta {
  glob<T>(pattern: string, options: { eager: true; import: 'default' }): Record<string, T>;
}
