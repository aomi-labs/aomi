import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./journey-fixture";

// Explicitly local: key validation uses a disposable real Rust backend. Chat
// delivery uses the existing controlled Agent journey fixture (no paid model).
const fixturePath = process.env.PRIVATE_APP_FIXTURE_FILE;
if (!fixturePath)
  throw new Error(
    "PRIVATE_APP_FIXTURE_FILE is required for this local-only journey",
  );

test("Library validates and adds a private app, preserves duplicate access and sends its exact chat key", async ({
  widget,
  agent,
}, info) => {
  info.setTimeout(120_000);
  await expect
    .poll(
      async () => {
        try {
          return (
            await widget.page.request.get("http://127.0.0.1:3482/health", {
              timeout: 2000,
            })
          ).status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000 },
    )
    .toBe(200);
  const app = JSON.parse(await readFile(fixturePath!, "utf8")) as {
    name: string;
    label: string;
    applicationId: number;
    key: string;
  };
  const page = widget.page;
  const evidence = resolve("docs/review/issue-756");
  await mkdir(evidence, { recursive: true });
  const shot = async (name: string) => {
    const path = resolve(evidence, `${info.project.name}-${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(name, { path, contentType: "image/png" });
  };
  await page.route(/\/api\/thread\/apps\?resolve_key=true/, (route) => {
    const url = new URL(route.request().url());
    return route
      .fetch({ url: `http://127.0.0.1:3482${url.pathname}${url.search}` })
      .then((response) => route.fulfill({ response }));
  });
  const starts: {
    applicationId?: number;
    key: string | undefined;
    body: string;
  }[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/v1/agent/chat"
    ) {
      starts.push({
        applicationId: request.postDataJSON().applicationId,
        key: request.headers()["aomi-app-key"],
        body: request.postData() ?? "",
      });
    }
  });
  await expect(
    page.getByRole("button", { name: "Set App key", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open capability library", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Loading library" }),
  ).toBeHidden();
  await shot("library");
  await page
    .getByRole("button", { name: "Add private app", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog", { name: "Add private app" });
  await expect(dialog).toBeVisible();
  await shot("dialog");
  await dialog
    .getByLabel("App key", { exact: true })
    .fill("invalid-disposable-test-key");
  await dialog.getByRole("button", { name: "Add app", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "invalid or has been revoked",
  );
  await shot("invalid-key");
  await dialog.getByLabel("App key", { exact: true }).fill(app.key);
  await dialog.getByRole("button", { name: "Add app", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText(app.label);
  await expect(dialog.getByRole("status")).toContainText(
    `App #${app.applicationId}`,
  );
  await shot("added");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Library", exact: true });
  await expect(
    library.getByRole("button", {
      name: `Open ${app.label} details`,
      exact: true,
    }),
  ).toBeVisible();
  await shot("installed");
  await page
    .getByRole("button", { name: "Add private app", exact: true })
    .click();
  await dialog.getByLabel("App key", { exact: true }).fill(app.key);
  await dialog.getByRole("button", { name: "Add app", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Already in your Library",
  );
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    library.getByRole("button", {
      name: `Open ${app.label} details`,
      exact: true,
    }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Close library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add app, skill, or chain", exact: true })
    .click();
  const picker = page.getByRole("listbox", {
    name: "Apps, skills, and chains",
  });
  await picker.getByRole("option").filter({ hasText: app.label }).click();
  // Filling a contenteditable would erase the app chip; type beside it.
  await widget.input.pressSequentially("Confirm private app access");
  await widget.send.click();
  await expect(
    widget.replies.filter({
      hasText: "Confirm private app access",
    }),
  ).toBeVisible();
  await expect(widget.stop).toBeHidden();
  expect(starts.at(-1)?.body).toContain(`application:${app.applicationId}`);
  expect(starts.at(-1)?.key === app.key).toBe(true);
  expect(starts.at(-1)?.body.includes(app.key)).toBe(false);
  expect(agent.starts()).toHaveLength(1);
  await shot("chat");
  await widget.newChat();
  await widget.sendAndSettle("Public chat still works");
  expect(starts.at(-1)?.key).toBeUndefined();
});
