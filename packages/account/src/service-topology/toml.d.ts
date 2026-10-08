// Minimal types for the dependency-light `toml` (v3, CommonJS, parse-only).
declare module "toml" {
  export function parse(input: string): unknown;
}
