# Node: 04-memory

## Intent

Memory 版本与合法再执行 PoC 及端到端。用户 U53 已授权 review、通过后 commit、继续分项 PoC/end2end。

## Plan

- 明确输入、状态变化和验收结果；先机制验证，再真实 Agent 使用与交互复盘。
- 当前节点完成后记录证据及提交范围。

## State

status: done
last: 离线及真实同B再执行通过，memory v1→v2与旧来源保留；read说明已澄清提交
next: 05发布/消费资源；08验证状态说明理解及访谈结束主动Close
blocker: none

## Evidence

- ../evidence/baseline.json
- ../evidence/memory/preparation.json
- ../evidence/memory/offline-validation.json
- ../evidence/memory/live-validation.json
- ../evidence/memory/live-report.md
- ../evidence/memory/read-contract/validation.json

## Gate

- verification: offline-03及真实28采样43工具配对通过；两版各115功能检查；autonomousUsabilityPassed=false（访谈漏Close）
- commit: ac887e6；tool-contracts.ts 与 README，仅澄清read历史分配/当前状态；任务脚本与报告纳入最终资料slice
- include: 当前节点必要源码、测试、文档及证据
- exclude: 他人无关改动、历史实验、临时缓存与凭据
