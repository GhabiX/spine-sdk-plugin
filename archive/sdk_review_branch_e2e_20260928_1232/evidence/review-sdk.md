# SDK ABI 与 WASM 来源审查

审查范围：基线 `d631cc982f556fbc23c20ee133af928988b6e984` 的 SDK、Rust binding、ABI 文档、golden fixture、构建脚本及外部 core 来源。只读审查；本分支没有构建、执行测试或发起模型请求。

## 发现：P1，提交前补齐 WASM 的可重建来源

[core-source.json:6](../../../core-source.json) 仍声明 `28e97f9ef2`，但此次 ABI v2 / recipe v2 / 空 node 依赖未包含在该版本中的 core 更新。

具体证据：

- 旧 revision 的 `codex-rs/spine-core/src/context_plan.rs:15,28` 声明 `spine.context.plan.v1` 并包含 `memory_slots`；其 `src/config.rs:340` 要求非空 node 配置。
- 当前 [SDK protocol.ts:190](../../../packages/sdk/src/protocol.ts) 要求 `spine.context.plan.v2`，删除 `memory_slots`；[binding dto.rs:21](../../../crates/spine-wasm/src/dto.rs) 和 SDK 外层都声明 `spine-sdk/v2`。
- [Cargo.toml:15](../../../Cargo.toml) 实际使用相邻工作树路径。该 core 当前 HEAD 是 `cb01f18b0113ada388b0ede69b36c1194513a240`，并有 11 个已修改 core 文件；其中包含当前 recipe v2、planner 以及可选 node 更新。仅把 pin 改成该 HEAD 也不能覆盖这些未提交修改。
- [构建脚本:21](../../../scripts/build-node-wasm.sh) 直接编译该可变路径，没有校验 declared source，也未传 `--locked`。`Cargo.lock` 的 path dependency 不记录这些源码字节。脚本固定 wasm-bindgen `0.2.127`，但这不能替代 core 来源固定。
- [README:394](../../../README.md) 要求 CI/release 使用声明的精确 revision；[plugin README:60](../../../packages/plugin/README.md) 则明确披露此次为带本地修改的开发构建。后者提到同步任务的 patch/hash/build log，但未给出可恢复路径。本次有界审查没有在此 repo 找到已版本化的完整来源及构建 manifest；不能推断外部其他任务完全没有证据。

可复核的最小静态步骤：在相邻 Codex repo 查看 `git show 28e97f9ef2:codex-rs/spine-core/src/context_plan.rs`、`git show 28e97f9ef2:codex-rs/spine-core/src/config.rs`，与当前相应文件及 SDK v2 类型比较。按声明的旧 revision 重建，预期不能同时提供空 node 与 recipe v2；本分支未执行该重建。

影响是提交后的来源不可复现，并非已证明当前二进制行为错误。只提交 SDK repo 的 pending binary 和 TS 改动，不能让下一位开发者按当前源声明重建同一产品。

建议父方在提交前完成：保留并审查实际 core delta；固定可恢复的 core revision，或明确采用 base revision + 精确 patch + 全部输入哈希的开发来源；用该输入重新构建 WASM，记录 toolchain/lockfile/命令和四个生成文件的哈希；运行 native 与 packaged WASM golden 以及 v2/空 node 行为检查。不得假称当前二进制已与源码对应，也不要覆盖相邻 repo 的无关修改。

## ABI 改动本身

本次范围内未发现另一个已确认的 ABI 改动错误：

- Rust 与 TypeScript 的 outer schema 一起升级为 v2；fixture、native golden 和 WASM golden 也同步，并核验精确 v2 plan。
- `crates/spine-wasm/src/runtime.rs:197–205` 在执行命令前校验 outer schema。新增 native 初始化测试与 SDK packaged-runtime 测试覆盖 v1 拒绝；后者还检查拒绝旧命令不改变当前 plan。
- 当前 dirty core `context_plan.rs:14–30,272–281` 使用 v2 tag 和 `deny_unknown_fields`，拒绝旧 tag 及被删除的字段。TS recipe 不再暴露重复的历史 memory slots；历史仍由 semantic tree/archive 承担，不能推导其增长无界安全。
- `packages/sdk/src/protocol.ts:371–389` 只校验 outer envelope/result discriminator，并非任意嵌套 recipe 的完整验证器。这是已有实现；文档将 recipe decoder 的拒绝归于 Rust，当前没有据此新增缺陷结论。
- 原 sampling/source/compact/transport schema 未随此次 outer ABI 升级而改变。新增测试及静态阅读不能独立证明所有历史宿主 session 都能 replay；父方后续真实恢复和端到端验证仍须覆盖该行为。

## 来源身份

本报告读取时的 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `core-source.json` | `08c2b4a580b2017114c26b67a8671bc7ed948eef1774cd459f8a274a09d5aeec` |
| `Cargo.toml` | `7b9ce2919615789f52f9eccc08908004adadd9c98c7042d7e2398ffeff2bb64a` |
| `Cargo.lock` | `6e53101fa51580f80109edbf3ec5bc4eb54fabd974c9eed5e9e6df34b68919c6` |
| `scripts/build-node-wasm.sh` | `d63873b9ebec833a1e3c15bc2b65ff37619c5ce7fb0962e71e060500b592816f` |
| `crates/spine-wasm/src/dto.rs` | `1e83609044aab4431ab6b227c1b6313ccf67111de5e5e88db7caf02725bdc477` |
| `packages/sdk/src/protocol.ts` | `b3520e7d4800c071acdfdfd9736acd44cb9ad7419154f368c5ed174562c64d47` |
| `packages/sdk/wasm/node/spine_wasm_bg.wasm` | `0b62b19f639464072c484613bddc4b41d61ec659ac401e3810eb5bf5c35f3dc5` |
| `crates/spine-wasm/tests/portable_protocol_tests.rs` | `24b690e0cbc69aa7aa1788c12b1ebc6aa4ad452a6bdfd147f7a9f95d6ddb65ea` |
| `README.md` | `fb736aa95f005ed8b463470037a7eed6617d60eec8b517a47ef8a347d1c45393` |
| `packages/plugin/README.md` | `027ffb6e64605f03f0d1230e704a8d35dc6ddbcbfaa4330a7dac8ef7a7f81da7` |

## 同伴边界与交接

最终读到 Pi 同伴的 custom-message persisted-tail 排序问题，以及 SpineTree 同伴的 reexecution cleanup 缺 lease fencing 问题和已有 archive/import 组合限制。这些由各自报告负责，未作为本分支 ABI 结论的证明，也未扩展本分支修改范围。

本报告不能代替测试通过记录。父方负责修复、固定来源、构建与运行验证后再提交；本分支只写此报告和自己的黑板，不改变生产、源码、构建产物、任务状态或 peer 文件。
