#!/bin/sh
set -eu

if [ -z "${CARGO_TARGET_DIR:-}" ]; then
  echo "CARGO_TARGET_DIR must point at the shared Spine SDK Cargo cache" >&2
  exit 1
fi

if [ -z "${WASM_BINDGEN:-}" ]; then
  echo "WASM_BINDGEN must point at wasm-bindgen 0.2.127" >&2
  exit 1
fi

version="$($WASM_BINDGEN --version)"
if [ "$version" != "wasm-bindgen 0.2.127" ]; then
  echo "expected wasm-bindgen 0.2.127, received: $version" >&2
  exit 1
fi

repo_root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cargo build --manifest-path "$repo_root/Cargo.toml" -p spine-wasm --release --target wasm32-unknown-unknown
out_dir="$repo_root/packages/sdk/wasm/node"
mkdir -p "$out_dir"
"$WASM_BINDGEN" \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/spine_wasm.wasm" \
  --target nodejs \
  --out-dir "$out_dir" \
  --out-name spine_wasm
mv "$out_dir/spine_wasm.js" "$out_dir/spine_wasm.cjs"
