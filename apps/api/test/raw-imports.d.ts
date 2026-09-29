// `?raw` imports (Vite) used by web-shell-acceptance.test.ts to read wrangler.toml inside the workers pool.
declare module "*?raw" {
  const content: string;
  export default content;
}
