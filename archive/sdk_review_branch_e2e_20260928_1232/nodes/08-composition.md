# Node: 08-composition

## Intent

组合真实任务及 Agent 交互反馈闭环。用户 U53 已授权 review、通过后 commit、继续分项 PoC/end2end。

## Plan

- 明确输入、状态变化和验收结果；先机制验证，再真实 Agent 使用与交互复盘。
- 承接03/04漏Close与07根上复盘；区别只读产物要求和正常分支生命周期，不靠每轮提醒通过。
- 组合检验当前/历史契约、同Branch memory、版本化资源、结构与协作；不得宣称任意merge/prune或因果收益。
- 当前节点完成后记录证据及提交范围。

## State

status: done
last: 离线与真实组合及独立审计完成；6会话86采样160工具对、141输入检查、16564运行项和stopped登记通过；自主可用性false
next: 09归并覆盖矩阵、可用性缺口和精简证据提交；不得把done理解为所有行为均通过
blocker: none

## Evidence

- ../evidence/composition/offline-result.json
- ../evidence/composition/live-report.md
- ../evidence/composition/live-result.json
- ../evidence/composition/live-validation.json
- ../evidence/composition/interaction-review.json
- ../evidence/composition/trajectory-review.md
- ../evidence/composition/runtime-review.md
- ../evidence/composition/testbed-registration.json
- ../evidence/composition/stage-completion.json

## Gate

- verification: 验证义务完成；离线/最终真实工作流通过，自主及通用可用性未建立，提前final与事实误述作为未解决项归并09
- commit: 本阶段无生产修改；SDK基线eeea5d68，精简实验脚本与报告纳入09证据提交
- include: composition脚本、报告、结果、验证记录及阶段文档
- exclude: runtime、testbed、raw sessions、缓存、凭据及无关历史资料
