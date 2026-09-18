use serde_json::Value;
use serde_json::json;
use spine_core::host::SpineTool;
use spine_core::host::ToolValidation;
use spine_core::host::ValidatedTransition;

/// Parse and normalize tool input with the same validator used by SpineCodex.
/// This function has no runtime or transaction state.
pub fn validate_tool_input(tool: &str, arguments: &str) -> Result<String, String> {
    let tool = SpineTool::all()
        .into_iter()
        .find(|candidate| candidate.name() == tool)
        .ok_or_else(|| format!("unknown Spine tool {tool}"))?;
    let validated =
        spine_core::host::validate_tool(tool, arguments).map_err(|error| error.to_string())?;
    let value: Value = match validated {
        ToolValidation::Transition(ValidatedTransition::Open { summary }) => {
            json!({ "type": "open", "summary": summary })
        }
        ToolValidation::Transition(ValidatedTransition::Close { memory }) => {
            json!({ "type": "close", "memory": memory })
        }
        ToolValidation::Transition(ValidatedTransition::Next { summary, memory }) => {
            json!({ "type": "next", "closed_memory": memory, "next_summary": summary })
        }
        ToolValidation::Transition(ValidatedTransition::Spawn { tasks }) => {
            json!({ "type": "spawn", "tasks": tasks })
        }
        ToolValidation::Ordinary => return Err("expected a Spine transition".to_string()),
    };
    serde_json::to_string(&value).map_err(|error| error.to_string())
}
