/// <reference types="vite/client" />
declare module "virtual:aomi-research-files" {
 const entries: Array<{path: string; isDirectory: boolean; size: number | null}>;
 export default entries;
}
