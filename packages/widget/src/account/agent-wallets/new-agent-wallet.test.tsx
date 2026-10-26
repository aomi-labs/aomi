import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import * as Dialog from "@radix-ui/react-dialog";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NewAgentWalletStep } from "./new-agent-wallet";

vi.mock("./use-refresh-wallets", () => ({
  useRefreshWallets: () => async () => undefined,
}));

let bodies: unknown[] = [];
beforeEach(() => {
  bodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        id: "g-1",
        name: "Agent wallet",
        created_at: 1,
        addresses: [],
        connections: [],
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStep() {
  const onDone = vi.fn();
  render(
    <Dialog.Root open>
      <Dialog.Content>
        <NewAgentWalletStep onDone={onDone} onClose={() => undefined} />
      </Dialog.Content>
    </Dialog.Root>,
  );
  return onDone;
}

const chain = (name: string) => screen.getByRole("radio", { name });
const create = () =>
  act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Create wallet" })),
  );

describe("New agent wallet", () => {
  it("creates EVM and SVM addresses by default", async () => {
    const onDone = renderStep();
    expect(chain("EVM + SVM")).toHaveAttribute("aria-checked", "true");
    await create();
    expect(bodies).toEqual([
      { name: "Agent wallet", families: ["evm", "svm"] },
    ]);
    expect(onDone).toHaveBeenCalled();
  });

  it("creates only the family picked", async () => {
    renderStep();
    fireEvent.click(chain("EVM"));
    expect(screen.getByText(/You get one EVM address,/)).toBeInTheDocument();
    await create();
    expect(bodies).toEqual([{ name: "Agent wallet", families: ["evm"] }]);
  });

  it("keeps the last family selected when it is clicked again", async () => {
    renderStep();
    fireEvent.click(chain("SVM"));
    fireEvent.click(chain("SVM"));
    expect(chain("SVM")).toHaveAttribute("aria-checked", "true");
    expect(
      screen
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);
    await create();
    expect(bodies).toEqual([{ name: "Agent wallet", families: ["svm"] }]);
  });
});
