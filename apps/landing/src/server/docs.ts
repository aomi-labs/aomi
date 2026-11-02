import "@tanstack/react-start/server-only";
import { loader } from "fumadocs-core/source";
import {
  examples as examplePages,
  playground as playgroundPages,
} from "@/.source/server";

export const examples = loader({
  baseUrl: "/examples",
  source: examplePages.toFumadocsSource(),
});

export const playground = loader({
  baseUrl: "/playground",
  source: playgroundPages.toFumadocsSource(),
});
