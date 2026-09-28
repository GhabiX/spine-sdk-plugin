# 再执行失败清理修复

本分支修复 ready 异步等待期间 ownership 被替换后，旧请求错误清理新 owner 的问题。仅更改 SpineTree 的实现、回归测试及相关 README；未提交，提交由父级统一完成。

## 已复现的错误

在 MemorySpineTreeStore 中先启动 capped branch 再执行，在 ready 回调里替换相同 Agent/session/binding 的 leaseId 或 operationId，同步 registry 与 branch.reexecution.binding，然后抛出旧 attach 错误。

[修复前日志](fail-before-state.log)两例均失败：替换后的 HEAD 从 memory-3 变成 memory-4，新 registry entry 被标记 ended，release 被调用一次。更早只检查错误码的失败也保存在 [fail-before.log](fail-before.log)。这是一条真实执行的回归，不再只是源码推导。

## 最小实现变化

[index.ts](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/src/index.ts:1390)在 failure CAS 内核对执行阶段、registry 与 branch 的原始完整 ownership。使用既有 isWorkingBinding/sameRecipient，并核对 branch、scope、operation、epoch、cursor 和 running 状态。替换或推进的 owner 导致 invalid-binding，不写快照。

release 从 CAS 前移到成功 fencing CAS 后。正常 attach 失败仍保留原错误；只有清理已确认属于本次 allocation 时才调用 release。release 也失败时 AggregateError 保留两个原始错误。适配器仍须只释放传入原 binding 对应的 allocation；此改动不声称消除了外部进程故障或跨存储事务。

[README](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/README.md:143)同步说明 ownership 和外部 cleanup 边界。既有 archive/import 限制未改动。

## 验证

- 构建：npm run build -w @spinetree/plugin，exit 0，[最终构建日志](build-after-02.log)。此前 build-after.log 亦保留。
- 组件测试：[test-command.json](test-command.json)固定完整调用及 task-local 临时根；[tests-after.log](tests-after.log)记录 153 pass、0 fail、0 skipped，7.523 秒。
- [回归测试](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/packages/spinetree-plugin/test/rejuvenate.test.mjs:96)涵盖普通 release 顺序，lease/operation 替换，单独 registry/branch 替换，cursor 推进，CAS 冲突重读，以及 attach/release 双错误。
- 修复后的替换路径保持原 HEAD 和完整 snapshot，release 为 0；CAS 竞争场景同样不会覆盖后来 owner。
- scoped git diff --check 通过。没有重新执行无关 SDK/core 构建，没有模型、Docker 或评分调用；无删除操作，测试临时资料保留。

## 同伴读取与边界

最终读取 fixes/core.md 与 fixes/pi.md：core 同伴已固定 base+patch 和 48 个来源文件并准备构建验证；Pi 同伴已动态确认并修复静默 A/custom B 的顺序，组件套件仍在运行。两项都不作为本分支测试的证明。本分支未写同伴文件，也未扩展为 archive/结构修复；父级负责完整集成检查和 commit。
