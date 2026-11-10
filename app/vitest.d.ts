// Until Vitest is installed, `bun test` answers the tests' `vitest` imports; this lends them its types.
declare module "vitest" {
  export * from "bun:test";
}
