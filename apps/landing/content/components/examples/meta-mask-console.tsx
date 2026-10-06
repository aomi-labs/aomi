"use client";

import { ApiConsole, type EndpointDef } from "./ApiConsole";

const METAMASK_ENDPOINTS: EndpointDef[] = [
  {
    label: "Get Balance",
    method: "GET",
    path: "/api/accounts/:address/balance",
    description:
      "Fetch native token balance and network info for an address.",
    params: [
      {
        key: "address",
        placeholder: "0x… wallet address",
        required: true,
      },
      {
        key: "network",
        placeholder: "ethereum | polygon | arbitrum",
        defaultValue: "ethereum",
      },
    ],
    headers: [
      {
        key: "X-Session-Id",
        placeholder: "Session UUID",
        required: true,
      },
      { key: "Aomi-App-Key", placeholder: "Optional app key" },
    ],
  },
  {
    label: "List Tokens",
    method: "GET",
    path: "/api/accounts/:address/tokens",
    description:
      "Fetch ERC-20 token balances for an address on a given network.",
    params: [
      {
        key: "address",
        placeholder: "0x… wallet address",
        required: true,
      },
      {
        key: "network",
        placeholder: "ethereum | polygon | arbitrum",
        defaultValue: "ethereum",
      },
    ],
    headers: [
      {
        key: "X-Session-Id",
        placeholder: "Session UUID",
        required: true,
      },
      { key: "Aomi-App-Key", placeholder: "Optional app key" },
    ],
  },
  {
    label: "Send Transaction",
    method: "POST",
    path: "/api/transaction/send",
    description:
      "Queue a transaction for wallet approval. Returns a pending transaction object.",
    headers: [
      {
        key: "X-Session-Id",
        placeholder: "Session UUID",
        required: true,
      },
      { key: "Aomi-App-Key", placeholder: "Optional app key" },
    ],
    bodyTemplate: JSON.stringify(
      {
        to: "0x…",
        value: "0.01",
        network: "ethereum",
        data: "0x",
      },
      null,
      2,
    ),
  },
  {
    label: "Sign Message",
    method: "POST",
    path: "/api/transaction/sign",
    description:
      "Request a personal_sign or signTypedData from the connected wallet.",
    headers: [
      {
        key: "X-Session-Id",
        placeholder: "Session UUID",
        required: true,
      },
      { key: "Aomi-App-Key", placeholder: "Optional app key" },
    ],
    bodyTemplate: JSON.stringify(
      {
        message: "Hello from Aomi!",
        method: "personal_sign",
      },
      null,
      2,
    ),
  },
  {
    label: "Switch Chain",
    method: "POST",
    path: "/api/chain/switch",
    description:
      "Request the wallet to switch to a different chain by chain ID.",
    headers: [
      {
        key: "X-Session-Id",
        placeholder: "Session UUID",
        required: true,
      },
      { key: "Aomi-App-Key", placeholder: "Optional app key" },
    ],
    bodyTemplate: JSON.stringify(
      {
        chainId: 137,
        chainName: "Polygon",
      },
      null,
      2,
    ),
  },
  {
    label: "Get Transaction",
    method: "GET",
    path: "/api/transaction/:txHash",
    description:
      "Fetch the status and receipt of a submitted transaction.",
    params: [
      {
        key: "txHash",
        placeholder: "0x… transaction hash",
        required: true,
      },
      {
        key: "network",
        placeholder: "ethereum | polygon | arbitrum",
        defaultValue: "ethereum",
      },
    ],
    headers: [
      {
        key: "X-Session-Id",
        placeholder: "Session UUID",
        required: true,
      },
      { key: "Aomi-App-Key", placeholder: "Optional app key" },
    ],
  },
];

export function MetaMaskConsole() {
  return (
    <ApiConsole
      defaultBaseUrl="https://api.aomi.dev"
      endpoints={METAMASK_ENDPOINTS}
    />
  );
}
