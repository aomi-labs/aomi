import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { useProjectDetail } from "../../../hooks/use-project-detail";
import type { ProjectDeploymentAttempt } from "../../../attempts";
import { AttemptControls, DeploymentAttempts } from "./deployment-attempts";

type Detail = ReturnType<typeof useProjectDetail>;
function detail(branch?: string) {
  return {
    redeploySource: vi.fn(),
    attempts: {
      attempts: branch === undefined ? [] : [{ branch, conclusion: "failure" }],
      busy: false,
      isSuccess: true,
    },
  } as unknown as Detail;
}

function listDetail(attempt: Partial<ProjectDeploymentAttempt>) {
  return {
    redeploySource: vi.fn(),
    attempts: {
      attempts: [
        {
          id: 5,
          attempt: 1,
          commit: "abcdef123456",
          branch: "main",
          url: "https://github.com/a/b/actions/runs/5",
          createdAt: "2026-01-01T00:00:00Z",
          status: "completed",
          conclusion: "failure",
          ...attempt,
        },
      ],
      local: [],
      busy: false,
      isSuccess: true,
      failureCount: 0,
      cancelling: null,
      cancel: vi.fn(),
      loadDetail: vi.fn(),
    },
  } as unknown as Detail;
}

function job(name: string, startedAt: string | null) {
  return {
    id: 1,
    name,
    status: "in_progress",
    conclusion: null,
    startedAt,
    completedAt: null,
    url: "",
    steps: [],
  };
}

describe("deployment branch selection", () => {
  it("retries pinned-commit builds using the repository default branch", () => {
    const state = detail("");
    render(<AttemptControls detail={state} blocked={false} />);
    expect(screen.getByLabelText("Deployment branch")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Retry deployment" }));
    expect(state.redeploySource).toHaveBeenCalledWith("");
  });

  it("does not carry a previous project's branch into a project without attempts", () => {
    const { rerender } = render(
      <AttemptControls detail={detail("feature/previous")} blocked={false} />,
    );
    expect(screen.getByLabelText("Deployment branch")).toHaveValue(
      "feature/previous",
    );
    const next = detail();
    rerender(<AttemptControls detail={next} blocked={false} />);
    expect(screen.getByLabelText("Deployment branch")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(next.redeploySource).toHaveBeenCalledWith("");
  });
});

describe("attempt cards", () => {
  it("renders diagnostics and a retry for a failed attempt", () => {
    render(
      <DeploymentAttempts
        detail={listDetail({ diagnostics: ["error: build failed"], jobs: [] })}
      />,
    );
    expect(screen.getByText("error: build failed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry deployment" }),
    ).toBeInTheDocument();
  });

  it("hides cancel once Activate has started", () => {
    const running = { status: "in_progress", conclusion: null };
    const { rerender } = render(
      <DeploymentAttempts
        detail={listDetail({ ...running, jobs: [job("Build", "2026-01-01T00:00:10Z")] })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Cancel deployment" }),
    ).toBeInTheDocument();
    rerender(
      <DeploymentAttempts
        detail={listDetail({ ...running, jobs: [job("Activate", "2026-01-01T00:01:00Z")] })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel deployment" }),
    ).not.toBeInTheDocument();
  });
});
