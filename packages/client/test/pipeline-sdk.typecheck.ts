import type {
  ActionRequest,
  AomiClient,
  EvmCommitResult,
  EvmStagedBuild,
  SvmBuild,
  SvmCommitResult,
  SvmStageInput,
  SvmStagedBuild,
} from "../src";

declare const client: AomiClient;
declare const evmStaged: EvmStagedBuild;
declare const svmStaged: SvmStagedBuild;
declare const svmBuild: SvmBuild;

function svmActionsNarrowByLane() {
  for (const action of svmBuild.actions) {
    if (action.lane === "instruction") {
      const programId: string = action.instruction.program_id;
      void programId;
      const fee = action.instruction.fee_outcome;
      if (fee?.kind === "flow") {
        const amount: string = fee.amount;
        void amount;
        if (fee.asset.kind === "token") {
          const token: string = fee.asset.address;
          void token;
        }
      }
      // @ts-expect-error the server sends a tagged object, never a string
      const invalidFee: typeof fee = "unmeasured";
      void invalidFee;
      // @ts-expect-error the instruction lane carries no transaction record
      void action.transaction;
    } else {
      const payer: string = action.transaction.payer;
      void payer;
      // @ts-expect-error the transaction lane carries no instruction record
      void action.instruction;
    }
  }
  const title: string | undefined = svmBuild.summary?.title;
  void title;
}
void svmActionsNarrowByLane;

async function lifecycleTransitions() {
  const simulated = await client.pipeline.evm.simulate(evmStaged);
  await client.pipeline.evm.commit(simulated);

  // @ts-expect-error commit requires a simulated EVM Build, never a staged one
  await client.pipeline.evm.commit(evmStaged);
  // @ts-expect-error EVM and SVM portable Build values are not interchangeable
  await client.pipeline.evm.simulate(svmStaged);
}

const instructions: SvmStageInput = {
  kind: "instructions",
  instructions: [
    {
      description: "Transfer",
      instructions: [
        {
          program_id: "program",
          accounts: [{ pubkey: "owner", is_signer: true, is_writable: false }],
          data_base64: "AA==",
        },
      ],
    },
  ],
};

const transaction: SvmStageInput = {
  kind: "transaction",
  transaction: { tx: "AQ==", preserve_blockhash: true },
};

const mixedSvmInput: SvmStageInput = {
  kind: "transaction",
  transaction: { tx: "AQ==" },
  // @ts-expect-error a transaction variant cannot also carry instructions
  instructions: [],
};

void lifecycleTransitions;
void instructions;
void transaction;
void mixedSvmInput;

const walletIntents = (
  result: EvmCommitResult | SvmCommitResult,
): ActionRequest[] => result.requests;
const invalidInstructions: SvmStageInput = {
  kind: "instructions",
  instructions: [
    {
      description: "Transfer",
      instructions: [
        {
          // @ts-expect-error Wire instruction fields use the backend's snake_case names.
          programId: "program",
          data_base64: "AA==",
        },
      ],
    },
  ],
};
void [walletIntents, invalidInstructions];
