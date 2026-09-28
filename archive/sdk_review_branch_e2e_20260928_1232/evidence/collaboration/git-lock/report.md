# 07 Git ref-lock 修复与离线重跑

修复提交 `eeea5d68ff1231be43206c4038f43dc2154d8ddf`，仅包括 SpineTree
`index.ts`、README 和三个锁竞争回归测试。`update-ref` 使用单次
`core.filesRefLockTimeout=1000` 设置，保留 expected-old CAS；未改变错误分类、
Scope 重试次数或 canonical 语义。

原离线用例在 grandchild turn_end 持久化时遇到 HEAD.lock，留下
post-commit-sink-failed。旧失败、Git 2.25 不支持交互事务的测试夹具失败、
以及后续夹具修正均保留。先前临时目录与删除规范违规见
`fixture-diagnosis.json`；该行为没有被当作修复结果。

受控 HEAD.lock 回归验证短锁释放后成功、持久锁有界失败、竞争 HEAD 不被覆盖。
这些是合成锁夹具，并非第二个真实 Git writer 全程持锁；多进程整合提供真实
Git 并发补充证据。最终 `tree-tests-final.log` 显示 161/161 通过。

原行为断言仅替换导入与输出路径后，在新的私有快照运行通过：46 scripted
采样、5 进程、6 sessions/registry entries、2 Spawn、4 typed returns、1 次
同 B 再执行至 memory v2、1 条 observed mailbox。全部 registry ended，
零 fault、零网络与真实模型请求。根资源、局部覆盖及父级整合断言也通过。

快照 `runtime-collaboration-lockfix` 包含 16,564 文件，生产源码和生成代码
与提交一致；仅回归测试是最终测试时序/注释修订前的版本，manifest 如实保留。
旧 runtime-structure 未修改。此处不把该快照宣称为提交的逐文件复制。

07 状态仍为 in_progress：真实 Grok 多 Agent 协作、父验收和事实复盘还未运行。
下一步固定当前提交的新快照再进入真实验证。08/09 尚未完成。
