# 08 组合真实 Agent 结果

组合工作流最终完成，独立候选检查通过；自主可用性未通过。首两轮提前结束并作出早于实际产物的完成声明，主机两次要求继续后才完成。最终只读复盘自主 Open/Close，但仍误述读取对象和父方验证。

## 输入与结果

- SDK `eeea5d68ff1231be43206c4038f43dc2154d8ddf`，Grok 4.7 high，独立 testbed `composition-spinetree-grok-20260928_2024`，四次交互。
- 六会话，86 次采样及 canonical receipt，160 组工具调用，26 次 offer，114 个 Git HEAD；无 provider error 或 spine fault。一项 Pi 工具错误是 Next+Spawn 组合被拒绝。
- 两次成功 Spawn、四份 typed return；父方两次执行全部三个测试文件，各 20/20 通过。
- 同校验 Branch memory v1→v2，旧正文和来源保留，接收方确实读回 v1 并观察 mailbox。身份不变；随后 move/archive 后继续工作，归档项保持不变。
- 根 checker unsigned→signed，局部 cap-100 覆盖及兄弟继承成立；25 次资源 journal 中 4 次发布、21 次执行。旧 skill 的 unsigned 证据仍保留。
- 主机 signed 候选检查：141 输入、7 批次、6 非数组边界、1 CLI，通过。三个模块 hash 见 runtime 报告。
- 19 份产物由记录的写入、编辑和两次历史复制逐字节重建，未见越权或无法解释的净变化；不是系统调用审计。
- runtime 16,564 项无漂移，92 个 package blobs 等于 SDK commit。六 owner ended、root cursor `[1]`，终态等于 Git HEAD `71db5ebbcbfdeb2db8bdd793ab80420af1d51be3`，本轮进程已退出。

## 未通过项和结论边界

两次提前 final、一次 Next+Spawn 拒绝、三次 checker argv 探测失败、一次未修复的笔记格式断言失败全部保留。笔记断言之后的模块测试通过，不能据外层 Bash 成功把内部失败抹掉。

第四轮实际读 archived validation、local checker 和自身 review Branch，以及两个笔记文件；回答误称读了项目 parent 和另外四份笔记。它对“父方没有重跑”的概括也不准确：父方此前两次 20/20 并有独立直接调用，第四轮本身没有重跑。

当前 binding null、completed reexecution 与历史 allocation running 的区分正确。本轮自主关闭复盘不代表此前漏 Close、root 复盘或提前结束问题已解决。实验 seed 提示变更只属于本轮，不是生产修复或因果证明。

机制/最终工作流通过；`autonomousUsabilityPassed=false`，`generalUsabilityEstablished=false`。不宣称 skill 因果收益、并行加速、任意通信、merge/prune 或官方 benchmark 成绩。

## 证据与登记

- [轨迹及所有权](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/trajectory-review.md)：原始事件、逐项来源和失败定位。
- [runtime 与候选核验](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/runtime-review.md)：完整性、候选命令及终态；其中登记状态是修正前快照。
- [交互评估](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/interaction-review.json)；[机器结果](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/live-result.json)；[离线结果](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/offline-result.json)。
- [登记前后对照](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/testbed-registration.json)：2024 从 running/prepared 改 stopped；1929 为放弃的无模型入口，精确停止时间未知，保留 null。其它 index 行不变。1943/1950/2018 的无模型入口记录仍保留。

没有新增生产修改、模型请求或产品测试。本次仅整合已通过的独立核验。09 负责最终分项覆盖矩阵、未解决项和精简提交。
