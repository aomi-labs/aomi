import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CreditTopUpDialog } from "../../src/account/usage/credit-bank/top-up-dialog";
import { WidgetScope } from "../../src/ui/widget-scope";
import { useAomiRuntime } from "./runtime";
import "../../src/package.css";
function Checkout() {
  const [open, setOpen] = useState(true);
  const [balance, setBalance] = useState<string>("Not yet refreshed");
  const { account } = useAomiRuntime();
  return (
    <WidgetScope className="dark">
      <main style={{ padding: 40 }}>
        <h1>Aomi checkout · sandbox</h1>
        <p>
          Isolated account fixture · real Payment service · no production funds
        </p>
        <p>Balance: {balance}</p>
        <button onClick={() => setOpen(true)}>Add credits</button>
        <CreditTopUpDialog
          open={open}
          onClose={() => setOpen(false)}
          onSuccess={async () => {
            const response = await fetch("/v1/account/credits");
            const data = await response.json();
            setBalance(`${data.balance / 10000} credits`);
          }}
        />
      </main>
    </WidgetScope>
  );
}
createRoot(document.getElementById("root")!).render(<Checkout />);
