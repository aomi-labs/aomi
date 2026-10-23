# @aomi-labs/deploy

## 0.9.4

- Decode the Manager's `ffi_incompatible` and `ffi_unverified_sdk_versions` project fields, so a live app the runtime cannot load is told apart from one whose FFI record is merely missing.

## 0.9.2

- Publish under the MIT license, with a `repository` link so npm can show build provenance.

## 0.9.1

- Use the shared project client transport for deployment lifecycle requests and structured failures.
- Preserve existing deployment command and account authorization behavior.
