import { EthereumIcon, SolanaIcon } from "@/icons/chain-icons";

const ICON = "size-3 shrink-0";

/** A wallet family's name with its icon; "both" shows EVM + SVM. */
export function FamilyLabel({ family }: { family: "evm" | "svm" | "both" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {family !== "svm" ? <EthereumIcon className={ICON} /> : null}
      {family !== "evm" ? <SolanaIcon className={ICON} /> : null}
      {family === "both" ? "EVM + SVM" : family === "evm" ? "EVM" : "SVM"}
    </span>
  );
}
