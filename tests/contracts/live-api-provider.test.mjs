import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
for (const managerAvailable of [true, false]) {
  test(
    `live checker uses actual Backend and Manager providers (Manager available: ${managerAvailable})`,
    { timeout: 20000 },
    async () => {
      const fixture = (name) =>
        JSON.parse(
          readFileSync(
            `${root}/packages/client/src/test-fixtures/${name}.json`,
            "utf8",
          ),
        );
      const backend = fixture("backend-openapi"),
        manager = fixture("manager-openapi");
      for (const [path, methods] of Object.entries(manager.paths)) {
        for (const method of Object.keys(methods))
          delete backend.paths[path]?.[method];
        if (backend.paths[path] && !Object.keys(backend.paths[path]).length)
          delete backend.paths[path];
      }
      backend.paths["/api/unrelated-backend-addition"] = {
        get: { "x-aomi-auth": ["service"] },
      };
      const server = http.createServer((request, response) => {
        const document =
          request.url === "/api/openapi.json"
            ? backend
            : request.url === "/api/manager/openapi.json" && managerAvailable
              ? manager
              : null;
        response.writeHead(document ? 200 : 404, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify(document ?? {}));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const execution = await new Promise((resolve, reject) => {
          const child = spawn("pnpm", ["run", "test:openapi:live"], {
            cwd: root,
            signal: AbortSignal.timeout(15000),
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              AOMI_BACKEND_OPENAPI_URL: `http://127.0.0.1:${server.address().port}/api/openapi.json`,
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let output = "";
          child.stdout.on("data", (data) => (output += data));
          child.stderr.on("data", (data) => (output += data));
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, output }));
        });
        if (managerAvailable) assert.equal(execution.code, 0, execution.output);
        else {
          assert.notEqual(execution.code, 0);
          assert.match(execution.output, /manager\/openapi\.json HTTP 404/);
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );
}
