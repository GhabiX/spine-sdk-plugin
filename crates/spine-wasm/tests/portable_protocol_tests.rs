use serde_json::json;
use spine_wasm::PortableRuntime;

#[test]
fn old_and_unknown_abi_initialization_are_rejected() {
    for schema in ["spine-sdk/v1", "spine-sdk/unknown"] {
        let request = json!({ "schema": schema, "thread": "protocol-boundary" });
        let error = match PortableRuntime::from_json(&request.to_string()) {
            Ok(_) => panic!("mismatched ABI must not initialize"),
            Err(error) => error,
        };
        assert_eq!(error.code, "unsupported_schema");
    }
}
