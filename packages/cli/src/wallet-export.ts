import type { Eip5792Call, Eip5792SendCallsParams } from "./eip5792";

export const WALLET_EXPORT_FORMATS = ["eip5792", "moss", "metamask"] as const;

export type WalletExportFormat = (typeof WALLET_EXPORT_FORMATS)[number];

export type MetaMaskTransactionExport = {
  chainId: number;
  payload: Eip5792Call;
};

export type WalletExport =
  | Eip5792SendCallsParams
  | Eip5792Call[]
  | MetaMaskTransactionExport;

export function parseWalletExportFormat(
  value: string | undefined,
): WalletExportFormat {
  const format = value?.trim().toLowerCase() || "eip5792";
  if ((WALLET_EXPORT_FORMATS as readonly string[]).includes(format)) {
    return format as WalletExportFormat;
  }
  throw new Error(
    `Unknown export format "${value}". Use "eip5792", "moss", or "metamask".`,
  );
}

export function formatWalletExport(
  params: Eip5792SendCallsParams,
  format: WalletExportFormat,
): WalletExport {
  if (format === "eip5792") return params;
  if (format === "moss") return params.calls;
  if (params.calls.length !== 1) {
    throw new Error(
      "The metamask format supports exactly one call. Export one transaction at a time, or use the eip5792 or moss format for multiple calls.",
    );
  }
  return {
    chainId: Number(BigInt(params.chainId)),
    payload: params.calls[0],
  };
}
