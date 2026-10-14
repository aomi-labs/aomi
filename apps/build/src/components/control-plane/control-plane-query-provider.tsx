"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  controlPlaneRetryDelay,
  shouldRetryControlPlaneQuery,
} from "@/lib/request-retry";

export function ControlPlaneQueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 15 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: shouldRetryControlPlaneQuery,
            retryDelay: controlPlaneRetryDelay,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
