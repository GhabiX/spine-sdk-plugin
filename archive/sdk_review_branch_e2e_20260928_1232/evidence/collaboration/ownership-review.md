# 07 真实协作轨迹与文件所有权复核

复核日期：2026-09-28。结论：**本分支覆盖的公开调用、产物所有权和返回/反馈链核验通过**。没有发现越权的 write/edit、Bash 中的隐蔽产物修改，或九个指定产物中无法由记录解释的净变化。这个结论不等同于系统调用级全盘无写入证明，也不把自主可用性判为全通过。

本分支只读实验和运行包；仅写本报告与单写者黑板。未调用模型、重跑候选测试、修改生产代码、runtime、testbed、任务树或登记文件。模型 thinking 内容未展示、提取或用于分析；核对对象是公开 toolCall/toolResult、typed 记录、canonical receipt 及持久状态。

## 1. 证据范围和独立复核方法

不是只采信既有 `trace-audit.json` 的 passed 标记。本次重新遍历 `.pi-sessions` 中全部四份真实 JSONL，四份文件 SHA256 与既有审计逐一匹配。在各自 `spinetree.scope-import.v1/start` 之后统计，排除 Spawn 子会话携带的父历史前缀。重新提取的 **79 个工具调用及其 79 个结果**（名称、参数、行号、时间和 error 标记）逐项等于既有审计索引。

| 角色 | 自己的起始行 | 采样/canonical receipt | 工具对 | 原始会话 |
|---|---:|---:|---:|---|
| 父 Agent P | 4 | 24/24 | 46 | [037a7a20-af36-4e78-816d-7e604d44c710](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/2026-09-28T10-01-38-876Z_037a7a20-af36-4e78-816d-7e604d44c710.jsonl) |
| 初始校验子 Agent V | 24 | 8/8 | 11 | [e397927d-5156-4a43-bbce-5437c238418d](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/spine-spawn/call-c5d7af2d-05a2-491a-982d-2ac7ff415feb-4_fc_c51d797e-a9ab-9c7/0.jsonl) |
| 初始汇总子 Agent A | 24 | 7/7 | 10 | [cdbdd8e6-d196-4e72-9fcc-2a95847802b7](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/spine-spawn/call-c5d7af2d-05a2-491a-982d-2ac7ff415feb-4_fc_c51d797e-a9ab-9c7/1.jsonl) |
| 同 Branch 再执行 R | 4 | 7/7 | 12 | [4b5999a4-08c6-439e-92b0-75edc8436344](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/2026-09-28T10-14-08-427Z_4b5999a4-08c6-439e-92b0-75edc8436344.jsonl) |

合计 46 次采样、46 对 pending/ready canonical receipt、79 组工具结果。重新比对 pending 与 ready 的完整 receipt；公开轨迹中无 provider error、tool isError 或 `spine.fault.v1`。最终四个 registry owner 均 ended。

## 2. 文件所有权和产物重建

| 写入者 | 允许且实际写入的产物 | 公开证据 |
|---|---|---|
| P | `ledger.mjs`、`integration.test.mjs`、`shared-notes/ledger.md` | P:44、57 初写；P:110、129 修订自己的测试/笔记 |
| V | `validation.mjs`、`validation.test.mjs`、`shared-notes/validation.md` | V:36、62 初写 |
| A | `aggregation.mjs`、`aggregation.test.mjs`、`shared-notes/aggregation.md` | A:36、56 初写 |
| R | 原校验 Branch 的三个 validation 文件 | R:21 修改源与测试；R:41 追加自己的修订笔记 |

初始两份分派在 [P:25](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/2026-09-28T10-01-38-876Z_037a7a20-af36-4e78-816d-7e604d44c710.jsonl:25) 明确不同文件所有权、同一 `shared-notes` 路径及无需等待同伴即可完成的边界。反馈在 [P:88](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/2026-09-28T10-01-38-876Z_037a7a20-af36-4e78-816d-7e604d44c710.jsonl:88) 明确 R 仍只拥有校验侧三个文件；父方用户输入同时授权其更新自己的集成测试和笔记。父方自己的 `ledger.md` 是集成证据，不属于任一子方的文件。

本次把全部 9 次 `write` 的正文按 UTF-8 放入内存，再按实际时间依次应用 5 次 `edit` 中的 7 个唯一匹配替换：

- 9 个初写结果逐字节等于 `initial-artifacts/` 中的九份备份，且分别匹配其 manifest SHA256。
- 5 次 edit 分别作用于 validation 源码、validation 测试、validation 笔记、父集成测试、父笔记；每个 oldText 都恰好匹配一次。
- 重建后的九份终版逐字节等于 testbed 当前九个产物。
- 初版与修订版三个模块的 SHA256 分别匹配两份 candidate 检查记录。`ledger.mjs` 和 `aggregation.mjs` 字节未变，只有校验实现从非负下界改为有符号下界。
- 初版 `SPEC.md` 与 `GOAL.md` 仍匹配 live-preparation 引用；汇总 Branch 整个对象在 turn-1 与 final 之间保持相等。
- 顶层 28 个文件均属于已知准备输入、九份产物、driver 日志/状态/公开答复；`shared-notes` 恰好三份已分配笔记。未发现额外未分类顶层文件。

关键模块 SHA256：

| 模块 | 初版 | 修订版 |
|---|---|---|
| ledger.mjs | `7be05d640f36c7d2ccd13b21f3826a9094e8aa4b4d65c4cacb6197cf3d092cd6` | 同初版 |
| aggregation.mjs | `67211062fd349f163d025183c1f406578ac88e1581c0cf232ca4fbca01ef3663` | 同初版 |
| validation.mjs | `5b72d921957ded446d0fe9d6f9e19719e25c4841c9b45f7929fa59e84a8e3b2d` | `d808cff8a86740b700eb91c31333cd9a87da22c7aac05a2058a0327f263faca1` |

两份既有独立候选检查各记录 141 个校验输入、7 组汇总、6 个非数组输入、1 个 CLI 检查 passed；本次核对它们与对应字节的绑定，没有重跑这些功能检查。

## 3. 全部 13 次 Bash 的边界

逐条检查命令参数及被运行的初版/终版模块、测试源码：

- P:19：目录列表、`mkdir -p shared-notes`、文件列表；只建立规定的共享笔记目录，没有文件内容写入。
- P:51、123：运行子模块和集成测试；P:155：只读 `rg` 检索。
- V:29、49、68：列表、文件存在性和 stat/wc 检查；V:43：只运行 validation 测试。
- A:29、49、62：列表、存在性和 wc 检查；A:43：只运行 aggregation 测试。
- R:28：只运行 validation 测试。

没有删除命令、写重定向、后台进程、配置/runtime 修改命令。V:29 的 `2>&1 || true` 是把尚未创建的自有文件列表错误作为探查结果保留，不是测试通过证据。测试只导入这些模块及 Node 内建；aggregation 测试只读源文件，integration 测试仅派生 ledger CLI 子进程。所检查版本没有通过测试代码写文件的路径。

直接从原始 Bash toolResult 的 TAP 计数重新读取：V:43→44 为 5/5；A:43→44 为 7/7；P:51→52 为 21/21；R:28→29 为 5/5；P:123→124 为 24/24，均 fail 0。父方还在 P:33 实际读取两边源码、测试、笔记，在 P:100 读取修订源码/笔记/测试，因此父验收不只依据子 memory 自述。

## 4. Spawn、typed return 和父方接收

唯一一次 Spawn 是 P:25，包含两个任务；P:28 返回 completed 2。校验子方在 V:74 调用 `spine_child_return`，汇总子方在 A:68 调用。两次公开 memory 参数逐字等于父方 terminal 记录中的 memory_body（P:27 校验，P:26 汇总），并等于 Spawn 结果相应 ordinal 的结果。

持久 reservation 均为 terminal/completed：校验 B `6c9ba563-7c6a-4fb1-bf2a-68c1cee0e7cc`，汇总 B `6e80eade-c194-4004-aa55-f1a39c425b4f`。两者的项目 parent 都是 `d7da290c-0102-493f-9323-82c216849124`，等于 reservation.parentBranch 与 handoff.to.parent。handoff.from.binding 等于已 ended 的原子 Agent 身份，handoff.to.scopeBinding 等于父 canonical 导入后的映射。

两份 v1 memory 的来源均为父事务 `037a7a20-af36-4e78-816d-7e604d44c710-commit-2` 中各自投影节点；本次把投影 memory 与 Branch memory 逐字比较。这是 typed 返回后父方 canonical 接纳的来源，不能把它误报为子 Agent 自己 Close 的 memorySource。

V 采样区间为 10:04:41.690–10:06:07.255 UTC，A 为 10:04:39.967–10:05:38.758 UTC，确有重叠。它只证明两个真实子会话的活动重叠，不测量并行加速。V:56 实际读取 A 的笔记；A 的最后探查仍未看到 V 的笔记。没有观察到子方因同伴笔记修改实现。父拆分、typed 返回、读取、整合和独立复验本身已经构成协作，不应因缺少子方相互修订而否定。

## 5. 原 Branch 反馈闭环

原校验 B 保持 UUID、parent、goal、constraints、skills、tools 及原 spawnReservation；memory 由 v1 变 v2。`reexecution.source` 完整保留 v1 的 memory、memoryVersion、memorySource 与 scopeBinding。v2 来源为 `4b5999a4-08c6-439e-92b0-75edc8436344-commit-5`，本次重新对齐该 canonical projection 的 memory。

| 步骤 | 原始行 | 可直接核对的结果 |
|---|---|---|
| read 原 B | P:72→74 | capped，revision 2，memoryVersion 1，binding null |
| rejuvenate | P:82→83 | 新 Agent `3e41919e-09de-4c01-a75f-ea826118b9f1` 与 R 会话，仍执行原 B |
| send | P:88→89 | `validation-signed-range-1`、`mail-1`、queued |
| dispatch | P:94→95 | `receipts` 中 delivered；completions 为 completed / memoryVersion 2 / ended |
| observe | R:10→11 | `mail-1` observed；agent、session、binding 和 recipient lease 匹配 |
| read 新 B | P:100→101；P:144→150 | capped，revision 6，memoryVersion 2，binding null，reexecution completed |

最终 mailbox 仍为 observed。消息投递租约 `lease-1` 与 recipient 的执行 lease 是不同字段，本次分别核对，不混为一项。R 实际打开工作、修改三个自有文件、运行测试、Close；父方实际更新自己的测试/笔记并运行 24 项测试。此处只证明本 adapter 拥有的 ready reexecution 会话可通信，不推及任意 root/foreign Agent 通信。

## 6. 保留的限制与审查过程

第三轮复盘有 3 次采样、8 read + 1 spinetree_read + 1 bash，0 Open/Next/Close，在 root 做实质分析。第四轮明确反馈后才 Open/Close 完成纠正。因此 real-Agent 协作流程可判通过，但 autonomous usability 不能全称通过；“只读措辞导致混淆”的解释只有模型自述，未确立因果。

公开调用与九份文件的重建没有发现越权或未知净写入；没有采集全系统 filesystem syscalls，所以不能排除外部/瞬时写入后恢复同样字节。框架正常写入 `.spinetree`、session 和 driver 状态也不是模型越权写文件。运行快照终态完整性、testbed 登记及阶段 Gate 归同伴和父级，本分支不替它们背书。

执行过的只读检查均为 `python3 -B` 内联程序，返回原始 session 等值、9/9 初终产物重建、46 receipt、79 tool pairs、typed handoff 和 message/source 断言通过。一条后续紧凑展示程序曾错把 dispatch 的 `receipts` 字段称为 `delivered`，只读 KeyError 后按实际 keys 修正；没有执行写入，且主核验不受此展示错误影响。第一次协调根检查 ENOENT 后，仅在声明的同一协调目录可用时写入自己的文件。

本次引用的稳定输入 SHA256（核验时的实际值）：

- [trace-audit.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/collaboration/trace-audit.json)：`1df92c11b9dbbd5d7cbb476bacde50887b0dd67afc7261a28f56847db6285204`
- [candidate-initial.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/collaboration/candidate-initial.json)：`3936bc1a7b233178e3cbca6698c2285cdfb35901cbcf7c5d1984e2e44d7c1d54`
- [candidate-revised.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/collaboration/candidate-revised.json)：`c7f99cb5f7da656a184be49bfe0df50f92aae8a71f6102aaa4616c9232acc4b3`
- [manifest.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/collaboration/initial-artifacts/manifest.json)：`fab1b2f1b90268fdd37a42f52d5e10d9483ec5f3610379ce1c4ddcf103701b97`
- [turn-1-state.json](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/turn-1-state.json)：`a67bc52d86559d1b74025a438f201e8211ae88d1d686ae9500cca13897de52fe`
- [final-state.json](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/final-state.json)：`50d6d8bbde009aaf1b21fb8ffc0f830345f687ceda84cbcae64e905e863d8aec`
- [turn-3-answer.json](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/turn-3-answer.json)：`66712313d8c1fb75f5e1dbe8e9fdb5e1bb8df28a8ee704541e4eed8b70f814ab`
- [turn-4-answer.json](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/turn-4-answer.json)：`506ce896f2d39aefe32513b7dae94d1e65a40b6e2ab7a09afe5b47b5b8691675`
- [2026-09-28T10-01-38-876Z_037a7a20-af36-4e78-816d-7e604d44c710.jsonl](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/2026-09-28T10-01-38-876Z_037a7a20-af36-4e78-816d-7e604d44c710.jsonl)：`cf2ed66c34666c42abcd34d7a86afde979551b01276353766f70cf4856837319`
- [2026-09-28T10-14-08-427Z_4b5999a4-08c6-439e-92b0-75edc8436344.jsonl](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/2026-09-28T10-14-08-427Z_4b5999a4-08c6-439e-92b0-75edc8436344.jsonl)：`d9157c90fc8656d971dcedac96d7810466d177b97f5c04a0a582738c9f5a966b`
- [0.jsonl](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/spine-spawn/call-c5d7af2d-05a2-491a-982d-2ac7ff415feb-4_fc_c51d797e-a9ab-9c7/0.jsonl)：`65ff20d2a8455077592c98d32e2f482b0ace5a678693199be8e480025aef142d`
- [1.jsonl](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/collaboration-spinetree-grok-20260928_1612/.pi-sessions/spine-spawn/call-c5d7af2d-05a2-491a-982d-2ac7ff415feb-4_fc_c51d797e-a9ab-9c7/1.jsonl)：`01d4e72b30f41c4becad4d3bea401fa3404480d6b79d35ae142945db4d572892`

本报告的终态 peer read 和验证结果见末尾追加记录。

## 7. 最终同伴读取与本报告校验

最终读取了声明协调根中的 `report.md`，包括其完成增量。纳入两点边界：再执行接收方没有调用 spinetree_read 读取旧 B memory，所以保留旧来源不等于证明它直接使用旧 memory 推理；07 可以完成研究/验证义务，但 root 复盘问题必须以 autonomous usability 未全通过交给 08。前一点另用本分支已独立对齐的 R 调用集合核对为零，后一点与本分支 turn-3/4 核对一致。同伴所列具体 stage 文档修改要求归父级，本分支没有操作。

终态读取时尚未出现 runtime 同伴文件；未把其完成当作依赖或宣称已核 runtime 的 16,564 项。无其它协调路径。所有责任边界与未核内容均已明确，不等待同伴即可返回。

本报告 18 个文件/行号链接全部存在，12 项稳定来源 SHA256 全匹配；显式逐行空白检查及限定路径的 git diff --check 返回 0。产物和原 session 未改；本分支无采集进程或模型会话待处理。
