import type { FC, SVGProps } from "react";
import {
  AnthropicIcon,
  CohereIcon,
  DeepSeekIcon,
  GLMIcon,
  GoogleIcon,
  KimiIcon,
  MetaIcon,
  MistralIcon,
  OpenAIIcon,
  XAIIcon,
} from "./vendors";

const VENDOR_ICONS: Record<string, FC<SVGProps<SVGSVGElement>>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  meta: MetaIcon,
  mistral: MistralIcon,
  deepseek: DeepSeekIcon,
  xai: XAIIcon,
  cohere: CohereIcon,
  moonshot: KimiIcon,
  glm: GLMIcon,
};

/**
 * Get the icon component for a vendor ID.
 * Returns undefined for unknown vendors.
 */
export function getVendorIcon(
  vendorId: string,
): FC<SVGProps<SVGSVGElement>> | undefined {
  return VENDOR_ICONS[vendorId];
}
