import { z } from "zod";

/**
 * A deploy platform slug. Partner names are deliberately not enumerated in
 * edge config: this only checks the shape, and the manager's exact lookup
 * decides whether the platform exists.
 */
export const platform = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
