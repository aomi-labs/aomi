"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Environment, ParaProvider } from "@getpara/react-sdk-lite";
import { paraEnvironment } from "./config";
import "@getpara/react-sdk-lite/styles.css";

export function Providers({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ParaProvider
        paraClientConfig={{
          apiKey: process.env.NEXT_PUBLIC_PARA_API_KEY ?? "",
          env: paraEnvironment === "PROD" ? Environment.PROD : Environment.BETA,
        }}
        config={{ appName: "Aomi" }}
        configOverrides={{
          authConfig: {
            oAuthMethods: ["GOOGLE", "TELEGRAM"],
            disablePhoneLogin: true,
          },
          modalConfig: { authLayout: ["AUTH:FULL"] },
          externalWalletConfig: { wallets: [] },
        }}
        fallback={
          <main className="wallet-page" aria-label="Loading Para wallet" />
        }
      >
        {children}
      </ParaProvider>
    </QueryClientProvider>
  );
}
