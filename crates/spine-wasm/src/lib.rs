//! Narrow, stateful JSON binding for the canonical Spine sampling runtime.

mod dto;
mod runtime;

pub use dto::ABI_SCHEMA;
pub use dto::Command;
pub use dto::CommandRequest;
pub use dto::CommandResult;
pub use dto::FeatureFlag;
pub use dto::InitRequest;
pub use dto::Operation;
pub use dto::ReplayItem;
pub use dto::Role;
pub use dto::SourceCharacter;
pub use dto::Terminal;
pub use runtime::BindingError;
pub use runtime::PortableRuntime;
use wasm_bindgen::prelude::*;

pub const CORE_VERSION: &str = "0.5.0";

pub fn linked_core_version() -> &'static str {
    CORE_VERSION
}

/// JavaScript owns only this coarse runtime object. Rust ownership-bearing
/// sampling handles and prepared commits never cross the ABI.
#[wasm_bindgen(js_name = SpineRuntime)]
pub struct WasmSpineRuntime {
    inner: PortableRuntime,
}

#[wasm_bindgen(js_class = SpineRuntime)]
impl WasmSpineRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(init_json: &str) -> Result<WasmSpineRuntime, JsValue> {
        PortableRuntime::from_json(init_json)
            .map(|inner| Self { inner })
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Returns a success or error envelope for every request. Semantic errors
    /// are data so every host can apply the same fault-latch policy.
    pub fn dispatch(&mut self, request_json: &str) -> String {
        self.inner.dispatch_json(request_json)
    }

    /// Extends a host system prompt with the configured canonical Spine
    /// instruction segments. Prompt composition stays in spine-core so hosts
    /// do not duplicate model-visible instruction text.
    pub fn extend_system_prompt(&self, base: &str) -> String {
        self.inner.extend_system_prompt(base)
    }
}
