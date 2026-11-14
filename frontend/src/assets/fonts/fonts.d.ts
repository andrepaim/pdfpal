// The bundled Inter font resolves to a URL in both bundlers that build the figure code: Vite (the web app) and esbuild's
// file loader (the Chrome extension). Declared by exact file name so it does not clash with vite/client's '*.woff2'.
declare module '*/inter-latin-wght-normal.woff2' {
  const url: string
  export default url
}
