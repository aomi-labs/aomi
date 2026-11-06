import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createParaReviewStore,
  ParaTransactionReviewPrompt,
} from "./para-transaction-review";

const URL = "https://app.getpara.com/web/transaction-review?id=pending-1";

describe("Para transaction review prompt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays hidden until Para hands over a review page", () => {
    const store = createParaReviewStore();
    render(<ParaTransactionReviewPrompt store={store} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("takes focus when it appears and opens Para only from the click", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const store = createParaReviewStore();
    render(<ParaTransactionReviewPrompt store={store} />);

    act(() => store.set({ url: URL }));

    const button = screen.getByRole("button", { name: "Review in Para" });
    expect(document.activeElement).toBe(button);
    expect(open).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Open in new tab" }),
    ).toHaveProperty("href", URL);

    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      URL,
      "para-transaction-review",
      "popup=yes,width=550,height=750",
    );
  });

  it("disappears once signing ends", () => {
    const store = createParaReviewStore();
    render(<ParaTransactionReviewPrompt store={store} />);
    act(() => store.set({ url: URL }));
    act(() => store.set(null));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
