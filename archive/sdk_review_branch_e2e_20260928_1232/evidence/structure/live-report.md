# 已完成分支移动、归档与继续工作：真实 Agent

指定结构工作流通过。Grok 4.7 high，冻结 SDK `7b2a0fd`，单 Agent，独立 testbed `structure-spinetree-grok-20260928_1532`。这是机制和可用性 PoC，不是官方 benchmark。

Agent 先完成 ledger 校验、汇总和组合检查，保留各自的完成分支；模型自测校验3项、汇总6项、组合9项通过。主机独立检查119个校验输入、6个汇总批次、6个非数组输入和1个CLI用例通过。两个额外CLI错误路径也由主机复核，均退出1且stdout为空。产物 SHA256 `755b45ab68228db302538ccd5b59e744ac581c75023d57b475cbc6d9d0a62237` 在整理前后完全相同。

后续请求给出两个真实 Branch ID 和整理目标，没有规定 read/change 的调用顺序。校验分支 `d2a213c8-fac4-443f-b3b8-f55af51e78ca` 从 root 移入汇总分支 `445f37c8-8650-4815-832f-37695709911d`，然后归档。Git 历史确认除 project parent、status、revision 外，UUID、goal、memory v1、memorySource、scopeBinding、skills/tools/constraints 不变。汇总分支本身不变。已归档结果在后续采样中仍可读，且没有节点被移除。

归档之后新建了 3 个完成义务，包括 CLI 错误路径检查。所有新分支均保留 canonical memory v1；原 Agent 的 H、session、binding、lease 保持。全轨迹 22 次采样/22 canonical receipts、38 组工具调用结果、15 个 offer 和 26 个 Git 状态通过核对。最终回到 root，registry ended。

## 交互核对

三次提示覆盖实现、指定已完成证据的整理及只读复盘，没有逐工具顺序指令或Close提醒。Agent自行read→同一change批次move/archive→read验证→后续Next与CLI检查→复盘read/Close。复盘正确区分项目父链、canonical来源、memory版本、派生children与branch revision；没有把两个UUID仍存在的关系调整称为合并或删除。最新head未再次读取的范围明确保留为未知。建议更明确标注项目父链/canonical字段以及返回before/after差异，仅为建议，未发现本轮因此失败。

实际提示 3 次；Close提醒：False。模型公开回答及核对限制见[交互审查](interaction-review.json)。本轮通过不能推翻03/04出现过的漏Close，也不证明已获得一般性的自主可用性。

## 语义边界

旧memory还保留当时的“Do not archive or move”以及原未测范围；后续明确请求没有被阻挡，新检查写进后继义务，没有改写旧v1。这类过时阶段指令仍需在组合测试中审查。

这次 move 只重组项目关系，不重写 canonical parent 或证据来源。archive 保留节点和历史，也不裁切 canonical 上下文。新义务综合两个完成结果属于工作归并，不是把两个 UUID 合成一个；不存在已验证的任意 split/merge/prune 接口。

usage：`{"input": 119922, "output": 38872, "cacheRead": 246528, "cacheWrite": 0, "totalTokens": 405322}`。reasoning 已包含在 output，美元费用未知。冻结运行时 16563 项文件/链接保持不变。

## 证据

- [完整轨迹及 Git 变化](trace-audit.json)
- [整理前检查](candidate-before.json)、[整理后检查](candidate-after.json)
- [结果与 hash](live-result.json)
- [第二轮整理和继续工作](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/structure-spinetree-grok-20260928_1532/turn-2-answer.json)
- [最终状态](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/structure-spinetree-grok-20260928_1532/final-state.json)
