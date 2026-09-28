# Node: 03-lifecycle

## Intent

验证空 node 新版的分支生命周期、恢复及真实 Agent 使用；区分机制正确与自主可用性。

## Plan

- 离线验证嵌套 Open/Next/Close、稳定身份、memory 来源及无写入重载。
- 独立 testbed 中完成真实任务，交互核对 Agent 自述与原始轨迹。
- 如实归并失败并将未解决的可用性问题带入后续技能与组合验收。

## State

status: done
last: 离线7转场及真实18采样/26工具对通过；114功能检查通过；自主可用性未全过
next: 04 memory版本与再执行；05/08必须验证历史可见性误判和漏Close改进
blocker: none（研究检查已完成，尚存可用性问题已明确移交）

## Evidence

- ../evidence/lifecycle/offline-04/result.json
- ../evidence/lifecycle/reload-diagnosis.json
- ../evidence/lifecycle/live-report.md
- ../evidence/lifecycle/live-result.json
- ../evidence/lifecycle/live-validation.json
- ../evidence/lifecycle/stage-completion.json

## Gate

- verification: completed; mechanism passed; autonomousUsabilityPassed=false，不得称自主采用全部通过
- commit: 本节点无生产修改；运行基线68fa324；任务局部lifecycle脚本/报告列入最终PoC资料slice，runtime/会话原文/testbed不加入源码提交
- include: lifecycle验证脚本、精简报告、阶段状态
- exclude: 凭据、冻结runtime、完整会话、旧实验及无关工作
