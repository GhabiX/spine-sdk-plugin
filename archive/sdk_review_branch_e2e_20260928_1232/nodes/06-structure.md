# Node: 06-structure

## Intent

分支拆分归并移动裁切的语义和可用入口。用户 U53 已授权 review、通过后 commit、继续分项 PoC/end2end。

## Plan

- 明确输入、状态变化和验收结果；先机制验证，再真实 Agent 使用与交互复盘。
- 当前节点完成后记录证据及提交范围。

## State

status: done
last: 归档历史映射修复已提交7b2a0fd，离线和真实Agent结构闭环通过
next: 07协作与08组合；复核过时阶段memory指令和前期Close遗漏
blocker: none

## Evidence

- ../evidence/structure/archive-fix/validation.json
- ../evidence/structure/offline-validation.json
- ../evidence/structure/live-result.json
- ../evidence/structure/live-validation.json
- ../evidence/structure/stage-completion.json

## Gate

- verification: passed（本轮限定；非任意split/merge或canonical裁切）
- commit: 7b2a0fdc292badcf1029a426c7bb6d22a593cb48
- include: 当前节点必要源码、测试、文档及证据
- exclude: 他人无关改动、历史实验、临时缓存与凭据
