/** Wrangler `[[rules]] type = "Data"` imports binary assets as ArrayBuffer. */
declare module "*.woff2" {
  const data: ArrayBuffer;
  export default data;
}
