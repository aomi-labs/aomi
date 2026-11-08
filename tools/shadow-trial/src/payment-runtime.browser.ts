// Trusted-app adapter: use existing installed/bundled SDK packages. Importing
// this module does not connect a wallet, sign, dispatch or initialize a journal.
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { BatchEvmScheme } from './vendor/circle-batch-3.5.0/client/BatchEvmScheme';
import { generatePaymentId, appendPaymentIdentifierToExtensions } from '@x402/extensions/payment-identifier';
import type { TaskPaymentRuntime } from './browser-task-client';
export function createTaskPaymentRuntime(): TaskPaymentRuntime {
  return Object.freeze({
    createClient: (config: any) => x402Client.fromConfig(config),
    createBatchEvmScheme: (signer: any) => new BatchEvmScheme(signer),
    wrapFetchWithPayment,
    generatePaymentId,
    appendPaymentIdentifierToExtensions,
  });
}
