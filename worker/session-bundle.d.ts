declare module "virtual:session-server" {
  /** The bundled session server (scripts/build-session.ts) and its content-hash loader id. */
  const bundle: { code: string; id: string };
  export default bundle;
}

// What Vite gives the Worker code here, without its DOM-flavoured client types.
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
  /** `import.meta.glob`, in the one form examples/self uses. */
  glob<T>(
    patterns: string[],
    options: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, T>;
}
