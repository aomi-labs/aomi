# Adding a protocol interpretation

Create one file here that exports a `ProtocolAdapter`. Declare exact tool names
in `tools`; validate the result in `match`; return a semantic `ToolOperation`
using the shared fact helpers. Register the adapter with one import and one
array entry in `index.ts`. The registry build includes all `.ts` files in this
folder automatically. Core routing and the shared row renderer do not change.
Use the shared `protocol.prepare` or `protocol.result` operation IDs for the
common layout. If the protocol needs a distinct title, icon, or chip order,
declare a `descriptors` entry on its adapter in the same file.

For example, `curve.ts` can register `curve_prepare_swap`, verify Curve's
result shape, and return the swap's network, amount, and prepared state. If
validation fails, return `null` so the row stays neutral or shows a real error.
