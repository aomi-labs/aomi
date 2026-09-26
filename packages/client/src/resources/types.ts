import type { components } from "../generated/agent-v1/types";

type Schemas = components["schemas"];

export type ResourceDescriptor = Schemas["ResourceDescriptor"];
export type ResourceList = Schemas["ResourceList"];
export type ResourceRead = Schemas["ResourceRead"];
export type ResourceView = Schemas["ResourceView"];
export type ListResourcesOptions = Schemas["ListResources"];
export type ReadResourceOptions = Omit<Schemas["ReadResource"], "uri"> & {
  signal?: AbortSignal;
};
