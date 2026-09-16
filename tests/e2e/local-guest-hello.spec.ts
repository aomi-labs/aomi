import { expect, test, type Response } from "@playwright/test";

type EventPage = {
  events?: Array<{
    type?: string;
    sender?: string;
    content?: string;
    state?: string;
  }>;
};

test("fresh guest can send hello without returning to the start page", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  const pages: EventPage[] = [];
  const statuses: number[] = [];
  const responseTasks: Promise<void>[] = [];
  page.on("response", (response: Response) => {
    if (new URL(response.url()).pathname.startsWith("/v1/agent/chat")) {
      statuses.push(response.status());
    }
    if (
      response.status() === 200 &&
      new URL(response.url()).pathname.startsWith("/v1/agent/chat")
    ) {
      responseTasks.push(
        response
          .json()
          .then((body: EventPage) => pages.push(body))
          .catch(() => undefined),
      );
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });

  const input = page.getByRole("textbox", { name: "Message input" });
  await input.fill("hello");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect.poll(() => statuses, { timeout: 30_000 }).toContain(200);
  await expect(page.getByText("hello", { exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        await Promise.all(responseTasks);
        return pages
          .flatMap((entry) => entry.events ?? [])
          .some(
            (event) =>
              event.type === "message" &&
              event.sender === "agent" &&
              Boolean(event.content?.trim()),
          );
      },
      { timeout: 150_000 },
    )
    .toBe(true);
  await expect(page.getByText("hello", { exact: true })).toBeVisible();
});
