# Core 来源与 WASM 构建复核

P1 来源声明问题已修复。`core-source.json` 现在声明精确基线 `cb01f18b0113ada388b0ede69b36c1194513a240` 加 `provenance/spine-core-cb01f18.patch`，不再把旧 `28e97f9ef2` 当作当前 ABI v2 的来源。补丁保存 11 个 tracked core 改动以及新增 `recipe_memory_tests.rs`；未修改相邻 Codex 工作树，也未提交该仓库。

## 源码与构建

- 从精确基线归档后应用补丁，重建了与当前输入逐字节相同的 48 个文件：完整 core 目录 46 个文件，加继承的 workspace Cargo.toml 和 rust-toolchain.toml。证据：`source-reconstruction.json`。
- `scripts/verify-core-source.mjs` 检查补丁 hash、完整 core inventory、全部文件 hash，以及 Cargo 实际采用的 dependency path。隔离重建输入变更时正确拒绝；测试后的 fixture 已恢复。证据：`guard-validation.json`。
- `scripts/build-node-wasm.sh` 在 locked Cargo 构建前后校验来源，再生成打包产物。实际构建 exit 0，用共享 `local-codex-target`、Rust/Cargo 1.95.0 与 wasm-bindgen 0.2.127。构建环境和输入均记录在版本化 `provenance/node-wasm-build.json`。
- 新打包 WASM SHA-256：`71e1f4adfd43a66dbaec28116a89b1028607b04ceacb099cdfe376694b8e3acf`，1,367,449 bytes；三份 JS/声明文件与重建前相同。旧四份产物保留在 `artifacts-before/`。新 hash 不同于此前未固定构建设置的产物，不能声称旧二进制已经由同一环境生成。

## 行为验证

- `cargo test --locked -p spine-wasm --tests`：13 个测试通过，包括 portable golden、ABI 拒绝、replay/compact、事务、feature-off、工具 catalog。
- `node scripts/verify-wasm-golden.mjs packages/sdk/wasm/node/spine_wasm.cjs`：native/WASM golden 一致。
- 打包 SDK runtime/protocol：8 个测试通过。
- `empty-node-probe.mjs` 用本轮重建 WASM 和当前插件 TOML，确认 `nodePrompt == ""`、recipe v2、Open/Close/Next/Spawn 可用；无模型请求。

## 边界与交接

隔离重建源码已与实际编译源码逐文件比较；没有另在隔离路径再编译，也不声称不同路径、工具链之间二进制逐字节一致。仍依赖可获取的基线 Git 对象、锁定的 crates 和相应 Rust/WASM 工具链。此处只跑 portable SDK 门槛，不跑完整 Codex CLI 集成测试；父级负责统一插件集成门槛及提交。

根 README 已说明 revision-plus-patch 和产物 manifest。插件 README 的旧“来源声明不变”描述属于 Pi 文档所有者，已在黑板交接，避免跨文件所有权修改。未进行模型请求、Docker、第三方通信或发布；未修改任务树和工作日志。
