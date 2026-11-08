// Exact public declarations selected from published hooks-BKkPP7ic.d.ts.
import type {Address,Hex} from 'viem';
export interface BatchEvmSigner {
    /** The signer's address */
    address: Address;
    /** Sign EIP-712 typed data */
    signTypedData: (params: {
        domain: {
            name: string;
            version: string;
            chainId: number;
            verifyingContract: Address;
        };
        types: Record<string, Array<{
            name: string;
            type: string;
        }>>;
        primaryType: string;
        message: Record<string, unknown>;
    }) => Promise<Hex>;
}
/**
 * Payload structure for batching payments.
 */
export interface BatchPayload {
    signature: Hex;
    authorization: {
        from: Address;
        to: Address;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: Hex;
    };
}

