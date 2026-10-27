import type { TxRecord } from "../types";

// geckoterminal is a read-only EVM market-data app: it quotes and charts,
// it never transacts. An empty tx list is its correct, honest state.

export const transactions: TxRecord[] = [];
