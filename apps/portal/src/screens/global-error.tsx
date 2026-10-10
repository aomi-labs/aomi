"use client";

import { useEffect } from "react";

import {
  claimClientReload,
  isRecoverableClientError,
} from "./client-error-recovery";

export default function GlobalError({ error }: { error: Error }) {
  useEffect(() => {
    if (
      isRecoverableClientError(error) &&
      claimClientReload(window.sessionStorage)
    ) {
      window.location.reload();
    }
  }, [error]);

  return (
    <>
      <>
        <main
          style={{
            alignItems: "center",
            background: "#f7f7f5",
            color: "#171717",
            display: "flex",
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            justifyContent: "center",
            minHeight: "100vh",
            padding: "24px",
          }}
        >
          <section style={{ maxWidth: "440px", textAlign: "center" }}>
            <p
              style={{
                fontSize: "20px",
                fontWeight: 700,
                letterSpacing: "-0.04em",
                margin: "0 0 24px",
              }}
            >
              aomi
            </p>
            <h1
              style={{
                fontSize: "28px",
                letterSpacing: "-0.03em",
                lineHeight: 1.15,
                margin: "0 0 12px",
              }}
            >
              Aomi needs a fresh start
            </h1>
            <p
              style={{ color: "#5f5f5b", lineHeight: 1.6, margin: "0 0 24px" }}
            >
              This browser could not finish loading the session. Saved chats are
              safe.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: "#171717",
                border: 0,
                borderRadius: "999px",
                color: "white",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: 600,
                padding: "12px 22px",
              }}
            >
              Reload Aomi
            </button>
          </section>
        </main>
      </>
    </>
  );
}
