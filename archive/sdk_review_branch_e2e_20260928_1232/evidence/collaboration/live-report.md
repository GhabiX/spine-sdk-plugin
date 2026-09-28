# 07 真实多 Agent 协作与原 Branch 反馈

真实协作和反馈工作流通过；自主可用性尚未全部通过。第三轮实质复盘直接在 root 进行，第四轮收到明确反馈后才用 Open/Close 纠正。这个问题交给08组合验证，不能用功能通过代替分支纪律通过。

运行采用 SDK `eeea5d68ff1231be43206c4038f43dc2154d8ddf`、Grok 4.7 high，独立 testbed `collaboration-spinetree-grok-20260928_1612`。这是功能 PoC，不是官方 benchmark，没有官方分数。

## 已验证的协作链

一次 Spawn 把 validation 与 aggregation 分给两个独立子 Agent，文件所有权分离，共用 `shared-notes`。两次 `spine_child_return` 的正文与父方 typed terminal、Spawn 结果和持久 handoff 一致。父方随后实际读取子方源码、测试及笔记，完成 ledger 集成，并独立运行21项测试；没有只接受子方的5项/7项测试自述。

两个初始子会话的采样时段重叠：校验10:04:41.690–10:06:07.255 UTC，汇总10:04:39.967–10:05:38.758 UTC。校验子方读到了汇总笔记，但没有据此修订实现。父方拆分、返回、检查和整合已经构成协作；尚无双向子方知识修订或并行加速证据。

第二输入给定原校验 Branch `6c9ba563-7c6a-4fb1-bf2a-68c1cee0e7cc` 并要求扩展负数范围。父方自行选择 read → rejuvenate → send → dispatch；接收方实际 observe、读取和修改自己的三个文件、测试并Close；父方再次读取Branch与源码，更新自己的集成测试和笔记，运行24项测试全部通过。mailbox最终为observed。父方界面未单独回显observed，不能解释为没有确认接收。

同一Branch的UUID、parent、goal保持，memory v1→v2；v1正文、memorySource与scopeBinding保留在 `reexecution.source`，当前v2来源指向新会话。接收方未调用spinetree_read读取v1，因此不声称它直接利用旧Branch memory推理。旧SPEC和旧memory仍保留非负范围，明确的新需求在本轮成功生效。

## 功能、轨迹与终态

| 检查 | 初版 | 有符号修订版 |
| --- | ---: | ---: |
| 主机独立校验输入 | 141通过 | 141通过 |
| 主机独立汇总批次 | 7通过 | 7通过 |
| 非数组输入 | 6通过 | 6通过 |
| CLI | 1通过 | 1通过 |
| 父方实际运行测试 | 21通过 | 24通过 |

ledger和aggregation实现字节前后不变；validation SHA256由 `5b72d921957ded446d0fe9d6f9e19719e25c4841c9b45f7929fa59e84a8e3b2d` 改为 `d808cff8a86740b700eb91c31333cd9a87da22c7aac05a2058a0327f263faca1`。所有权复核逐字节重建九份初终产物，核对9次write、5次edit中的7个替换和全部13条Bash；未发现越权写入或无法解释的净变化。这是公开调用和产物审计，不是系统调用级全盘无写入证明。

全部4个真实session共46次采样、46对canonical receipt、79组工具调用/结果、15份资源offer、62个Git状态。子会话的继承前缀已从计数排除。Open/Close各4次，Spawn1次，typed return2次；rejuvenate/send/dispatch/observe各1次。公开轨迹没有provider、tool或Spine fault。

启动于 `2026-09-28T10:01:39.071Z`，正常关闭于 `2026-09-28T10:27:08.448Z`。四个registry owner均ended，根cursor为[1]。`2026-09-28T11:01:35.056936+00:00` 的终态检查确认原PID不存在、没有关联Node进程；16,564运行项（16,547文件＋17内部链接）全部匹配，无额外项，92个已跟踪package文件匹配提交。testbed的manifest和唯一index行现登记stopped；其它index行未变。

usage：input 335,968，output 56,403，cacheRead 958,080，cacheWrite 0，totalTokens 1,350,451。reasoning包含在output，不重复累加；美元费用未知。

## 使用复盘与保留边界

第三轮为3次采样、8 read＋1 spinetree_read＋1 bash，0 Open/Next/Close，在root做实质分析。第四轮的输入明确给出事实并要求正常生命周期，随后Open/Close各1次。这是提示后纠正，不是自主修复，也不是已开分支漏Close或运行泄漏。模型把原因归于“只读、不改历史”的措辞；这里只把它作为待验证解释。

本轮正确区分current binding null、reexecution completed和历史allocation中的running；不能因此推断说明修改的因果效果。三项继承skill始终同版，行为与指导吻合，不证明skill必要性、收益或版本演化。关于“无实质协同”的过宽措辞经反馈收窄；没有把看不见某条当前投影记录当作从未发生。

本轮没有测试资源发布、项目parent移动/归档、任意持久图合并或canonical裁切；消息能力限于adapter拥有的ready再执行会话。

## 失败留痕与证据

此前离线真实多进程运行出现Git HEAD.lock竞争，修复已提交eeea5d68；合成锁回归和随后离线协作通过。这不是本次真实模型运行的新fault。首次live审计因误把再执行Close后的RootEpoch assignment floor与保留的Task scopeBinding等同而失败；修正检查器后通过，冻结runtime未改。旧日志和脚本均保留。

- [全部轨迹与来源](trace-audit.json)
- [文件所有权及原始工具行](ownership-review.md)
- [初版独立功能检查](candidate-initial.json) / [修订版检查](candidate-revised.json)
- [交互事实、自述与解释分列](interaction-review.json)
- [终态运行包和进程核验](runtime-close-validation.json)
- [testbed登记前后记录](testbed-registration.json)
- [Git锁修复与离线证据](git-lock/report.md)
- [审计假设修正](audit-offer-resolution.json)
- [结构化结果与来源hash](live-result.json)
- [最终证据验证](live-validation.json)
