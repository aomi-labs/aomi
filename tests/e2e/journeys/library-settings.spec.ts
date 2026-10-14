import { test, expect } from "../journey-fixture";

test("Library and Settings reopen without rereading history or changing the conversation", async ({
  widget,
  agent,
}) => {
  await widget.sendAndSettle("library journey");
  await widget.input.fill("keep this draft");
  const mark = agent.mark();
  const catalogReads: string[] = [];
  widget.page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "GET" &&
      (/\/api\/public\/catalog\/(?:apps|skills)$/.test(path) ||
        /\/api\/(?:thread|account)\/(?:apps|skills)$/.test(path))
    )
      catalogReads.push(path);
  });
  for (const name of ["Open capability library", "Open settings"]) {
    for (let open = 0; open < 2; open++) {
      const readsBeforeOpen = catalogReads.length;
      if (name === "Open settings") {
        // Guest shells intentionally omit the account-only header opener. The
        // public host event opens the actual Settings modal and its real gate.
        await widget.page.evaluate(() =>
          window.dispatchEvent(
            new CustomEvent("aomi:open-settings", { detail: "general" }),
          ),
        );
      } else
        await widget.page.getByRole("button", { name, exact: true }).click();
      const dialog = widget.page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      if (name === "Open capability library") {
        const loading = dialog.getByRole("status", {
          name: "Loading library",
        });
        if (open === 1) await expect(loading).toHaveCount(0);
        await expect(loading).toBeHidden();
        await expect(dialog.getByRole("alert")).toHaveCount(0);
        if (open === 1) expect(catalogReads.slice(readsBeforeOpen)).toEqual([]);
      }
      if (name === "Open settings") {
        await expect(
          dialog.getByRole("navigation", { name: "Settings sections" }),
        ).toBeVisible();
        await dialog
          .getByRole("button", { name: "Account", exact: true })
          .click();
        await expect(
          dialog.getByRole("heading", { name: "Account", exact: true }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "Connect account", exact: true }),
        ).toBeVisible();
      }
      if (name === "Open settings")
        await dialog
          .getByRole("button", { name: "Close settings", exact: true })
          .click();
      else await widget.page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(widget.input).toHaveText("keep this draft");
    }
  }
  await expect(
    widget.replies.filter({ hasText: "Fake reply: library journey" }),
  ).toBeVisible();
  expect(
    agent
      .requestsSince(mark)
      .filter((request) =>
        ["chat.poll", "sessions.get", "chat.start"].includes(request.route),
      ),
  ).toEqual([]);
});
