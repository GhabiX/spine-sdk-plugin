# 同一 Branch 再执行与 memory 修订：真实 Agent

机制和实际任务流程通过；自主交互可用性仍有未通过项。SDK `68fa324`，Grok 4.7 high，独立 testbed `memory-spinetree-grok-20260928_1352`。本轮非官方 benchmark，无官方分数。

## 可复核结果

- 原 Branch `083c92ac-5402-4dd8-b5f7-7c9d1062570a` 的 UUID、parent、goal 不变，memory 1→2；v1 正文、来源和旧 scopeBinding 保存在 `reexecution.source`，v2 对应新会话的 canonical receipt。
- 初版和修订版分别通过 115 / 115 例独立功能检查；候选 hash 分别为 `9cf072181bbd8e1b4196145622452b4ca92ae6bc75f28d9b440edf7ad73d74bf` 和 `a3684d1eba44604b0b2d2dea6b9427ff7a82597842c6b5cc98ec9491786e2f2f`。
- 初版模型自测 4 项，修订执行和父方各运行 5 项自测。父方在 dispatch 后重新 read Branch、读实现/规格并执行测试，没有把消息投递当作验收。
- 真实工具序列：read → rejuvenate → send → dispatch；接收方 observe → Open/实现/检查/Close；父方 read/检查/Close。每个通信工具各 1 次，Spawn/树修改/资源执行为零。
- 2 个真实会话、28 次采样和 canonical receipt、43 组配对工具结果；框架/工具/模型错误记录 0。结束后两个 registry owner 均 ended。
- usage `{"input": 251993, "output": 33214, "cacheRead": 235904, "cacheWrite": 0, "totalTokens": 521111}`；reasoning 为 output 的组成，不重复累加；美元费用未知。

## 理解与可用性边界

任务明确要求原 Branch 再执行并给出 Branch ID；工具选择与调用步骤由模型完成，不能称无提示自主发现需求。父方实际读过 v1，再发完整修订要求；接收方读取文件并完成工作，未观察它调用 spinetree_read 获取旧 memory。因此本轮证明保留与修订，不证明接收方直接依赖旧 memory 推理。

复盘通过 spinetree_read 准确解释了 v1/v2 的来源，区分 ready、queued、delivered 和 completed。其称“没有单独 observed 字段”限于父方 read/dispatch 返回；主机检查确认 mailbox 已 observed，接收方实际调用了 observe，不能把字段缺席说成未确认消息。

复盘再次遗漏 Close，需要第 4 个输入提醒。这个问题从生命周期试验复现，交给 skill 使用与组合验证处理，未宣称已修好。

模型指出：top-level active binding 已为空、reexecution 已 completed，但 `reexecution.binding.status` 仍是 running。该嵌套记录保存分配时的 binding；实际 registry 已 ended，没有活执行泄漏。这是返回字段含义容易误解的证据，需审查展示/契约，而不能仅根据文字把历史 ownership 记录改写。

## 证据

- [完整轨迹核对](trace-audit.json)
- [初版产物检查](candidate-initial.json)
- [新版产物检查](candidate-revised.json)
- [结果及全部来源 hash](live-result.json)
- [初始、变更、复盘、收尾输入](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/memory-spinetree-grok-20260928_1352/turn-2-input.json)（其余输入在同目录 turn-1/3/4-input.json）
- [复盘回答](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/memory-spinetree-grok-20260928_1352/turn-3-answer.json)
- [最终状态](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/memory-spinetree-grok-20260928_1352/final-state.json)

本轮没有修改冻结 runtime 或生产源码。所有输入、错误和会话保留。
