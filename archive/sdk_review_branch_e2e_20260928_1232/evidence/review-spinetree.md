# SpineTree 更新审查

结论：发现 **1 项 P2 租约隔离缺陷**，建议父分支补回归并修复后再提交。其余已审路径未发现可确认的新缺陷；这不是测试通过声明。本分支只读源码、测试与相关契约，未运行构建、测试、模型或控制操作。

## P2：再执行失败清理会结束同身份的新租约

位置：[index.ts:1400](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/index.ts:1400)，尤其 1401–1409。`published` 后失败清理只比较 `current.bindingId` 和 `current.sessionId`，随后把读取到的当前 registry entry 标为 `ended`，并将 branch 恢复成 capped。这里漏掉 `leaseId`，也没有完整验证 assignment/operation identity。

最小顺序：

1. 对一个 capped Branch 调用 `registry.rejuvenate`，reservation 和 running binding 均成功提交。
2. `ready(binding)` 等待期间，另一个合法宿主状态提交为同一 Agent/session/binding 换入 `leaseId = replacement`；可以同步更新 `branch.reexecution.binding`，保持该执行的新租约一致。
3. 原 `ready` 抛错。
4. catch 读到 replacement entry，但两项检查仍相等，因而把 **replacement lease** 标为 ended，恢复旧 branch source。

这里不需要伪造模型工具参数，也不是进程崩溃推测；它是明确的异步 stale cleanup 路径。新测试已经把“同 identity、不同 lease”视为需要拒绝的状态变化：[scopes-atomic-commit.test.mjs:113](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/test/scopes-atomic-commit.test.mjs:113)，尤其 121 行。正常租约转场函数也按 lease 验证：[index.ts:1547](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/index.ts:1547)。没有声称当前 production launcher 会自动轮换租约；触发前提是宿主在 ready 异步窗口内替换租约，代码与测试已将这一状态纳入模型。

建议最小修复：失败清理在同一次 CAS mutator 内核对完整执行 ownership，至少包含 `leaseId`、Agent/session/binding、branch、operationId；匹配失败应保留新 owner 状态并报 `invalid-binding`。使用 `MemorySpineTreeStore` + `ready` 中提交 replacement 后抛错的回归即可覆盖；断言 replacement snapshot 不被清理写覆盖。现有 [rejuvenate.test.mjs:96](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/test/rejuvenate.test.mjs:96) 只覆盖普通 attach failure，未覆盖这一替换窗口。本分支未执行该复现。

## 已核对的正确性结构

- [scopes.ts:92](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/scopes.ts:92)：receipt 在 await 前固定；每次 CAS 重读 owner；target cursor、mapping、memory、handoff 与 watermark 只通过一次 project snapshot CAS 发布。精准重放返回当前 registry，不复活旧 lease。
- [scopes.ts:184](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/scopes.ts:184)：WorkingBinding 注册后的新 receipt 不能通过 bindingless 入口绕过；home 不随普通 Open/Close/Next 改变。低层 basic-registry selector 是可信宿主接口，不是模型的强权限隔离。
- [scopes.ts:237](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/scopes.ts:237)：child 的 inherited floor/through 限制 project ownership；不把继承祖先当 child 本地 work。
- [scopes.ts:475](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/scopes.ts:475)：累计 mapping 保留旧 terminal identity，旧父 projection 不覆盖再执行后的新 memory。
- [scopes.ts:512](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/scopes.ts:512)：再执行只有一个 top-level inline result；result-level Next/第二结果不可通过 selector 省略绕过，顶层 Spawn 需先有 verified handoff。
- [scopes.ts:578](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/scopes.ts:578)：Spawn terminal 导入核 batch/ordinal/task/execution ref/parent Scope/child ended identity，且在同一 isolated snapshot 内提交；失败不会先 cap 前面的 sibling。
- [index.ts:1154](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/index.ts:1154)：有 transport domain 才做 endpoint admission，receipt 固定 recipient 四元组；Git mailbox admission/lease/observe/completion 在 CAS 内检查当前 endpoint。筛选 recipient 先于 dispatch limit。queue-only 与域内 transport 明确分开。
- [index.ts:2022](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/index.ts:2022)：snapshot v2 拒绝旧 agents 字段是明确格式切换；不把缺少兼容迁移判为新 bug。该 parser 是格式门槛，不是任意不可信 snapshot 的完整 schema 校验。

依据的项目扩展契约：[contract.md](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/tasks/spinetree_unified_branch_plan_20260927_1255/contract.md:7)。canonical authority 仍是 [FormularDef.md](/data/swe/FramePilot/cachetree/doc/FormularDef.md:418)，Spawn child execution 本身在其 canonical reducer 契约之外；不能把项目层控制误当 canonical tree rewrite。

## 非本次回归，但后续 PoC 不能省略的边界

- **archive 不等于在线裁切跑通。** [index.ts:1860](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/index.ts:1860) 可归档 capped mapped Branch，随后 `alignment: one-to-one` 再次选择该历史节点会在 [scopes.ts:410](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/scopes.ts:410) 或 483 行拒绝。最小顺序是 Open→Close→archive→下一 sampling import。HEAD 旧实现已有该限制，[scopes.test.mjs:205](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/test/scopes.test.mjs:205) 还专门预期拒绝。因此不是这批改动引入的回归；用户要求的结构端到端应单独解决或清晰限制此路径。
- **再执行/Spawn 测试夹具仍有旧调用次序。** [scopes-reexecution.test.mjs:28](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/test/scopes-reexecution.test.mjs:28) 与 [scopes-spawn-handoff.test.mjs:41](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/test/scopes-spawn-handoff.test.mjs:41) 先写 `registry.updateWorking` 再导入，不符合新 README 的“不预写 cursor”要求。它们能查 mapping/ownership，却不能单独证明这些组合路径的 cursor 原子性。独立 [scopes-atomic-commit.test.mjs:32](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/test/scopes-atomic-commit.test.mjs:32) 使用了正确 candidate binding；父级应沿其形式进行组合 PoC。
- **canonical 与 project commit 仍是两个事务。** 本次只保证 project 内部原子；持久化后掉电、占位后的进程崩溃、epoch/fork migration 与 reconciliation worker 未由这一 diff 完整实现。README 已明确限制，不能将抛错后的 canonical 状态宣传为总能回滚。

## 同伴最终读取

已读取 `blackboard/review/pi.md` 和 `sdk.md` 当前内容。纳入交接的新增限制：Pi 同伴报告 custom steering 的 persisted-tail 顺序问题；SDK 同伴确认声明 core pin 与当前 v2/空 node 源码不符的构建来源问题。两者分别属于同伴和父级验证，不作为本报告 correctness 结论的依据，也没有重复审查或修改其文件。

## 源码身份

以下 SHA-256 在报告写入时读取。基线 HEAD 为 d631cc982f556fbc23c20ee133af928988b6e984；报告针对当前 pending tree，不声称 dist 已由其重建。

- `packages/spinetree-plugin/src/index.ts`: `daa211dd1ff600cc6db0ddaa1ae8c6884ad35a60ccd43087bf67e289b7a9cdbf`
- `packages/spinetree-plugin/src/scopes.ts`: `022a8ff9e2cd94e865adc91b028922e3ce5d62b95620db27096f0238da6eaec0`
- `packages/spinetree-plugin/src/tool-contracts.ts`: `c025a312b83c166c14064cba62622e0e46aa665c7b2a43f6a65663bb9ceeb65e`
- `packages/spinetree-plugin/README.md`: `7bc4f09ea1c6856396228ae365c5cebea299dbb410388e764bbc715cabbf8940`
- `packages/spinetree-plugin/test/rejuvenate.test.mjs`: `af24711331c6286a277fa2acb908422a146fb08974ab08cd2dd165bf41afabdf`
- `packages/spinetree-plugin/test/scopes-atomic-commit.test.mjs`: `2433f0d233924ca69e6c2013c4432426b9bdd03ac6b426ae14a4c7912f3282e1`
- `packages/spinetree-plugin/test/scopes-reexecution.test.mjs`: `58ef918c6d33d6aa7ba8c7527383229f1bec59da499802a577f275c2c17ec330`
- `packages/spinetree-plugin/test/scopes-spawn-handoff.test.mjs`: `6a50a3f5aa4bc6ee283e18b7ba84904c7f99cbf8b2404ef0f905c62ab8fdc394`
- `packages/spinetree-plugin/test/transport-domain.test.mjs`: `9bc92669b35e5fd76c626f19dee7dfee6510b77b7d5a39d9c53721461b4bc16f`
- `packages/spinetree-plugin/test/scopes.test.mjs`: `352c03383e797484bc5a739667d2ffc942b8640798549e54f9125f953b0e2859`
- `packages/spinetree-plugin/test/snapshot-format.test.mjs`: `b6bc3035cb44aa3defcc924ec167200e2b5a705d6553f124d003dc36a85129b2`

验证：20 条文件/行号链接与空白检查通过；SpineTree 基线的 18 个文件 hash 均未改变。最终再次读取 Pi 同伴终稿，纳入其“修复 custom 开场时避免无条件提前导入 Spawn 中途 assistant/tool 事件”的交接限定；SDK 同伴来源问题仍待父级处理。
