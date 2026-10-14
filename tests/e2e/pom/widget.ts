import { expect, type Page, type Locator } from "@playwright/test";
import { testIds } from "../../../packages/widget/src/test-ids";

export class WidgetPage {
  constructor(readonly page: Page) {}
  get frame() {
    return this.page.getByTestId(testIds.frame).first();
  }
  get input() {
    return this.page.getByTestId(testIds.composerInput).first();
  }
  get send() {
    return this.page.getByTestId(testIds.send).first();
  }
  get stop() {
    return this.page.getByTestId(testIds.stop).first();
  }
  get replies() {
    return this.page.getByTestId(testIds.assistantMessage);
  }
  get userMessages() {
    return this.page.getByTestId(testIds.userMessage);
  }
  get rows() {
    return this.page.getByTestId(testIds.threadItem);
  }
  get trace() {
    return this.page.getByTestId(testIds.trace);
  }
  get messageList() {
    return this.page.getByTestId(testIds.messageList);
  }

  async ready() {
    await expect(this.frame).toBeVisible();
    await expect(this.input).toBeVisible();
  }
  async submit(prompt: string) {
    await this.input.fill(prompt);
    await expect(this.send).toBeEnabled();
    await this.send.click();
  }
  async sendAndSettle(prompt: string, answer = `Fake reply: ${prompt}`) {
    await this.submit(prompt);
    await expect(this.replies.filter({ hasText: answer })).toBeVisible();
    await expect(this.stop).toBeHidden();
  }
  async newChat() {
    await this.openSidebar();
    await this.page
      .getByTestId(testIds.newChat)
      .filter({ visible: true })
      .first()
      .click();
    await this.closeSidebar();
    await expect(this.input).toBeVisible();
  }
  async select(title: string) {
    await this.openSidebar();
    await this.rows
      .filter({ hasText: title })
      .getByRole("button")
      .first()
      .click();
    await this.closeSidebar();
  }
  async openSidebar() {
    if (
      !(await this.page
        .getByTestId(testIds.newChat)
        .filter({ visible: true })
        .count())
    ) {
      await this.page.getByTestId(testIds.sidebarToggle).first().click();
      await expect(this.page.getByTestId(testIds.mobileSheet)).toBeVisible();
    }
  }
  async closeSidebar() {
    const sheet = this.page.getByTestId(testIds.mobileSheet);
    if (await sheet.isVisible()) {
      await this.page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
  }
  async activate(target: Locator) {
    if (await this.page.evaluate(() => matchMedia("(hover: none)").matches)) {
      await target.tap();
    } else {
      await target.click();
    }
  }
  async options(title: string) {
    await this.openSidebar();
    const row = this.rows.filter({ hasText: title });
    const menu = row.getByTestId(testIds.threadItemMenu);
    if (await this.page.evaluate(() => matchMedia("(hover: none)").matches)) {
      // Real touch contexts cannot reveal a zero-width control by hovering.
      const sheet = this.page.getByTestId(testIds.mobileSheet);
      const sheetWasOpen = await sheet.isVisible();
      await expect(menu).toBeVisible();
      await expect
        .poll(async () => (await menu.boundingBox())?.width ?? 0)
        .toBeGreaterThan(0);
      await menu.tap();
      if (sheetWasOpen) await expect(sheet).toBeVisible();
    } else {
      await row.hover();
      await menu.click();
    }
  }
}
