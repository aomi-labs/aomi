export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  file: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: "ignore" | "inherit" | "pipe";
    onOutput?: (chunk: {
      stream: "stdout" | "stderr";
      data: string;
      command: string;
    }) => void;
  },
) => Promise<CommandResult>;

export type ResolvedBinaries = {
  aomiBuild: string;
  aomiRun: string;
  sdkRoot: string;
  source: "runner-image" | "fresh-cargo-build" | "stale-target-fallback" | "path-fallback";
  warning?: string;
};
