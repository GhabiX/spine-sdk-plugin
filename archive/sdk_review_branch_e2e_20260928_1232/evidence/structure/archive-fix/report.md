# 归档后的历史 Scope 导入修复

原行为允许 archive 已封顶 Branch，但下一次采样仍包含该 terminal Scope，导入器因此拒绝继续。修复前四个真实 WASM/SpineController 回归都失败。现在已持久化的 terminal 映射进入历史读取路径，保留原 Branch、项目 parent、memory/source/version 和 scopeBinding；归档状态不被改回 live。

新 Scope 绑定归档节点、旧 Scope 伪造为 Live、重定向已持久化映射和错误 lease 仍被拒绝且无部分写入。覆盖 one-to-one、显式 selector、之前省略 selector、nested capped move 后归档、memory v2 后原父刷新，以及精确 receipt 重放。Move 改变项目 parent，不改变 canonical ancestry。Archive 不删除节点、不移除投影 memory，也不是 split/merge。

验证：SpineTree build 通过；五个定向回归通过；完整 SpineTree 158/158；使用独立 SDK 副本的 Pi 组合及 scope reconciliation 4/4；diff 检查通过。首次完整套件的 157/158 保留在 tree-tests.log：唯一失败是旧测试要求归档后必须拒绝，现在改为检查历史映射和归档值保持，原测试已备份。定向修复前失败保留 before.log。

未改变 SDK/WASM/core 或旧实验快照。尚未运行修复版本下的真实 Agent 结构实验；那是下一验证义务。
