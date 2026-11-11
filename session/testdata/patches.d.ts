// The fixtures, read as text by Vite in patch.test.ts.
declare module "*.patch?raw" {
  const text: string;
  export default text;
}
