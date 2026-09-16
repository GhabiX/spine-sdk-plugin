use crate::dto::ABI_SCHEMA;
use crate::dto::Command;
use crate::dto::CommandRequest;
use crate::dto::CommandResult;
use crate::dto::InitRequest;
use crate::dto::PortableSourceCell;
use crate::dto::PortableSourceSnapshot;
use crate::dto::SOURCE_SNAPSHOT_SCHEMA;
use crate::dto::Terminal;
use serde::Serialize;
use serde_json::Value;
use spine_core::host::CanonicalReplay;
use spine_core::host::CanonicalReplayBuilder;
use spine_core::host::ContextEpoch;
use spine_core::host::Feature;
use spine_core::host::PreparedSamplingCommit;
use spine_core::host::RecordDigest;
use spine_core::host::SamplingArchiveRecord;
use spine_core::host::SamplingFinish;
use spine_core::host::SamplingHandle;
use spine_core::host::SamplingRuntime;
use spine_core::host::SamplingTerminal;
use spine_core::host::SpineCompactBarrierV1;
use spine_core::host::SpineConfig;
use spine_core::host::ThreadNamespace;
use std::fmt;

const MAX_ABI_REQUEST_BYTES: usize = 4 * 1024 * 1024;

pub struct PortableRuntime {
    thread: ThreadNamespace,
    config: SpineConfig,
    runtime: SamplingRuntime,
    state: TransactionState,
}

#[derive(Serialize)]
struct PortableToolSpec {
    id: &'static str,
    description: String,
    parameters: Value,
}

enum TransactionState {
    Idle,
    Sampling(SamplingHandle),
    Prepared {
        transaction_id: String,
        commit: Box<PreparedSamplingCommit>,
    },
    Replaying(Box<CanonicalReplayBuilder>),
    Faulted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BindingError {
    pub code: String,
    pub message: String,
}

#[derive(Serialize)]
struct SuccessEnvelope {
    schema: &'static str,
    ok: bool,
    result: CommandResult,
}

#[derive(Serialize)]
struct ErrorEnvelope<'a> {
    schema: &'static str,
    ok: bool,
    error: &'a BindingError,
}

impl PortableRuntime {
    pub fn new(init: InitRequest) -> Result<Self, BindingError> {
        require_schema(&init.schema)?;
        let thread = ThreadNamespace::parse(init.thread).map_err(BindingError::input)?;
        let config = match init.config_toml {
            Some(source) => SpineConfig::parse_toml(&source).map_err(BindingError::input)?,
            None => SpineConfig::v1(),
        }
        .with_features(init.features.into_iter().map(|feature| match feature {
            crate::dto::FeatureFlag::Jit => Feature::Jit,
            crate::dto::FeatureFlag::Spawn => Feature::Spawn,
        }))
        .map_err(BindingError::input)?;
        let runtime = SamplingRuntime::new(
            thread.clone(),
            ContextEpoch::new(init.epoch),
            config.clone(),
        )
        .map_err(BindingError::core)?;
        Ok(Self {
            thread,
            config,
            runtime,
            state: TransactionState::Idle,
        })
    }

    pub fn from_json(init_json: &str) -> Result<Self, BindingError> {
        require_bounded_request(init_json)?;
        let init = serde_json::from_str(init_json).map_err(BindingError::json)?;
        Self::new(init)
    }

    pub fn execute(&mut self, command: Command) -> Result<CommandResult, BindingError> {
        if matches!(self.state, TransactionState::Faulted) {
            return Err(BindingError::state("runtime is faulted"));
        }
        match command {
            Command::ObserveSources { characters } => {
                let source_ids = self
                    .runtime
                    .observe_source(characters.into_iter().map(|value| value.into_core()))
                    .map_err(BindingError::core)?;
                Ok(CommandResult::SourcesObserved { source_ids })
            }
            Command::BeginSampling { prompt_digest } => {
                self.require_idle()?;
                let digest = RecordDigest::parse(prompt_digest).map_err(BindingError::input)?;
                let handle = self.runtime.begin_sampling().map_err(BindingError::core)?;
                let record = match self.runtime.sampling_started_record(&handle, digest) {
                    Ok(record) => record,
                    Err(error) => {
                        let _ = self.runtime.abort_sampling(&handle);
                        return Err(BindingError::core(error));
                    }
                };
                self.state = TransactionState::Sampling(handle);
                Ok(CommandResult::SamplingStarted {
                    record: Box::new(record),
                })
            }
            Command::RegisterExecution { key } => {
                self.require_sampling()?;
                self.runtime
                    .register_execution(&key)
                    .map_err(BindingError::core)?;
                Ok(CommandResult::ExecutionRegistered)
            }
            Command::StageExecution {
                key,
                execution_ref,
                operation,
            } => {
                self.require_sampling()?;
                let (origin, operation) = operation.into_core(execution_ref);
                self.runtime
                    .stage_execution(&key, origin, operation)
                    .map_err(BindingError::core)?;
                Ok(CommandResult::ExecutionStaged)
            }
            Command::FinishExecution { key, succeeded } => {
                self.require_sampling()?;
                self.runtime
                    .finish_execution(&key, succeeded)
                    .map_err(BindingError::core)?;
                Ok(CommandResult::ExecutionFinished)
            }
            Command::PrepareFinish {
                terminal,
                input_tokens,
            } => self.prepare_finish(terminal, input_tokens),
            Command::InstallPrepared { transaction_id } => self.install_prepared(transaction_id),
            Command::DiscardPrepared { transaction_id } => self.discard_prepared(transaction_id),
            Command::Compact { barrier } => self.compact(barrier),
            Command::Preview => {
                let context_plan = self
                    .runtime
                    .preview_context_plan()
                    .map_err(BindingError::core)?;
                Ok(CommandResult::Preview {
                    context_plan,
                    projection: self.runtime.projection().clone(),
                })
            }
            Command::SourceSnapshot => Ok(CommandResult::SourceSnapshot {
                source: self.source_snapshot(),
            }),
            Command::ContinueNamespace { thread } => {
                let thread = ThreadNamespace::parse(thread).map_err(BindingError::input)?;
                self.runtime
                    .continue_in_namespace(thread.clone())
                    .map_err(BindingError::core)?;
                self.thread = thread;
                Ok(CommandResult::NamespaceContinued {
                    source: self.source_snapshot(),
                })
            }
            Command::Replay { inputs } => self.replay(inputs),
            Command::ReplayBegin => self.replay_begin(),
            Command::ReplayApply { inputs } => self.replay_apply(inputs),
            Command::ReplayFinish => self.replay_finish(),
        }
    }

    pub fn dispatch_json(&mut self, request_json: &str) -> String {
        let result = require_bounded_request(request_json)
            .and_then(|()| {
                serde_json::from_str::<CommandRequest>(request_json).map_err(BindingError::json)
            })
            .and_then(|request| {
                require_schema(&request.schema)?;
                self.execute(request.request)
            });
        match result {
            Ok(result) => encode(&SuccessEnvelope {
                schema: ABI_SCHEMA,
                ok: true,
                result,
            }),
            Err(error) => encode(&ErrorEnvelope {
                schema: ABI_SCHEMA,
                ok: false,
                error: &error,
            }),
        }
    }

    pub fn extend_system_prompt(&self, base: &str) -> String {
        self.config.extend_system_prompt(base)
    }

    pub fn node_prompt(&self) -> String {
        self.config.node_prompt().unwrap_or("").to_string()
    }

    pub fn tool_catalog_json(&self) -> Result<String, BindingError> {
        let catalog =
            spine_core::host::ToolCatalog::new(&self.config).map_err(BindingError::input)?;
        let tools: Vec<PortableToolSpec> = catalog
            .definitions()
            .iter()
            .map(|definition| PortableToolSpec {
                id: definition.tool.name(),
                description: definition.description.clone(),
                parameters: definition.parameters.clone(),
            })
            .collect();
        serde_json::to_string(&tools).map_err(BindingError::json)
    }

    fn prepare_finish(
        &mut self,
        terminal: Terminal,
        input_tokens: Option<u64>,
    ) -> Result<CommandResult, BindingError> {
        // The handle is consumed by the core. If preparation fails, retrying
        // through the portable ABI would invent a transaction state.
        let state = std::mem::replace(&mut self.state, TransactionState::Faulted);
        let TransactionState::Sampling(handle) = state else {
            self.state = state;
            return Err(BindingError::state("no sampling transaction is active"));
        };
        let terminal = match terminal {
            Terminal::Completed => SamplingTerminal::Completed,
            Terminal::Failed => SamplingTerminal::Failed,
            Terminal::Cancelled => SamplingTerminal::Cancelled,
        };
        let finish = self
            .runtime
            .finish_sampling_with_input_tokens(handle, terminal, input_tokens)
            .map_err(BindingError::core)?;
        match finish {
            SamplingFinish::OrphanedStart => {
                self.state = TransactionState::Idle;
                Ok(CommandResult::SamplingOrphaned)
            }
            SamplingFinish::Prepared(commit) => {
                let record = SamplingArchiveRecord::SamplingCommit(commit.durable_record().clone());
                let transaction_id = record.record_digest().as_str().to_string();
                let result = CommandResult::FinishPrepared {
                    transaction_id: transaction_id.clone(),
                    record: Box::new(record),
                    context_plan: commit.context_plan().clone(),
                    projection: commit.projection().clone(),
                };
                self.state = TransactionState::Prepared {
                    transaction_id,
                    commit: Box::new(commit),
                };
                Ok(result)
            }
        }
    }

    fn install_prepared(&mut self, requested_id: String) -> Result<CommandResult, BindingError> {
        self.require_transaction_id(&requested_id)?;
        let state = std::mem::replace(&mut self.state, TransactionState::Faulted);
        let TransactionState::Prepared {
            transaction_id,
            commit,
        } = state
        else {
            self.state = state;
            return Err(BindingError::state("no prepared transaction is available"));
        };
        match self.runtime.install_prepared(*commit) {
            Ok(output) => {
                self.state = TransactionState::Idle;
                Ok(CommandResult::PreparedInstalled {
                    transaction_id,
                    context_plan: output.plan,
                    projection: output.projection,
                })
            }
            Err(error) => Err(BindingError::core(error)),
        }
    }

    fn discard_prepared(&mut self, requested_id: String) -> Result<CommandResult, BindingError> {
        self.require_transaction_id(&requested_id)?;
        let TransactionState::Prepared {
            transaction_id,
            commit,
        } = &self.state
        else {
            return Err(BindingError::state("no prepared transaction is available"));
        };
        self.runtime
            .discard_unpersisted_prepared(commit)
            .map_err(BindingError::core)?;
        let transaction_id = transaction_id.clone();
        self.state = TransactionState::Idle;
        Ok(CommandResult::PreparedDiscarded { transaction_id })
    }

    fn compact(
        &mut self,
        barrier: SpineCompactBarrierV1,
    ) -> Result<CommandResult, BindingError> {
        self.require_idle()?;
        let projection = self
            .runtime
            .compact(barrier)
            .map_err(BindingError::core)?;
        let context_plan = self
            .runtime
            .preview_context_plan()
            .map_err(BindingError::core)?;
        Ok(CommandResult::Compacted {
            context_plan,
            projection,
        })
    }

    fn replay(
        &mut self,
        inputs: Vec<crate::dto::ReplayItem>,
    ) -> Result<CommandResult, BindingError> {
        self.replay_begin()?;
        self.replay_apply(inputs)?;
        self.replay_finish()
    }

    fn replay_begin(&mut self) -> Result<CommandResult, BindingError> {
        self.require_idle()?;
        let builder = CanonicalReplay::new(self.thread.clone())
            .map_err(BindingError::core)?
            .with_runtime_config(self.config.clone())
            .map_err(BindingError::core)?
            .builder()
            .map_err(BindingError::core)?;
        self.state = TransactionState::Replaying(Box::new(builder));
        Ok(CommandResult::ReplayBegun)
    }

    fn replay_apply(
        &mut self,
        inputs: Vec<crate::dto::ReplayItem>,
    ) -> Result<CommandResult, BindingError> {
        let TransactionState::Replaying(builder) = &mut self.state else {
            return Err(BindingError::state("no replay transaction is active"));
        };
        if let Err(error) = builder.apply(inputs.into_iter().map(|value| value.into_core())) {
            self.state = TransactionState::Faulted;
            return Err(BindingError::core(error));
        }
        Ok(CommandResult::ReplayApplied)
    }

    fn replay_finish(&mut self) -> Result<CommandResult, BindingError> {
        let state = std::mem::replace(&mut self.state, TransactionState::Faulted);
        let TransactionState::Replaying(builder) = state else {
            self.state = state;
            return Err(BindingError::state("no replay transaction is active"));
        };
        let replay = match builder.finish() {
            Ok(replay) => replay,
            Err(error) => return Err(BindingError::core(error)),
        };
        let context_plan = replay.live_plan.clone();
        let projection = replay.projection.clone();
        let applied_commits = replay.applied_commits.clone();
        self.runtime = replay.into_runtime();
        self.state = TransactionState::Idle;
        Ok(CommandResult::ReplayInstalled {
            context_plan,
            projection,
            applied_commits,
            source: self.source_snapshot(),
        })
    }

    fn source_snapshot(&self) -> PortableSourceSnapshot {
        source_snapshot(&self.runtime)
    }

    fn require_idle(&self) -> Result<(), BindingError> {
        match self.state {
            TransactionState::Idle => Ok(()),
            TransactionState::Sampling(_) => Err(BindingError::state(
                "a sampling transaction is already active",
            )),
            TransactionState::Prepared { .. } => Err(BindingError::state(
                "a prepared transaction is awaiting persistence",
            )),
            TransactionState::Replaying(_) => Err(BindingError::state(
                "a replay transaction is already active",
            )),
            TransactionState::Faulted => Err(BindingError::state("runtime is faulted")),
        }
    }

    fn require_sampling(&self) -> Result<(), BindingError> {
        if matches!(self.state, TransactionState::Sampling(_)) {
            Ok(())
        } else {
            Err(BindingError::state("no sampling transaction is active"))
        }
    }

    fn require_transaction_id(&self, requested: &str) -> Result<(), BindingError> {
        match &self.state {
            TransactionState::Prepared { transaction_id, .. } if transaction_id == requested => {
                Ok(())
            }
            TransactionState::Prepared { .. } => Err(BindingError::state(
                "prepared transaction id does not match",
            )),
            _ => Err(BindingError::state("no prepared transaction is available")),
        }
    }
}

fn source_snapshot(runtime: &SamplingRuntime) -> PortableSourceSnapshot {
    let snapshot = runtime.source_snapshot();
    PortableSourceSnapshot {
        schema: SOURCE_SNAPSHOT_SCHEMA,
        thread: runtime.thread().as_str().to_string(),
        epoch: runtime.epoch().value(),
        cells: snapshot
            .cells()
            .iter()
            .map(|cell| PortableSourceCell {
                source_id: cell.id.clone(),
                boundary: cell.boundary.ordinal(),
                item: cell.item.clone(),
            })
            .collect(),
    }
}

impl BindingError {
    fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    fn json(error: impl ToString) -> Self {
        Self::new("invalid_json", error)
    }

    fn input(error: impl ToString) -> Self {
        Self::new("invalid_input", error)
    }

    fn core(error: impl ToString) -> Self {
        Self::new("core_error", error)
    }

    fn state(message: impl ToString) -> Self {
        Self::new("invalid_state", message)
    }
}

impl fmt::Display for BindingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for BindingError {}

fn require_schema(schema: &str) -> Result<(), BindingError> {
    if schema == ABI_SCHEMA {
        Ok(())
    } else {
        Err(BindingError::new(
            "unsupported_schema",
            format!("expected {ABI_SCHEMA}, received {schema}"),
        ))
    }
}

fn require_bounded_request(value: &str) -> Result<(), BindingError> {
    if value.len() <= MAX_ABI_REQUEST_BYTES {
        Ok(())
    } else {
        Err(BindingError::new(
            "request_too_large",
            format!("request exceeds {MAX_ABI_REQUEST_BYTES} bytes"),
        ))
    }
}

fn encode(value: &impl Serialize) -> String {
    serde_json::to_string(value).unwrap_or_else(|error| {
        format!(
            "{{\"schema\":\"{ABI_SCHEMA}\",\"ok\":false,\"error\":{{\"code\":\"serialization_error\",\"message\":{}}}}}",
            serde_json::to_string(&error.to_string()).unwrap_or_else(|_| "\"unknown\"".to_string())
        )
    })
}
