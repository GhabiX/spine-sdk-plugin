# Branch 资源：真实 Agent 发布、修订与局部覆盖

本轮指定的资源工作流与交互核对通过。Grok 4.7 high，SDK `ac887e6`，独立 testbed `resources-spinetree-grok-20260928_1436`。不是官方 benchmark，也不证明 RSI 净收益。

## 实际闭环

| 资源 | 所有者 | 实际消费 | 主机检查 |
| --- | --- | --- | --- |
| 首版 tool + checking skill | root | 后续 Branch 用 r1 汇总新批次 | 6 批、220 个输入通过 |
| 扩展 `.50` / `12.` 的新版 | root | 精确 r2 版本被调用；后续兄弟再调用 r2 | 6 批、220 个输入通过 |
| 接受负数退款的同名覆盖 | `420cbc1e-a339-4896-a68e-17ee6e8bbc13` | 本地 r3 调用输出 1030 / [3] | 6 批、220 个输入通过 |

6 次发布全部返回 applied:true；3 个 tool descriptor 版本、3 个 skill 版本，4 次脚本资源调用。四次都在不可变 journal 中记录了 checking skill 的 name/version/source。模型在公开输出中比较预期值与实际 JSON；主机另用 BigInt 参考计算核验各版产物。发布 evidence 始终只是 declared。

退款覆盖后的兄弟 Branch `f822bfc2-d793-4693-8712-9872306c45ae` 仍消费 root 的 r2，同一批 `["-.5","-1.20","12.","+1"]` 得到 1200 / [0,1,3]。从第二轮完成到最终关闭，整个 root Branch 值完全一致。r1/r2/r3 文件仍匹配各自发布 hash。

## 轨迹和边界

41 次采样与 41 份 canonical receipt、55 组工具调用结果、23 个不同 offer 均逐条核验。单 Agent，10 Branch（root 加 9 个直接子节点）；Open4 / Next5 / Close4，9 份 memory v1 逐条对齐 canonical 来源。最后回到 root，registry ended，交互进程正常退出。

有一处不能简化为“下一 Branch 选用了新版”：session 的第二次脚本调用与 Next 同批发出，resource-use 捕获的是转场前 `057fd72a-a184-445e-9620-92c905e8db58` 的 offer。它证明 r2 被消费；第三轮转场后单独调用的兄弟 r2 才提供新的明确继承证据。这里记录实际边界，不改写历史归属。

provider 和 Pi isError 记录均为 0，但并非没有开发失败：session 第 41 行的检查脚本误用 pathToFileURL(URL)，实际 exit 1；Agent 修正检查脚本后第 53 行通过 18 项，工具包装的 isError 不反映这类命令退出码。r2 自测 26 项，局部 r3 自测 16 项，相关原始结果全部保留。

## 交互理解

四个输入分别是初始任务、语法变更、局部退款覆盖、只读接口复盘。任务明确要求使用资源系统和局部覆盖；没有指定逐个工具调用步骤，也没有补 Close 提醒。本轮复盘自主 read 资源和兄弟分支、重算脚本 hash、Close 返回 root。

复盘正确区分 source、descriptor 版本、entry hash、branch revision 和 Git HEAD；没有把未读取的其它分支说成已经检查。它将“宿主是否记录 skill 关联”保留为未知，因为模型可见的执行结果正文没有回显该元数据；主机 journal 已独立确认四次关联。read 提供描述和 revision，而精确可执行版本来自 offer；这一认知正确。

Agent 建议 execute 回显关联及 read 带版本，但明确这是未造成失败的改进建议。未据自述直接修改接口。实际可用性证据限于本轮指定场景，不能推翻03/04已经记录的漏 Close，亦不能证明 skill 产生了因果收益。

usage：`{"input": 274191, "output": 69119, "cacheRead": 1204864, "cacheWrite": 0, "totalTokens": 1548174}`。reasoning 包含在 output 中，不重复累计；美元成本未知。冻结 runtime 的 16562 项文件/链接复核不变。

## 证据

- [完整轨迹核对](trace-audit.json)
- [首版检查](candidate-initial.json)、[共享新版检查](candidate-revised.json)、[局部版检查](candidate-local.json)
- [结果及来源 hash](live-result.json)
- [第4轮复盘](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/resources-spinetree-grok-20260928_1436/turn-4-answer.json)
- [最终状态](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/resources-spinetree-grok-20260928_1436/final-state.json)

本分支未修改生产源码或冻结运行时。所有会话、失败与检查结果保留。
