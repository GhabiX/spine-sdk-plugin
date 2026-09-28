# Node: 01-review

## Intent

审查并验证当前 SDK、Pi 和 SpineTree 变更。用户 U53 已授权 review、通过后 commit、继续分项 PoC/end2end。

## Plan

- 明确输入、状态变化和验收结果；先机制验证，再真实 Agent 使用与交互复盘。
- 复现并修复 custom steering 顺序及 stale lease 清理问题；固定 core patch/hash 来源并重建 WASM。
- 当前节点完成后记录证据及提交范围。

## State

status: done
last: 三项修复及统一372项测试通过
next: 03-lifecycle
blocker: none

## Evidence

- ../evidence/baseline.json

## Gate

- verification: ../evidence/integration/final.json passed; check/build/372 tests/golden/source guard/diff check
- commit: 68fa324ad0b409bc2fff083be897186e8aca850a
- include: 当前节点必要源码、测试、文档及证据
- exclude: 他人无关改动、历史实验、临时缓存与凭据
