// The manager's response shapes as zod schemas: the one definition of what the
// manager sends. Each schema reads the snake_case wire and outputs the camelCase
// type of the same name, which the package root exports for browser code
// without bringing zod along.
export * from "./deploy";
export * from "./projects";
export * from "./bots";
export * from "./operate";
export { list, maybe, timestampSeconds } from "./wire";
