import { z } from 'zod';
import { ListDeploymentRecordsInput, ListDeploymentRecordsResult, PromoteInput, PromoteResult } from '@aomi-labs/deploy';
import { AgentLike, CreateSmithersApi, SmithersEvent, RunResult } from 'smithers-orchestrator';

type CommandResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};
type CommandRunner = (file: string, args: string[], options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: "ignore" | "inherit" | "pipe";
    onOutput?: (chunk: {
        stream: "stdout" | "stderr";
        data: string;
        command: string;
    }) => void;
}) => Promise<CommandResult>;
type ResolvedBinaries = {
    aomiBuild: string;
    aomiRun: string;
    sdkRoot: string;
    source: "fresh-cargo-build" | "stale-target-fallback" | "path-fallback";
    warning?: string;
};

/**
 * Crate artifact packaging for the result phase. The generated app's file
 * tree and a small tarball ride the durable result row, so surfaces that
 * cannot see the run's filesystem (the web BFF observing a sandbox run)
 * still serve real Files and Download.
 */
type CrateFileNode = {
    path: string;
    type: "file" | "folder";
    children?: CrateFileNode[];
};
/** The generated crate as a display tree. Paths are prefixed with the app
 *  name ("<app>/src/tool.rs") — the shape the /build page renders. */
declare function crateFileTree(appDir: string, app: string): CrateFileNode[];
type CrateArtifact = {
    /** JSON-encoded CrateFileNode[]; "" when the crate directory is absent. */
    fileTreeJson: string;
    /** Base64 .tar.gz of apps/<app> (target/ and Cargo.lock excluded); "" when
     *  packaging failed or the crate exceeds the embed cap. */
    crateTarB64: string;
    /** Human-readable reason whenever crateTarB64 is empty. */
    warning: string;
};
declare function packageCrate(options: {
    sdkRoot: string;
    app: string;
    runner?: CommandRunner;
}): Promise<CrateArtifact>;

declare const defaultRunner: CommandRunner;
declare function defaultSdkRoot(cwd?: string): string;
declare function targetBinaryPaths(sdkRoot: string): Pick<ResolvedBinaries, "aomiBuild" | "aomiRun">;
type SdkFreshness = {
    /** HEAD after any sync, or null when the checkout is not a git repo. */
    headSha: string | null;
    action: "up-to-date" | "fast-forwarded" | "not-git" | "fetch-failed" | "stale-dirty" | "stale-diverged";
    warning?: string;
};
/**
 * Guarantee the SDK checkout matches GitHub before binaries are built from it:
 * fetch origin, and fast-forward a clean checkout that is strictly behind.
 * Anything that prevents the guarantee (no git, offline, dirty tree, local
 * commits) throws unless `allowStale` — binaries must not silently lag origin.
 */
declare function ensureFreshSdkCheckout(sdkRoot: string, runner?: CommandRunner, options?: {
    allowStale?: boolean;
}): Promise<SdkFreshness>;
declare function resolveAomiBinaries(sdkRoot: string, runner?: CommandRunner, options?: {
    allowStale?: boolean;
}): Promise<ResolvedBinaries>;
/** Freshness + build in one step: sync the checkout with GitHub, then build
 *  binaries from it. This is the only binaries entry point the workflow uses. */
declare function resolveFreshAomiBinaries(sdkRoot: string, runner?: CommandRunner, options?: {
    allowStale?: boolean;
}): Promise<ResolvedBinaries & {
    freshness: SdkFreshness;
}>;

type AomiBuildCommand = "gen-specs" | "gen-client" | "gen-tool" | "new-app" | "compile" | "deploy" | "status" | "activate";
declare function runAomiBuild(binaries: ResolvedBinaries, command: AomiBuildCommand, args?: string[], runner?: CommandRunner, env?: NodeJS.ProcessEnv): Promise<CommandResult>;
declare function runAomiRun(binaries: ResolvedBinaries, pluginPath: string, args?: string[], runner?: CommandRunner): Promise<CommandResult>;
declare function runAppCargoChecks(sdkRoot: string, app: string, runner?: CommandRunner): Promise<CommandResult>;
declare function newAppArgs(input: {
    app: string;
    source: "discover" | "url" | "existing";
    openApiUrl?: string;
    shared: boolean;
    includeAllOperations: boolean;
    force: boolean;
    build: boolean;
}): string[];
type ActivationCredential = {
    source: "flag" | "env" | "config";
    token: string;
};
declare function activationConfigPath(env?: NodeJS.ProcessEnv): string;
declare function resolveActivationCredential(options?: {
    activationToken?: string;
    env?: NodeJS.ProcessEnv;
    configPath?: string;
}): Promise<ActivationCredential | null>;
declare function pluginLibraryFileName(manifestName: string, platform?: NodeJS.Platform): string;

declare const WORKFLOW_NAME = "aomi-app-from-scratch";
declare const clarifyOptionSchema: z.ZodObject<{
    key: z.ZodString;
    label: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type ClarifyOption = z.infer<typeof clarifyOptionSchema>;
/** Deterministic command steps. Each op maps to one step function and one
 *  output table; ops are the only things allowed to touch the shell. */
declare const computeOpSchema: z.ZodEnum<{
    deploy: "deploy";
    binaries: "binaries";
    codegen: "codegen";
    validate: "validate";
    smoke: "smoke";
    result: "result";
}>;
type ComputeOp = z.infer<typeof computeOpSchema>;
/** LLM roles. curate/review/fix are the classic trio; research, draft-spec,
 *  and synthesize exist for spec-less targets; design proposes an integration
 *  (e.g. APIs to add to an external service) — typically in a cross-repo agent. */
declare const agentRoleSchema: z.ZodEnum<{
    curate: "curate";
    review: "review";
    fix: "fix";
    research: "research";
    "draft-spec": "draft-spec";
    synthesize: "synthesize";
    design: "design";
}>;
type AgentRole = z.infer<typeof agentRoleSchema>;
declare const computePhaseSchema: z.ZodObject<{
    kind: z.ZodLiteral<"compute">;
    id: z.ZodString;
    op: z.ZodEnum<{
        deploy: "deploy";
        binaries: "binaries";
        codegen: "codegen";
        validate: "validate";
        smoke: "smoke";
        result: "result";
    }>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const agentPhaseSchema: z.ZodObject<{
    kind: z.ZodLiteral<"agent">;
    id: z.ZodString;
    role: z.ZodEnum<{
        curate: "curate";
        review: "review";
        fix: "fix";
        research: "research";
        "draft-spec": "draft-spec";
        synthesize: "synthesize";
        design: "design";
    }>;
    agent: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    brief: z.ZodOptional<z.ZodString>;
    repo: z.ZodOptional<z.ZodString>;
    onlyIf: z.ZodOptional<z.ZodEnum<{
        "prev-red": "prev-red";
        "prev-eval-fail": "prev-eval-fail";
    }>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** A human question the run pauses on. Renders as a select-mode Smithers
 *  approval: durable, answerable from the TUI or the browser console, and the
 *  `{selected, notes}` decision becomes context for later phases. */
declare const clarifyPhaseSchema: z.ZodObject<{
    kind: z.ZodLiteral<"clarify">;
    id: z.ZodString;
    question: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    options: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const gatePhaseSchema: z.ZodObject<{
    kind: z.ZodLiteral<"gate">;
    id: z.ZodString;
    title: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** A behavioral eval: run the compiled plugin against a scenario prompt, then
 *  score the transcript against a rubric with an LLM judge. Produces a metric
 *  and a pass/fail against `threshold` — the exit signal for an `eval-pass`
 *  loop. Generalizes smoke from "did it run" to "did it do the right thing". */
declare const evalPhaseSchema: z.ZodObject<{
    kind: z.ZodLiteral<"eval">;
    id: z.ZodString;
    scenario: z.ZodString;
    rubric: z.ZodString;
    threshold: z.ZodDefault<z.ZodNumber>;
    judge: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type EvalPhase = z.infer<typeof evalPhaseSchema>;
type AgentPhase = z.infer<typeof agentPhaseSchema>;
declare const innerPhaseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"compute">;
    id: z.ZodString;
    op: z.ZodEnum<{
        deploy: "deploy";
        binaries: "binaries";
        codegen: "codegen";
        validate: "validate";
        smoke: "smoke";
        result: "result";
    }>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"agent">;
    id: z.ZodString;
    role: z.ZodEnum<{
        curate: "curate";
        review: "review";
        fix: "fix";
        research: "research";
        "draft-spec": "draft-spec";
        synthesize: "synthesize";
        design: "design";
    }>;
    agent: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    brief: z.ZodOptional<z.ZodString>;
    repo: z.ZodOptional<z.ZodString>;
    onlyIf: z.ZodOptional<z.ZodEnum<{
        "prev-red": "prev-red";
        "prev-eval-fail": "prev-eval-fail";
    }>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"clarify">;
    id: z.ZodString;
    question: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    options: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"gate">;
    id: z.ZodString;
    title: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"eval">;
    id: z.ZodString;
    scenario: z.ZodString;
    rubric: z.ZodString;
    threshold: z.ZodDefault<z.ZodNumber>;
    judge: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "kind">;
type InnerPhase = z.infer<typeof innerPhaseSchema>;
/**
 * A bounded retry loop. `until` names the persisted exit predicate
 * (validation green, or an eval scoring at/above its threshold). `onMax`
 * governs the tail: "fail" aborts the run; "return-last" stops gracefully and
 * lets the composition continue — pair it with a following clarify/gate to
 * escalate the decision to the human instead of hard-failing.
 */
declare const loopPhaseSchema: z.ZodObject<{
    kind: z.ZodLiteral<"loop">;
    id: z.ZodString;
    until: z.ZodEnum<{
        "validation-green": "validation-green";
        "eval-pass": "eval-pass";
    }>;
    maxRounds: z.ZodDefault<z.ZodNumber>;
    onMax: z.ZodOptional<z.ZodEnum<{
        fail: "fail";
        "return-last": "return-last";
    }>>;
    body: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"compute">;
        id: z.ZodString;
        op: z.ZodEnum<{
            deploy: "deploy";
            binaries: "binaries";
            codegen: "codegen";
            validate: "validate";
            smoke: "smoke";
            result: "result";
        }>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"agent">;
        id: z.ZodString;
        role: z.ZodEnum<{
            curate: "curate";
            review: "review";
            fix: "fix";
            research: "research";
            "draft-spec": "draft-spec";
            synthesize: "synthesize";
            design: "design";
        }>;
        agent: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        brief: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        onlyIf: z.ZodOptional<z.ZodEnum<{
            "prev-red": "prev-red";
            "prev-eval-fail": "prev-eval-fail";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"clarify">;
        id: z.ZodString;
        question: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        options: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            label: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"gate">;
        id: z.ZodString;
        title: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"eval">;
        id: z.ZodString;
        scenario: z.ZodString;
        rubric: z.ZodString;
        threshold: z.ZodDefault<z.ZodNumber>;
        judge: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "kind">>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Fan-out: every branch runs concurrently (each branch is its own sequence),
 *  and the composition waits for all branches before the next phase. For
 *  independent work — researching several protocols, building several venues —
 *  where branches don't write the same files. */
declare const parallelPhaseSchema: z.ZodObject<{
    kind: z.ZodLiteral<"parallel">;
    id: z.ZodString;
    branches: z.ZodArray<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"compute">;
        id: z.ZodString;
        op: z.ZodEnum<{
            deploy: "deploy";
            binaries: "binaries";
            codegen: "codegen";
            validate: "validate";
            smoke: "smoke";
            result: "result";
        }>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"agent">;
        id: z.ZodString;
        role: z.ZodEnum<{
            curate: "curate";
            review: "review";
            fix: "fix";
            research: "research";
            "draft-spec": "draft-spec";
            synthesize: "synthesize";
            design: "design";
        }>;
        agent: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        brief: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        onlyIf: z.ZodOptional<z.ZodEnum<{
            "prev-red": "prev-red";
            "prev-eval-fail": "prev-eval-fail";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"clarify">;
        id: z.ZodString;
        question: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        options: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            label: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"gate">;
        id: z.ZodString;
        title: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"eval">;
        id: z.ZodString;
        scenario: z.ZodString;
        rubric: z.ZodString;
        threshold: z.ZodDefault<z.ZodNumber>;
        judge: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "kind">>>;
    maxConcurrency: z.ZodOptional<z.ZodNumber>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** A durable pause for work that happens OUTSIDE this run — a human building
 *  the other side of an integration, an external CI, a partner's deploy. The
 *  run parks (durably, across restarts) until a signal arrives: a human in the
 *  TUI/console, or any external system POSTing to the console's signal
 *  endpoint / the `aomi-smither signal` CLI. Optional deadline. */
declare const waitExternalPhaseSchema: z.ZodObject<{
    kind: z.ZodLiteral<"wait-external">;
    id: z.ZodString;
    waitingFor: z.ZodString;
    timeoutHours: z.ZodOptional<z.ZodNumber>;
    onTimeout: z.ZodOptional<z.ZodEnum<{
        fail: "fail";
        continue: "continue";
    }>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const phaseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"compute">;
    id: z.ZodString;
    op: z.ZodEnum<{
        deploy: "deploy";
        binaries: "binaries";
        codegen: "codegen";
        validate: "validate";
        smoke: "smoke";
        result: "result";
    }>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"agent">;
    id: z.ZodString;
    role: z.ZodEnum<{
        curate: "curate";
        review: "review";
        fix: "fix";
        research: "research";
        "draft-spec": "draft-spec";
        synthesize: "synthesize";
        design: "design";
    }>;
    agent: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    brief: z.ZodOptional<z.ZodString>;
    repo: z.ZodOptional<z.ZodString>;
    onlyIf: z.ZodOptional<z.ZodEnum<{
        "prev-red": "prev-red";
        "prev-eval-fail": "prev-eval-fail";
    }>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"clarify">;
    id: z.ZodString;
    question: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    options: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"gate">;
    id: z.ZodString;
    title: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"eval">;
    id: z.ZodString;
    scenario: z.ZodString;
    rubric: z.ZodString;
    threshold: z.ZodDefault<z.ZodNumber>;
    judge: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"loop">;
    id: z.ZodString;
    until: z.ZodEnum<{
        "validation-green": "validation-green";
        "eval-pass": "eval-pass";
    }>;
    maxRounds: z.ZodDefault<z.ZodNumber>;
    onMax: z.ZodOptional<z.ZodEnum<{
        fail: "fail";
        "return-last": "return-last";
    }>>;
    body: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"compute">;
        id: z.ZodString;
        op: z.ZodEnum<{
            deploy: "deploy";
            binaries: "binaries";
            codegen: "codegen";
            validate: "validate";
            smoke: "smoke";
            result: "result";
        }>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"agent">;
        id: z.ZodString;
        role: z.ZodEnum<{
            curate: "curate";
            review: "review";
            fix: "fix";
            research: "research";
            "draft-spec": "draft-spec";
            synthesize: "synthesize";
            design: "design";
        }>;
        agent: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        brief: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        onlyIf: z.ZodOptional<z.ZodEnum<{
            "prev-red": "prev-red";
            "prev-eval-fail": "prev-eval-fail";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"clarify">;
        id: z.ZodString;
        question: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        options: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            label: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"gate">;
        id: z.ZodString;
        title: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"eval">;
        id: z.ZodString;
        scenario: z.ZodString;
        rubric: z.ZodString;
        threshold: z.ZodDefault<z.ZodNumber>;
        judge: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "kind">>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"parallel">;
    id: z.ZodString;
    branches: z.ZodArray<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"compute">;
        id: z.ZodString;
        op: z.ZodEnum<{
            deploy: "deploy";
            binaries: "binaries";
            codegen: "codegen";
            validate: "validate";
            smoke: "smoke";
            result: "result";
        }>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"agent">;
        id: z.ZodString;
        role: z.ZodEnum<{
            curate: "curate";
            review: "review";
            fix: "fix";
            research: "research";
            "draft-spec": "draft-spec";
            synthesize: "synthesize";
            design: "design";
        }>;
        agent: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        brief: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        onlyIf: z.ZodOptional<z.ZodEnum<{
            "prev-red": "prev-red";
            "prev-eval-fail": "prev-eval-fail";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"clarify">;
        id: z.ZodString;
        question: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        options: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            label: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"gate">;
        id: z.ZodString;
        title: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"eval">;
        id: z.ZodString;
        scenario: z.ZodString;
        rubric: z.ZodString;
        threshold: z.ZodDefault<z.ZodNumber>;
        judge: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "kind">>>;
    maxConcurrency: z.ZodOptional<z.ZodNumber>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"wait-external">;
    id: z.ZodString;
    waitingFor: z.ZodString;
    timeoutHours: z.ZodOptional<z.ZodNumber>;
    onTimeout: z.ZodOptional<z.ZodEnum<{
        fail: "fail";
        continue: "continue";
    }>>;
    label: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "kind">;
type Phase = z.infer<typeof phaseSchema>;
/**
 * The contract between the intent conversation and the Smithers workflow.
 * The chat distills user intent into this plan; `buildAppWorkflow` renders
 * the task graph from `resolveComposition(plan)`. Everything the workflow's
 * shape depends on lives here so the composed graph is a pure function of
 * (plan, persisted state).
 */
declare const buildPlanSchema: z.ZodObject<{
    app: z.ZodString;
    sdkRoot: z.ZodString;
    source: z.ZodDefault<z.ZodEnum<{
        discover: "discover";
        url: "url";
        existing: "existing";
    }>>;
    openApiUrl: z.ZodOptional<z.ZodString>;
    userStory: z.ZodDefault<z.ZodString>;
    shared: z.ZodDefault<z.ZodBoolean>;
    force: z.ZodDefault<z.ZodBoolean>;
    build: z.ZodDefault<z.ZodBoolean>;
    builder: z.ZodDefault<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        none: "none";
    }>>;
    review: z.ZodDefault<z.ZodBoolean>;
    reviewer: z.ZodDefault<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    maxFixRounds: z.ZodDefault<z.ZodNumber>;
    smoke: z.ZodDefault<z.ZodBoolean>;
    smokePrompt: z.ZodDefault<z.ZodString>;
    deploy: z.ZodDefault<z.ZodBoolean>;
    deployPath: z.ZodOptional<z.ZodString>;
    deployAomiToml: z.ZodOptional<z.ZodString>;
    deployPlatform: z.ZodOptional<z.ZodString>;
    autoApprove: z.ZodDefault<z.ZodBoolean>;
    allowStaleSdk: z.ZodDefault<z.ZodBoolean>;
    phases: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"compute">;
        id: z.ZodString;
        op: z.ZodEnum<{
            deploy: "deploy";
            binaries: "binaries";
            codegen: "codegen";
            validate: "validate";
            smoke: "smoke";
            result: "result";
        }>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"agent">;
        id: z.ZodString;
        role: z.ZodEnum<{
            curate: "curate";
            review: "review";
            fix: "fix";
            research: "research";
            "draft-spec": "draft-spec";
            synthesize: "synthesize";
            design: "design";
        }>;
        agent: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        brief: z.ZodOptional<z.ZodString>;
        repo: z.ZodOptional<z.ZodString>;
        onlyIf: z.ZodOptional<z.ZodEnum<{
            "prev-red": "prev-red";
            "prev-eval-fail": "prev-eval-fail";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"clarify">;
        id: z.ZodString;
        question: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        options: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            label: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"gate">;
        id: z.ZodString;
        title: z.ZodString;
        summary: z.ZodOptional<z.ZodString>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"eval">;
        id: z.ZodString;
        scenario: z.ZodString;
        rubric: z.ZodString;
        threshold: z.ZodDefault<z.ZodNumber>;
        judge: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"loop">;
        id: z.ZodString;
        until: z.ZodEnum<{
            "validation-green": "validation-green";
            "eval-pass": "eval-pass";
        }>;
        maxRounds: z.ZodDefault<z.ZodNumber>;
        onMax: z.ZodOptional<z.ZodEnum<{
            fail: "fail";
            "return-last": "return-last";
        }>>;
        body: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"compute">;
            id: z.ZodString;
            op: z.ZodEnum<{
                deploy: "deploy";
                binaries: "binaries";
                codegen: "codegen";
                validate: "validate";
                smoke: "smoke";
                result: "result";
            }>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"agent">;
            id: z.ZodString;
            role: z.ZodEnum<{
                curate: "curate";
                review: "review";
                fix: "fix";
                research: "research";
                "draft-spec": "draft-spec";
                synthesize: "synthesize";
                design: "design";
            }>;
            agent: z.ZodOptional<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
            }>>;
            brief: z.ZodOptional<z.ZodString>;
            repo: z.ZodOptional<z.ZodString>;
            onlyIf: z.ZodOptional<z.ZodEnum<{
                "prev-red": "prev-red";
                "prev-eval-fail": "prev-eval-fail";
            }>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"clarify">;
            id: z.ZodString;
            question: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
            options: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                label: z.ZodString;
                summary: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"gate">;
            id: z.ZodString;
            title: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"eval">;
            id: z.ZodString;
            scenario: z.ZodString;
            rubric: z.ZodString;
            threshold: z.ZodDefault<z.ZodNumber>;
            judge: z.ZodOptional<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
            }>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "kind">>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"parallel">;
        id: z.ZodString;
        branches: z.ZodArray<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"compute">;
            id: z.ZodString;
            op: z.ZodEnum<{
                deploy: "deploy";
                binaries: "binaries";
                codegen: "codegen";
                validate: "validate";
                smoke: "smoke";
                result: "result";
            }>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"agent">;
            id: z.ZodString;
            role: z.ZodEnum<{
                curate: "curate";
                review: "review";
                fix: "fix";
                research: "research";
                "draft-spec": "draft-spec";
                synthesize: "synthesize";
                design: "design";
            }>;
            agent: z.ZodOptional<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
            }>>;
            brief: z.ZodOptional<z.ZodString>;
            repo: z.ZodOptional<z.ZodString>;
            onlyIf: z.ZodOptional<z.ZodEnum<{
                "prev-red": "prev-red";
                "prev-eval-fail": "prev-eval-fail";
            }>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"clarify">;
            id: z.ZodString;
            question: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
            options: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                label: z.ZodString;
                summary: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"gate">;
            id: z.ZodString;
            title: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"eval">;
            id: z.ZodString;
            scenario: z.ZodString;
            rubric: z.ZodString;
            threshold: z.ZodDefault<z.ZodNumber>;
            judge: z.ZodOptional<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
            }>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "kind">>>;
        maxConcurrency: z.ZodOptional<z.ZodNumber>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        kind: z.ZodLiteral<"wait-external">;
        id: z.ZodString;
        waitingFor: z.ZodString;
        timeoutHours: z.ZodOptional<z.ZodNumber>;
        onTimeout: z.ZodOptional<z.ZodEnum<{
            fail: "fail";
            continue: "continue";
        }>>;
        label: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "kind">>>;
}, z.core.$strip>;
type BuildPlan = z.infer<typeof buildPlanSchema>;
/** Stable Smithers node id for an app stage. Resume depends on these never
 *  changing shape, so derive them from data only. */
declare function nodeId(app: string, stage: string): string;
/** The flag-driven pipeline as a composition. Ids match the pre-composition
 *  workflow exactly, so existing run state resumes cleanly. */
declare function classicComposition(plan: BuildPlan): Phase[];
/** The composition the workflow renders: the composed phases when the intent
 *  agent proposed them, else the classic pipeline. A trailing `result` compute
 *  phase is guaranteed so every run summarizes. */
declare function resolveComposition(plan: BuildPlan): Phase[];
/** The inner phases a container holds (loop body / parallel branches), or the
 *  phase itself for leaves. Top-level-only phases (wait-external) hold nothing
 *  to descend into. Used to walk a composition uniformly. */
declare function innerPhasesOf(phase: Phase): InnerPhase[];
/** Structural problems in a composed phase list — surfaced at finalize time
 *  so the TUI can bounce them back into the conversation. */
declare function compositionIssues(plan: BuildPlan): string[];
type PlanStage = {
    id: string;
    label: string;
    kind: "compute" | "agent" | "loop" | "approval" | "clarify" | "eval" | "parallel" | "wait-external";
    /** Clarify metadata rides along so every surface (TUI, browser console) can
     *  render the options without a second data path. */
    clarify?: {
        question: string;
        summary?: string;
        options: ClarifyOption[];
    };
    /** Set on rows that are one branch of a parallel phase, so surfaces can
     *  indent/group them under the fan-out. */
    branchOf?: string;
};
declare function phaseAgent(plan: BuildPlan, phase: {
    role: AgentRole;
    agent?: "claude" | "codex";
}): "claude" | "codex";
/** Working directory for an agent phase: its cross-repo `repo` (resolved
 *  against the process cwd) when set, else the SDK checkout. */
declare function resolveAgentCwd(plan: BuildPlan, repo?: string): string;
/** The distinct (agent, cwd) pairs the workflow will instantiate — one CLI
 *  agent per pair. Pure, so cross-repo wiring is testable without running an
 *  agent: a `design` phase with `repo` set yields a spec whose cwd is that
 *  repo, separate from same-named SDK-checkout agents. */
declare function agentSpecsFor(plan: BuildPlan): Array<{
    name: "claude" | "codex";
    cwd: string;
}>;
/** The stage list the plan composes to — the preview screen, dry-run output,
 *  and the workflow all derive from this single source. A parallel phase emits
 *  a header row plus one row per branch leaf (each has its own node id and
 *  lights up independently); a loop stays a single row (its body collapses). */
/** Fold a workflow node id onto the stage row that represents it: inner
 *  phases of a loop light the loop's single row (`stagesFor` collapses loop
 *  bodies). Every other node id is its own row. */
declare function stageKeyForNode(plan: BuildPlan, nodeIdValue: string): string;
declare function stagesFor(plan: BuildPlan): PlanStage[];
/** Human-readable plan summary for the preview screen and dry-run output. */
declare function describePlan(plan: BuildPlan): string[];
/** Merge a partial plan (e.g. from the intent agent or CLI flags) over
 *  current draft values, keeping only keys the schema accepts. */
declare function mergePlanDraft(base: Partial<BuildPlan>, patch: Record<string, unknown>): Partial<BuildPlan>;
/** Validate a draft into a runnable plan. Returns issues instead of throwing
 *  so the TUI can keep the conversation going. */
declare function finalizePlan(draft: Partial<BuildPlan>): {
    plan: BuildPlan;
    issues: [];
} | {
    plan: null;
    issues: string[];
};

/**
 * Output tables for the Smithers run. One zod object per table; rows are keyed
 * by (runId, nodeId, iteration) and validated on write. Keep fields flat and
 * non-optional (empty string over null) — they map straight to SQLite columns.
 */
declare const smitherSchemas: {
    input: z.ZodObject<{
        app: z.ZodString;
        sdkRoot: z.ZodString;
        source: z.ZodDefault<z.ZodEnum<{
            discover: "discover";
            url: "url";
            existing: "existing";
        }>>;
        openApiUrl: z.ZodOptional<z.ZodString>;
        userStory: z.ZodDefault<z.ZodString>;
        shared: z.ZodDefault<z.ZodBoolean>;
        force: z.ZodDefault<z.ZodBoolean>;
        build: z.ZodDefault<z.ZodBoolean>;
        builder: z.ZodDefault<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            none: "none";
        }>>;
        review: z.ZodDefault<z.ZodBoolean>;
        reviewer: z.ZodDefault<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        maxFixRounds: z.ZodDefault<z.ZodNumber>;
        smoke: z.ZodDefault<z.ZodBoolean>;
        smokePrompt: z.ZodDefault<z.ZodString>;
        deploy: z.ZodDefault<z.ZodBoolean>;
        deployPath: z.ZodOptional<z.ZodString>;
        deployAomiToml: z.ZodOptional<z.ZodString>;
        deployPlatform: z.ZodOptional<z.ZodString>;
        autoApprove: z.ZodDefault<z.ZodBoolean>;
        allowStaleSdk: z.ZodDefault<z.ZodBoolean>;
        phases: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"compute">;
            id: z.ZodString;
            op: z.ZodEnum<{
                deploy: "deploy";
                binaries: "binaries";
                codegen: "codegen";
                validate: "validate";
                smoke: "smoke";
                result: "result";
            }>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"agent">;
            id: z.ZodString;
            role: z.ZodEnum<{
                curate: "curate";
                review: "review";
                fix: "fix";
                research: "research";
                "draft-spec": "draft-spec";
                synthesize: "synthesize";
                design: "design";
            }>;
            agent: z.ZodOptional<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
            }>>;
            brief: z.ZodOptional<z.ZodString>;
            repo: z.ZodOptional<z.ZodString>;
            onlyIf: z.ZodOptional<z.ZodEnum<{
                "prev-red": "prev-red";
                "prev-eval-fail": "prev-eval-fail";
            }>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"clarify">;
            id: z.ZodString;
            question: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
            options: z.ZodArray<z.ZodObject<{
                key: z.ZodString;
                label: z.ZodString;
                summary: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"gate">;
            id: z.ZodString;
            title: z.ZodString;
            summary: z.ZodOptional<z.ZodString>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"eval">;
            id: z.ZodString;
            scenario: z.ZodString;
            rubric: z.ZodString;
            threshold: z.ZodDefault<z.ZodNumber>;
            judge: z.ZodOptional<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
            }>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"loop">;
            id: z.ZodString;
            until: z.ZodEnum<{
                "validation-green": "validation-green";
                "eval-pass": "eval-pass";
            }>;
            maxRounds: z.ZodDefault<z.ZodNumber>;
            onMax: z.ZodOptional<z.ZodEnum<{
                fail: "fail";
                "return-last": "return-last";
            }>>;
            body: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"compute">;
                id: z.ZodString;
                op: z.ZodEnum<{
                    deploy: "deploy";
                    binaries: "binaries";
                    codegen: "codegen";
                    validate: "validate";
                    smoke: "smoke";
                    result: "result";
                }>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"agent">;
                id: z.ZodString;
                role: z.ZodEnum<{
                    curate: "curate";
                    review: "review";
                    fix: "fix";
                    research: "research";
                    "draft-spec": "draft-spec";
                    synthesize: "synthesize";
                    design: "design";
                }>;
                agent: z.ZodOptional<z.ZodEnum<{
                    claude: "claude";
                    codex: "codex";
                }>>;
                brief: z.ZodOptional<z.ZodString>;
                repo: z.ZodOptional<z.ZodString>;
                onlyIf: z.ZodOptional<z.ZodEnum<{
                    "prev-red": "prev-red";
                    "prev-eval-fail": "prev-eval-fail";
                }>>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"clarify">;
                id: z.ZodString;
                question: z.ZodString;
                summary: z.ZodOptional<z.ZodString>;
                options: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    label: z.ZodString;
                    summary: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"gate">;
                id: z.ZodString;
                title: z.ZodString;
                summary: z.ZodOptional<z.ZodString>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"eval">;
                id: z.ZodString;
                scenario: z.ZodString;
                rubric: z.ZodString;
                threshold: z.ZodDefault<z.ZodNumber>;
                judge: z.ZodOptional<z.ZodEnum<{
                    claude: "claude";
                    codex: "codex";
                }>>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>], "kind">>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"parallel">;
            id: z.ZodString;
            branches: z.ZodArray<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"compute">;
                id: z.ZodString;
                op: z.ZodEnum<{
                    deploy: "deploy";
                    binaries: "binaries";
                    codegen: "codegen";
                    validate: "validate";
                    smoke: "smoke";
                    result: "result";
                }>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"agent">;
                id: z.ZodString;
                role: z.ZodEnum<{
                    curate: "curate";
                    review: "review";
                    fix: "fix";
                    research: "research";
                    "draft-spec": "draft-spec";
                    synthesize: "synthesize";
                    design: "design";
                }>;
                agent: z.ZodOptional<z.ZodEnum<{
                    claude: "claude";
                    codex: "codex";
                }>>;
                brief: z.ZodOptional<z.ZodString>;
                repo: z.ZodOptional<z.ZodString>;
                onlyIf: z.ZodOptional<z.ZodEnum<{
                    "prev-red": "prev-red";
                    "prev-eval-fail": "prev-eval-fail";
                }>>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"clarify">;
                id: z.ZodString;
                question: z.ZodString;
                summary: z.ZodOptional<z.ZodString>;
                options: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    label: z.ZodString;
                    summary: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"gate">;
                id: z.ZodString;
                title: z.ZodString;
                summary: z.ZodOptional<z.ZodString>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>, z.ZodObject<{
                kind: z.ZodLiteral<"eval">;
                id: z.ZodString;
                scenario: z.ZodString;
                rubric: z.ZodString;
                threshold: z.ZodDefault<z.ZodNumber>;
                judge: z.ZodOptional<z.ZodEnum<{
                    claude: "claude";
                    codex: "codex";
                }>>;
                label: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>], "kind">>>;
            maxConcurrency: z.ZodOptional<z.ZodNumber>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
            kind: z.ZodLiteral<"wait-external">;
            id: z.ZodString;
            waitingFor: z.ZodString;
            timeoutHours: z.ZodOptional<z.ZodNumber>;
            onTimeout: z.ZodOptional<z.ZodEnum<{
                fail: "fail";
                continue: "continue";
            }>>;
            label: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "kind">>>;
    }, z.core.$strip>;
    binaries: z.ZodObject<{
        aomiBuild: z.ZodString;
        aomiRun: z.ZodString;
        sdkRoot: z.ZodString;
        source: z.ZodString;
        headSha: z.ZodString;
        syncAction: z.ZodString;
        warning: z.ZodString;
    }, z.core.$strip>;
    codegen: z.ZodObject<{
        ok: z.ZodBoolean;
        log: z.ZodString;
    }, z.core.$strip>;
    curation: z.ZodObject<{
        summary: z.ZodString;
        changedFiles: z.ZodDefault<z.ZodString>;
        followUps: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    review: z.ZodObject<{
        approved: z.ZodBoolean;
        notes: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    validation: z.ZodObject<{
        green: z.ZodBoolean;
        log: z.ZodString;
    }, z.core.$strip>;
    fix: z.ZodObject<{
        summary: z.ZodString;
    }, z.core.$strip>;
    smoke: z.ZodObject<{
        ok: z.ZodBoolean;
        log: z.ZodString;
    }, z.core.$strip>;
    /** Deploy approval decision — field names must match Smithers'
     *  approvalDecisionSchema so the engine can persist the decision. */
    gate: z.ZodObject<{
        approved: z.ZodBoolean;
        note: z.ZodNullable<z.ZodString>;
        decidedBy: z.ZodNullable<z.ZodString>;
        decidedAt: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    deployment: z.ZodObject<{
        ok: z.ZodBoolean;
        log: z.ZodString;
    }, z.core.$strip>;
    /** Clarify decision — a select-mode approval's `{selected, notes}` plus the
     *  engine's decidedBy/decidedAt stamps (mirrors how `gate` maps
     *  approvalDecisionSchema). */
    clarify: z.ZodObject<{
        selected: z.ZodString;
        notes: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        decidedBy: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        decidedAt: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    /** Generic agent-phase report for the composed roles (research, draft-spec,
     *  synthesize) that don't have a bespoke table. */
    agentWork: z.ZodObject<{
        summary: z.ZodString;
        artifacts: z.ZodDefault<z.ZodString>;
        followUps: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    /** Behavioral eval result: the judge's score (0..1), pass/fail against the
     *  phase threshold, the judge's notes, and the run transcript it scored. */
    evaluation: z.ZodObject<{
        score: z.ZodNumber;
        pass: z.ZodBoolean;
        threshold: z.ZodNumber;
        notes: z.ZodDefault<z.ZodString>;
        transcript: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    /** Payload of an external signal that resolves a wait-external pause. The
     *  Signal validates the incoming payload against this schema, so it doubles
     *  as the wait-external output row. `ready:false` lets an outside system
     *  report the work was abandoned. */
    external: z.ZodObject<{
        ready: z.ZodBoolean;
        note: z.ZodDefault<z.ZodString>;
        receivedBy: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    result: z.ZodObject<{
        status: z.ZodEnum<{
            complete: "complete";
            "deploy-denied": "deploy-denied";
            blocked: "blocked";
        }>;
        summary: z.ZodString;
        fileTreeJson: z.ZodDefault<z.ZodString>;
        crateTarB64: z.ZodDefault<z.ZodString>;
        artifactWarning: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
};
type SmitherSchemas = typeof smitherSchemas;
type BinariesRow = z.infer<SmitherSchemas["binaries"]>;
type CodegenRow = z.infer<SmitherSchemas["codegen"]>;
type ValidationRow = z.infer<SmitherSchemas["validation"]>;
type SmokeRow = z.infer<SmitherSchemas["smoke"]>;
type GateRow = z.infer<SmitherSchemas["gate"]>;
type ClarifyRow = z.infer<SmitherSchemas["clarify"]>;
type EvaluationRow = z.infer<SmitherSchemas["evaluation"]>;
type DeploymentRow = z.infer<SmitherSchemas["deployment"]>;
type ResultRow = z.infer<SmitherSchemas["result"]>;
declare function boundedLog(log: string, max?: number): string;

/** Which agent judges an eval: the phase's explicit choice, else the builder
 *  (claude when the builder is none — a judge is always an LLM). */
declare function evalJudge(plan: BuildPlan, phase: EvalPhase): "claude" | "codex";
/**
 * Run one behavioral eval: compile the plugin, run it against the scenario,
 * then have a read-only judge score the transcript against the rubric. The
 * judge never edits files — it returns strict JSON we parse into a metric.
 * This is the exit signal for an `eval-pass` loop.
 */
declare function runEvalStep(options: {
    plan: BuildPlan;
    phase: EvalPhase;
    binaries: ResolvedBinaries;
    runner: CommandRunner;
}): Promise<EvaluationRow>;

/** Context an agent phase can fold into its prompt: the composer's brief for
 *  this phase, clarify answers the human gave earlier, and — inside an eval
 *  loop — the judge's feedback from the last failing attempt to refine against. */
type PromptContext = {
    brief?: string;
    clarifications?: Array<{
        question: string;
        selected: string;
        notes?: string | null;
    }>;
    evalFeedback?: {
        score: number;
        threshold: number;
        notes: string;
    };
};
declare function curatePrompt(plan: BuildPlan, context?: PromptContext): string;
declare function reviewPrompt(plan: BuildPlan, context?: PromptContext): string;
declare function fixPrompt(plan: BuildPlan, validationLog: string, context?: PromptContext): string;
declare function researchPrompt(plan: BuildPlan, context?: PromptContext): string;
declare function draftSpecPrompt(plan: BuildPlan, context?: PromptContext): string;
declare function designPrompt(plan: BuildPlan, context?: PromptContext): string;
declare function synthesizePrompt(plan: BuildPlan, context?: PromptContext): string;
/** Judge prompt: score a run transcript against a rubric, 0..1. Returns strict
 *  JSON so the eval step can parse it — the judge never edits files. */
declare function judgePrompt(input: {
    app: string;
    scenario: string;
    rubric: string;
    transcript: string;
}): string;
/** Prompt for an agent phase by role. */
declare function rolePrompt(role: AgentRole, plan: BuildPlan, context?: PromptContext & {
    validationLog?: string;
}): string;
type IntentTurn = {
    role: "user" | "smither";
    text: string;
};
/** Fields the intent agent is allowed to propose. Derived from the schema so
 *  the instructions never drift from what mergePlanDraft will accept. */
declare function intentPlanFields(): string[];
declare function intentPrompt(input: {
    turns: IntentTurn[];
    draft: Record<string, unknown>;
    sdkRoot: string;
}): string;
/** Pull the last JSON object out of agent CLI output. CLI agents wrap answers
 *  in prose or fences despite instructions, so scan rather than parse whole. */
declare function extractJsonObject(raw: string): unknown;

/**
 * Live intake state, streamed to the browser from t=0 — before any Smithers
 * workflow exists. The composer (`distillIntent`) isn't a workflow node (there
 * is no graph until the plan is composed), so it can't ride the gateway; this
 * lightweight channel lets the browser show the conversation, the composer
 * thinking, the plan forming, and the composed stage preview as they happen.
 * When the build starts it flips to `building` with a `buildUrl`, and the page
 * follows to the gateway console — one browser tab across the whole flow.
 */
type IntakePhase = "intake" | "preview" | "building";
type IntakeState = {
    app: string;
    phase: IntakePhase;
    /** True while a distill call is in flight; drives the thinking indicator. */
    thinking: boolean;
    /** ms epoch the current think started (page computes elapsed). */
    thinkingSince: number | null;
    turns: IntentTurn[];
    draft: Partial<BuildPlan>;
    /** Composed stage preview from the current draft (empty until runnable). */
    stages: PlanStage[];
    /** Gateway console URL, set when the build starts; the page follows to it. */
    buildUrl: string | null;
};
type IntakeServerHandle = {
    url: string;
    port: number;
    update: (patch: Partial<IntakeState>) => void;
    close: () => void;
};
/**
 * Boot the intake view server. Serves the self-contained page at `/` and the
 * JSON state at `/intake` (polled by the page). Loopback-only — it exposes the
 * in-flight plan and conversation, so it must never bind a routable interface.
 */
declare function startIntakeServer(options: {
    app: string;
    host?: string;
    port?: number;
    maxPortTries?: number;
}): Promise<IntakeServerHandle>;

declare const intentDraftSchema: z.ZodObject<{
    summary: z.ZodDefault<z.ZodString>;
    plan: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    questions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    ready: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
type IntentDraft = z.infer<typeof intentDraftSchema>;
type IntentAgent = "claude" | "codex";
/**
 * One round of the intake conversation: hand the full transcript and current
 * draft to a read-only CLI agent, get back a refined draft plus follow-up
 * questions. Runs outside the Smithers workflow — the distilled BuildPlan
 * becomes the run's immutable input.
 */
declare function distillIntent(options: {
    turns: IntentTurn[];
    draft: Partial<BuildPlan>;
    sdkRoot: string;
    agent?: IntentAgent;
    runner?: CommandRunner;
}): Promise<IntentDraft>;

/**
 * The two manager calls a rollback needs. Written out rather than picked from
 * `ManagerClient` so the published typings name only `@aomi-labs/deploy` types;
 * `@aomi-labs/internal` is private and bundled, never a dependency.
 */
type RollbackClient = {
    listDeploymentRecords(input: ListDeploymentRecordsInput): Promise<ListDeploymentRecordsResult>;
    promote(input: PromoteInput): Promise<PromoteResult>;
};
type RollbackTarget = {
    deploymentId: string;
    releaseTag: string;
    action: string;
    createdAt: number;
    current: boolean;
};
type RollbackPlanSummary = {
    app: string;
    current: RollbackTarget | null;
    /** Newest activation whose release tag differs from the live one. */
    previous: RollbackTarget | null;
    activations: RollbackTarget[];
};
declare function planRollback(result: ListDeploymentRecordsResult): RollbackPlanSummary;
declare function executeRollback(client: RollbackClient, input: {
    platform: string;
    app: string;
    deploymentId: string;
}): Promise<{
    ok: boolean;
    releaseTags: string[];
    status: string;
}>;
declare function rollbackClientFromEnv(options: {
    env?: NodeJS.ProcessEnv;
    activationToken?: string;
    backendUrl?: string;
}): Promise<RollbackClient>;

declare const packageRoot: string;
declare const defaultRunsRoot: string;
declare function sanitizeAppName(app: string): string;
declare function runDir(app: string, root?: string): string;
declare function smitherDbPath(app: string, root?: string): string;
declare function runStatePath(app: string, root?: string): string;
/** Pointer to the durable Smithers run for an app. The run itself (outputs,
 *  approvals, frames) lives in smithers.sqlite; this only remembers which
 *  runId to resume. */
type RunState = {
    app: string;
    runId: string;
    createdAt: string;
};
declare function loadRunState(app: string, root?: string): Promise<RunState | null>;
declare function createRunState(app: string, root?: string, runId?: string): Promise<RunState>;
declare function resetRunState(app: string, root?: string): Promise<void>;
declare function planPath(app: string, root?: string): string;
/** Persist the BuildPlan beside the run so another process (e.g.
 *  `aomi-smither console --app`) can rebuild the identical workflow and
 *  register it for observation. */
declare function savePlan(plan: BuildPlan, root?: string): Promise<void>;
declare function loadPlan(app: string, root?: string): Promise<BuildPlan | null>;

type AgentKind = "claude" | "codex";
/** OpenRouter's Anthropic-compatible endpoint ("Anthropic Skin") — the claude
 *  CLI speaks its native Messages protocol straight to it. */
declare const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
/** Latest cheap coding Kimi. Deliberately NOT kimi-k3 (Sonnet-priced, no
 *  savings); k2.7-code is ~$0.72/$3.50 per M tokens. Ops override via
 *  SMITHER_OPENROUTER_MODEL. */
declare const DEFAULT_OPENROUTER_MODEL = "moonshotai/kimi-k2.7-code";
type AgentBilling = {
    kind: "openrouter";
    apiKey: string;
    model: string;
} | {
    kind: "anthropic";
    apiKey: string;
} | {
    kind: "none";
};
/**
 * Pick who pays for claude work agents. OpenRouter is the default whenever its
 * key is present (build runs are expensive on first-party Anthropic); the
 * Anthropic key is the backup path, kept for a quick rollback via env alone.
 * Not user-selectable — pure deployment config.
 */
declare function resolveAgentBilling(env: NodeJS.ProcessEnv | undefined): AgentBilling;
/**
 * Env overrides that point the claude CLI at OpenRouter. ANTHROPIC_API_KEY is
 * pinned to "" (not merely unset) so the CLI can never fall back to Anthropic
 * first-party auth; both model slots route to the same slug so background/fast
 * tasks don't silently bill a Claude model.
 */
declare function openrouterAgentEnv(billing: {
    apiKey: string;
    model: string;
}): Record<string, string>;
/**
 * CLI work agent for curation/review/repair tasks. Runs inside the SDK
 * checkout in non-interactive mode with edits allowed — Smithers owns the
 * retry/fallback/fork machinery around it. Lazy-imports the orchestrator so
 * merely loading this module doesn't require Bun.
 */
declare function makeWorkAgent(kind: AgentKind, options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    /** Who pays. Headless runners (sandboxes, CI) have no CLI login, so
     *  "none" only works where a personal subscription is signed in. Codex
     *  agents ignore this — they bill their own auth. */
    billing?: AgentBilling;
}): Promise<AgentLike>;

type AomiSmitherApi = CreateSmithersApi<SmitherSchemas>;
type AomiWorkflow = ReturnType<AomiSmitherApi["smithers"]>;
/** Where the durable run state lives. `sqlite` is Bun-only (bun:sqlite);
 *  `pglite`/`postgres` run on Node — the web (`aomi-build` BFF) path. */
type SmitherBackend = {
    kind: "sqlite";
    dbPath: string;
} | {
    kind: "pglite";
    dataDir: string;
} | {
    kind: "postgres";
    connectionString: string;
};
declare function describeBackend(backend: SmitherBackend): string;
declare function createAomiSmither(backend: string | SmitherBackend): Promise<AomiSmitherApi>;
type WorkflowDeps = {
    runner?: CommandRunner;
    env?: NodeJS.ProcessEnv;
    activationToken?: string;
    activationConfigPath?: string;
};
/**
 * Render the task graph from `resolveComposition(plan)`. The graph is a pure
 * function of (plan, persisted outputs): phase N mounts when phases 0..N-1 are
 * done, so resume re-renders straight past completed work. Node ids come from
 * `nodeId(app, phase.id)` and must stay stable across renders.
 */
declare function buildAppWorkflow(api: AomiSmitherApi, plan: BuildPlan, deps?: WorkflowDeps): Promise<AomiWorkflow>;

type ConsoleHandle = {
    port: number;
    host: string;
    /** Built-in Smithers operator console (gateway-level, at /console) — every
     *  registered workflow, generic run tree, approvals. */
    consoleUrl: string;
    /** Per-workflow view at /workflows/<app>: the aomi-branded UI when its entry
     *  is available, else the built-in workflow console. */
    workflowUrl: string;
    /** Loopback decision endpoint (POST /decide) when the console was started
     *  with a run api — the write path for select-mode clarify decisions. */
    decideUrl?: string;
    close: () => Promise<void>;
};
type ConsoleOptions = {
    workflow: AomiWorkflow;
    app: string;
    /** The Smithers api backing this run's SQLite. When present, a small
     *  decision endpoint boots beside the gateway so the branded UI can submit
     *  select-mode (clarify) decisions — the stock gateway approve route drops
     *  the decision payload in 0.26.1, so selections need this side channel. */
    api?: AomiSmitherApi;
    /** The plan behind this workflow. When present, its stage list is passed to
     *  the branded UI as boot props so the stage rail shows friendly labels
     *  immediately (before any event arrives). */
    plan?: BuildPlan;
    /** Force the built-in Smithers operator console instead of the aomi-branded
     *  UI (escape hatch / parity check). @default false */
    builtinConsole?: boolean;
    /** First port to try; increments on EADDRINUSE. @default 7331 */
    port?: number;
    /** @default "127.0.0.1" — loopback only; no auth is configured, so the
     *  gateway must never bind a routable interface. */
    host?: string;
    /** @default 10 */
    maxPortTries?: number;
};
declare const DEFAULT_CONSOLE_PORT = 7331;
/**
 * Boot a Smithers Gateway sidecar for one app workflow and serve the built-in
 * operator console. The gateway shares the workflow's SQLite store, so runs
 * executed by this process (or any other process on the same DB — the
 * out-of-process event bridge polls persisted events) stream live into the
 * browser: task graph, node outputs, events, and approve/deny controls.
 *
 * No auth is configured — the unauthenticated gateway grants the operator
 * role to every caller, which is only acceptable because we bind loopback.
 */
declare function startConsole(options: ConsoleOptions): Promise<ConsoleHandle>;
/**
 * Observer mode: boot a console for an app whose run lives (or lived) in this
 * package's run state — typically while `aomi-smither --app <name>` executes
 * in another terminal. Rebuilds the identical workflow from the persisted
 * plan.json and registers it without running anything; the gateway's
 * out-of-process event bridge streams the executing run's persisted events.
 */
declare function startConsoleForApp(options: {
    app: string;
    runsRoot?: string;
    port?: number;
    host?: string;
    builtinConsole?: boolean;
}): Promise<ConsoleHandle>;

declare function isBunRuntime(): boolean;
/** Bun-only surfaces (the gateway console bundles its UI with Bun.build). */
declare function assertBunRuntime(): void;
/**
 * Pick where run state lives. An explicit SMITHER_DATABASE_URL wins on any
 * runtime (shared/durable Postgres); otherwise Bun keeps the classic
 * bun:sqlite file and Node falls back to an embedded PGlite dir beside it.
 */
declare function resolveRunBackend(app: string, options?: {
    runsRoot?: string;
    env?: NodeJS.ProcessEnv;
}): SmitherBackend;
type PreparedRun = {
    api: AomiSmitherApi;
    workflow: Awaited<ReturnType<typeof buildAppWorkflow>>;
    plan: BuildPlan;
    runId: string;
    /** True when a prior run exists for this app and we're continuing it. */
    resume: boolean;
    backend: SmitherBackend;
    /** Human-readable state location (sqlite path, pglite dir, or "postgres"). */
    stateLocation: string;
};
declare function prepareRun(options: {
    plan: BuildPlan;
    deps?: WorkflowDeps;
    runsRoot?: string;
    overwrite?: boolean;
    backend?: SmitherBackend;
    /** Reuse an already-open store handle (one per backend per process — the
     *  embedded PGlite backend cannot be opened twice on one dataDir). */
    api?: AomiSmitherApi;
    /** Use a caller-allocated run id when creating fresh state (a control
     *  plane that pre-registers the run before dispatching a runner). An
     *  existing run for the app still resumes under its own id. */
    runId?: string;
}): Promise<PreparedRun>;
declare function executeRun(prepared: PreparedRun, options?: {
    onEvent?: (event: SmithersEvent) => void;
    signal?: AbortSignal;
    maxConcurrency?: number;
}): Promise<RunResult>;
/**
 * Run to a terminal status. `runWorkflow` RETURNS a parked status when the only
 * pending work is a human decision or an external signal — it does not block on
 * it. Those unblock via durable writes from any surface (TUI, browser console,
 * `sendSignal`), so this loop re-executes with resume until the run settles:
 * completed nodes replay from cache, decided/signaled nodes advance, and a
 * still-parked run cheaply returns to waiting.
 */
declare function executeRunUntilSettled(prepared: PreparedRun, options?: {
    onEvent?: (event: SmithersEvent) => void;
    signal?: AbortSignal;
    maxConcurrency?: number;
    /** How often to re-check while parked. @default 2500 */
    approvalPollMs?: number;
}): Promise<RunResult>;
/**
 * Narrow raw-SQL door into the run store, for host-app tables that must live
 * on the same connection (the embedded PGlite backend cannot be opened twice
 * in one process). Statements use `?` placeholders on every backend — the
 * storage layer translates for Postgres. Rows come back with on-disk column
 * names (no snake→camel transform).
 */
declare function storeQuery(api: AomiSmitherApi, sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
/**
 * All persisted output rows for a run, keyed by table name ("curation",
 * "result", …). Lets surfaces outside the workflow render (the web BFF, the
 * console) read what a run produced — including replayed resumes that emit no
 * live node events.
 */
declare function loadRunOutputs(api: AomiSmitherApi, runId: string): Promise<Record<string, ReadonlyArray<Record<string, unknown>>>>;
type RunNodeView = {
    nodeId: string;
    /** Scheduler task state: pending/running/finished/failed/skipped/waiting-*. */
    state: string;
    iteration: number;
    updatedAtMs: number;
};
type RunView = {
    /** Run status from the store, or null when the run id is unknown. */
    status: string | null;
    error?: string;
    /** Latest state per node id (highest iteration wins). */
    nodes: RunNodeView[];
    outputs: Record<string, ReadonlyArray<Record<string, unknown>>>;
};
/**
 * Reconstruct a run's observable state purely from the durable store — no
 * live event stream, no render ctx. This is what makes any process (another
 * web instance, an observer console) able to serve a run it never executed.
 */
declare function readRunView(api: AomiSmitherApi, runId: string): Promise<RunView>;
/**
 * Ask the engine to cancel a run via the durable store. The executing process
 * (this one or another — the engine polls `cancel_requested_at_ms`) winds the
 * run down to a `cancelled` terminal status. Safe to call from any surface
 * with store access.
 */
declare function requestRunCancel(api: AomiSmitherApi, runId: string): Promise<void>;
/**
 * Deliver an external signal that resolves a `wait-external` pause (a Smithers
 * `<Signal>` node keyed by the phase's node id). The durable write is picked up
 * by the next resume; call from the CLI `signal` subcommand, the console
 * `/signal` endpoint, or any external system with access to the run's SQLite.
 */
declare function sendSignal(options: {
    api: AomiSmitherApi;
    runId: string;
    nodeId: string;
    ready?: boolean;
    note?: string;
    receivedBy?: string;
}): Promise<void>;
/** Write a durable approval decision for a paused node (deploy gate, a
 *  needsApproval task, or a select-mode clarify). The in-process engine picks
 *  it up on its next frame. For clarifies pass `selection` — it becomes the
 *  `{selected, notes}` decision row later phases read as context. */
declare function decideApproval(options: {
    api: AomiSmitherApi;
    runId: string;
    nodeId: string;
    iteration: number;
    approve: boolean;
    note?: string;
    decidedBy?: string;
    selection?: {
        selected: string;
        notes?: string;
    };
}): Promise<void>;

export { type ActivationCredential, type AgentBilling, type AgentKind, type AgentPhase, type AgentRole, type AomiBuildCommand, type AomiSmitherApi, type AomiWorkflow, type BinariesRow, type BuildPlan, type ClarifyOption, type ClarifyRow, type CodegenRow, type CommandResult, type CommandRunner, type ComputeOp, type ConsoleHandle, type ConsoleOptions, type CrateArtifact, type CrateFileNode, DEFAULT_CONSOLE_PORT, DEFAULT_OPENROUTER_MODEL, type DeploymentRow, type EvalPhase, type EvaluationRow, type GateRow, type InnerPhase, type IntakePhase, type IntakeServerHandle, type IntakeState, type IntentAgent, type IntentDraft, type IntentTurn, OPENROUTER_BASE_URL, type Phase, type PlanStage, type PreparedRun, type PromptContext, type ResolvedBinaries, type ResultRow, type RollbackClient, type RollbackPlanSummary, type RollbackTarget, type RunNodeView, type RunState, type RunView, type SdkFreshness, type SmitherBackend, type SmitherSchemas, type SmokeRow, type ValidationRow, WORKFLOW_NAME, type WorkflowDeps, activationConfigPath, agentPhaseSchema, agentRoleSchema, agentSpecsFor, assertBunRuntime, boundedLog, buildAppWorkflow, buildPlanSchema, clarifyOptionSchema, clarifyPhaseSchema, classicComposition, compositionIssues, computeOpSchema, computePhaseSchema, crateFileTree, createAomiSmither, createRunState, curatePrompt, decideApproval, defaultRunner, defaultRunsRoot, defaultSdkRoot, describeBackend, describePlan, designPrompt, distillIntent, draftSpecPrompt, ensureFreshSdkCheckout, evalJudge, evalPhaseSchema, executeRollback, executeRun, executeRunUntilSettled, extractJsonObject, finalizePlan, fixPrompt, gatePhaseSchema, innerPhaseSchema, innerPhasesOf, intentDraftSchema, intentPlanFields, intentPrompt, isBunRuntime, judgePrompt, loadPlan, loadRunOutputs, loadRunState, loopPhaseSchema, makeWorkAgent, mergePlanDraft, newAppArgs, nodeId, openrouterAgentEnv, packageCrate, packageRoot, parallelPhaseSchema, phaseAgent, phaseSchema, planPath, planRollback, pluginLibraryFileName, prepareRun, readRunView, requestRunCancel, researchPrompt, resetRunState, resolveActivationCredential, resolveAgentBilling, resolveAgentCwd, resolveAomiBinaries, resolveComposition, resolveFreshAomiBinaries, resolveRunBackend, reviewPrompt, rolePrompt, rollbackClientFromEnv, runAomiBuild, runAomiRun, runAppCargoChecks, runDir, runEvalStep, runStatePath, sanitizeAppName, savePlan, sendSignal, smitherDbPath, smitherSchemas, stageKeyForNode, stagesFor, startConsole, startConsoleForApp, startIntakeServer, storeQuery, synthesizePrompt, targetBinaryPaths, waitExternalPhaseSchema };
