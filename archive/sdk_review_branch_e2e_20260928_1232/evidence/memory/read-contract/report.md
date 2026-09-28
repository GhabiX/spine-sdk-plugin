# 再执行状态的读回契约

真实 Agent 复盘发现 completed 与嵌套 running 同时出现。源码确认两者来源不同：read 从一个固定 HEAD 返回当前 branch 和当前可用 binding；branch.reexecution.binding 保存分配时的 ownership 快照。原状态没有活执行泄漏。

本次仅澄清 spinetree_read 的模型可见说明和 README：用 reexecution.state 判断操作进度，用 top-level binding 判断当前可用 Agent，嵌套 status 是历史记录。保留原字段、状态及校验语义。

验证：SpineTree build 通过；read-binding 和 loadable 两组已有行为测试 8/8 通过；diffcheck 通过。没有编写提示词词表测试。模型是否能按新说明独立解释，将在后续组合端到端检查，不能以文档修改宣称已解决理解问题。03/04 的冻结 runtime 与会话未更改。
