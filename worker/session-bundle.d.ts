declare module "virtual:session-server" {
  /** The bundled session server (scripts/build-session.ts) and its content-hash loader id. */
  const bundle: { code: string; id: string };
  export default bundle;
}
