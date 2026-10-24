const wallet = {
  identity: { isConnected: false, address: null, chainId: null },
  connect: async () => {
    throw new Error("Connect the isolated test wallet before testing USDC.");
  },
};
export const useAomiWalletKit = () => wallet;
