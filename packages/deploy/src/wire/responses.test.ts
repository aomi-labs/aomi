import { describe, expect, it } from "vitest";
import { camelUserProject } from "./responses";

describe("project FFI wire validation", () => {
  it.each([null, undefined, "1", true, 0, -1, 1.5, NaN, Infinity])(
    "rejects invalid FFI values (%s)",
    (value) => {
      const project = camelUserProject({
        platform_name: "community",
        ffi_version: value,
        required_ffi_version: value,
        configuration: {
          status: "valid",
          applications: [{ ffi_version: value }],
        },
      });
      expect(project.ffiVersion).toBeNull();
      expect(project.requiredFfiVersion).toBeNull();
      expect(
        project.configuration?.status === "valid" &&
          project.configuration.applications[0].ffiVersion,
      ).toBeNull();
    },
  );
  it.each(["snake", "camel"])(
    "accepts positive integers from %s fields",
    (shape) => {
      const fields =
        shape === "snake"
          ? { ffi_version: 1, required_ffi_version: 2 }
          : { ffiVersion: 1, requiredFfiVersion: 2 };
      const project = camelUserProject({
        platform_name: "community",
        ...fields,
        configuration: { status: "valid", applications: [fields] },
      });
      expect(project.ffiVersion).toBe(1);
      expect(project.requiredFfiVersion).toBe(2);
      expect(
        project.configuration?.status === "valid" &&
          project.configuration.applications[0].ffiVersion,
      ).toBe(1);
    },
  );
});
