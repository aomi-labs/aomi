import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  state: {
    appDescriptors: [
      { name: "default" },
      {
        name: "okx",
        applicationId: 42,
        label: "OKX",
        secrets: [
          { name: "OKX_API_KEY", description: "API key", required: true },
          { name: "OKX_API_SECRET", description: "API secret", required: true },
          {
            name: "OKX_PASSPHRASE",
            description: "Passphrase",
            required: false,
          },
        ],
      },
    ],
  },
  getCurrentThreadApp: vi.fn(() => "okx"),
  getCurrentThreadApplicationId: vi.fn((): number | null => 42),
  listAppSecrets: vi.fn(),
  saveAppSecrets: vi.fn(),
  deleteAppSecret: vi.fn(async () => true),
}));

vi.mock("@aomi-labs/react", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  useControl: () => control,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: {
    children: ReactNode;
    htmlFor?: string;
  }) => <label {...props}>{children}</label>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { AppSecretsDialog } from "./app-secrets-dialog";

const status = (overrides: Partial<Record<string, boolean>> = {}) => ({
  application_id: 42,
  app: "okx",
  slots: [
    {
      name: "OKX_API_KEY",
      description: "API key",
      required: true,
      configured: overrides.OKX_API_KEY ?? false,
      app_provided: false,
    },
    {
      name: "OKX_API_SECRET",
      description: "API secret",
      required: true,
      configured: overrides.OKX_API_SECRET ?? false,
      app_provided: false,
    },
    {
      name: "OKX_PASSPHRASE",
      description: "Passphrase",
      required: false,
      configured: false,
      app_provided: false,
    },
  ],
});

describe("AppSecretsDialog", () => {
  beforeEach(() => {
    control.getCurrentThreadApp.mockReturnValue("okx");
    control.getCurrentThreadApplicationId.mockReturnValue(42);
    control.listAppSecrets.mockReset();
    control.saveAppSecrets.mockReset();
    control.deleteAppSecret.mockClear();
  });

  it("renders nothing for an app that declares no secret slots", () => {
    control.getCurrentThreadApp.mockReturnValue("default");
    control.getCurrentThreadApplicationId.mockReturnValue(null);
    const { container } = render(<AppSecretsDialog />);
    expect(container).toBeEmptyDOMElement();
    expect(control.listAppSecrets).not.toHaveBeenCalled();
  });

  it("flags missing required keys and saves only the filled drafts", async () => {
    control.listAppSecrets.mockResolvedValueOnce(status());
    control.saveAppSecrets.mockResolvedValueOnce(
      status({ OKX_API_KEY: true, OKX_API_SECRET: true }),
    );
    render(<AppSecretsDialog />);

    await waitFor(() =>
      expect(screen.getByLabelText("OKX needs API keys")).toHaveAttribute(
        "data-app-secrets-state",
        "missing",
      ),
    );
    expect(control.listAppSecrets).toHaveBeenCalledWith(42);

    fireEvent.change(screen.getByLabelText("OKX_API_KEY"), {
      target: { value: " key-1 " },
    });
    fireEvent.change(screen.getByLabelText("OKX_API_SECRET"), {
      target: { value: "sec-1" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(control.saveAppSecrets).toHaveBeenCalledWith(42, {
        OKX_API_KEY: "key-1",
        OKX_API_SECRET: "sec-1",
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("OKX API keys")).toHaveAttribute(
        "data-app-secrets-state",
        "ok",
      ),
    );
    expect(screen.getAllByText("Saved")).toHaveLength(2);
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("removes a saved key and refetches", async () => {
    control.listAppSecrets
      .mockResolvedValueOnce(
        status({ OKX_API_KEY: true, OKX_API_SECRET: true }),
      )
      .mockResolvedValueOnce(status({ OKX_API_SECRET: true }));
    render(<AppSecretsDialog />);

    const remove = await screen.findByLabelText("Remove OKX_API_KEY");
    fireEvent.click(remove);

    await waitFor(() =>
      expect(control.deleteAppSecret).toHaveBeenCalledWith(42, "OKX_API_KEY"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("OKX needs API keys")).toHaveAttribute(
        "data-app-secrets-state",
        "missing",
      ),
    );
  });

  it("still opens with the declared slots when the status read fails", async () => {
    control.listAppSecrets.mockRejectedValueOnce(new Error("HTTP 401"));
    render(<AppSecretsDialog />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("HTTP 401"),
    );
    expect(screen.getByLabelText("OKX API keys")).toHaveAttribute(
      "data-app-secrets-state",
      "unknown",
    );
    expect(screen.getByLabelText("OKX_PASSPHRASE")).toBeInTheDocument();
  });
});
