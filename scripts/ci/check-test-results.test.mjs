import { describe, expect, it } from "vitest";
import { verifyTestReport } from "./check-test-results.mjs";
const unit = (
  status,
  title = "critical auth flow",
  name = "/repo/packages/client/test/session.test.ts",
) => ({ testResults: [{ name, assertionResults: [{ status, title }] }] });
describe("critical result gate", () => {
  it("rejects every unexpected unit skip, todo and failure", () => {
    for (const status of ["pending", "skipped", "todo", "failed"])
      expect(() => verifyTestReport(unit(status))).toThrow();
    expect(() => verifyTestReport(unit("passed"))).not.toThrow();
    expect(() => verifyTestReport({ testResults: [] })).toThrow();
  });
  it("allows only the exact declared noncritical settlement skip alongside passing tests", () => {
    const report = unit(
      "pending",
      "deduplicates a recipient-bucket settlement shared by two projects",
      "/repo/apps/build/src/server/bff/operate/routes.test.ts",
    );
    report.testResults.push(...unit("passed").testResults);
    expect(() => verifyTestReport(report)).not.toThrow();
    report.testResults[0].name = "/repo/packages/client/test/session.test.ts";
    expect(() => verifyTestReport(report)).toThrow();
  });
  it("fails flaky browser retries even when their final attempt passes", () => {
    const stats = { expected: 14, unexpected: 0, skipped: 0, flaky: 0 };
    expect(() => verifyTestReport({ stats }, 14)).not.toThrow();
    for (const field of ["skipped", "flaky", "unexpected"])
      expect(() =>
        verifyTestReport({ stats: { ...stats, [field]: 1 } }),
      ).toThrow();
    expect(() => verifyTestReport({ stats }, 15)).toThrow();
  });
});
