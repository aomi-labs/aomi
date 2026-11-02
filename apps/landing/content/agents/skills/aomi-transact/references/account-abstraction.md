# EOA and backend-prepared AA

Read the exported Commit's action payload and review to determine the path.
Current CLI delegates execution to the shared client's Commit controller.

- An ordinary `evm_transaction` requires its reviewed sender and chain-matching
  RPC, with native gas available to that sender.
- A backend-prepared `user_operation` requires the exact owner authorization
  requests supplied by the backend. Validate chain, signer, calls, fees,
  sponsorship terms and simulation before signing those requests.
- `--eoa` and `--aa` constrain the expected operation. They do not convert one
  reviewed operation into another. Inspect the actual installed help first.
- Provider/mode preferences are not evidence of sponsorship or execution.
  Inspect the current prepared operation and actual fees.

Legacy embedded CLI releases may reject AA flags. Gate the branch using
[commands.md](commands.md#availability), rather than forcing a new execution
mode or silently falling back to a different wallet.

AA receipt layouts and destination effects require their own proof; a bundler hash or an
owner signature alone does not establish payment completion.
