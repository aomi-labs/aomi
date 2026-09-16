import type {
  AomiClient,
  EvmStagedBuild,
  SvmStageInput,
  SvmStagedBuild,
} from "../src";

declare const client: AomiClient;
declare const evmStaged: EvmStagedBuild;
declare const svmStaged: SvmStagedBuild;

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
      programId: "program",
      accounts: [{ pubkey: "owner", isSigner: true, isWritable: false }],
      data: "AA==",
    },
  ],
};

const transaction: SvmStageInput = {
  kind: "transaction",
  transaction: { transaction: "AQ==", encoding: "base64" },
};

const mixedSvmInput: SvmStageInput = {
  kind: "transaction",
  transaction: { transaction: "AQ==" },
  // @ts-expect-error a transaction variant cannot also carry instructions
  instructions: [],
};

void lifecycleTransitions;
void instructions;
void transaction;
void mixedSvmInput;
