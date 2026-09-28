# Composition runtime、终态与候选审计

独立核验通过：冻结 runtime 完整、六个 registry owner 已 ended、终态与 Git HEAD 相同，signed 候选通过主机参考检查。登记尚未同步：2024 manifest 仍为 running，index 仍为 prepared。它们不能作为存在活进程的证据，也不能作为阶段已收口的证据。只修改本报告和约定黑板；未改 production、runtime、testbed，未读取 thinking。

## 方法与证据

- runtime：按 collaboration 的不可变清单读取全部相对路径，但将清单内旧根 runtime-collaboration-live 映射到本轮实际根 runtime-composition。枚举实际文件及 symlink，核对集合相等；逐项校验 regular file SHA256/字节数、symlink 的原始目标及目标在本快照内。16564 项全部通过。清单本身仍保留旧根字符串，不能把它当作本轮路径。
- SDK：对清单 commitFilesChecked 列出的92个 package 路径，逐项以 git show eeea5d68ff1231be43206c4038f43dc2154d8ddf:<path> 与 runtime sdk/<path> 比较字节。当前 SDK HEAD 也相同。依赖/生成文件以清单 SHA 绑定，不声称全部16564文件都由 SDK Git 跟踪；本轮未重新编译 WASM，不证明跨工具链逐位重建。
- 终态：git --git-dir=<testbed>/.spinetree/.git rev-parse HEAD 得到下方 HEAD，git show HEAD:state.json 与 final-state.json 逐字节相同。registry 六项均 ended，root cursor=[1]；interaction-session-closed.json 的15项输入 hash 逐项匹配。launch.log 的 ready/closed 公共事件与记录相同，runner exit0 引用已保存的 interaction record。
- 进程：13:39:04 UTC 的 /proc 扫描中，原 PID2383079 不存在；node/nodejs/pi 命令行参数没有本轮 testbed、composition/dialogue.mjs 或 runtime-composition。没有 PermissionError；9个进程在扫描中退出。这是本机该时点的检查，不是持续监控或系统调用审计。
- 候选：执行以下命令，exit0，stdout passed=true。它逐个检查141个验证输入，以独立字符判定和 BigInt 汇总参考核对7批、6个非数组边界和1个CLI。验证用例包括最终 signed 范围，不以旧 unsigned SPEC 作为最终反馈的边界。没有运行模型或重跑产品套件。

```sh
node /data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/composition/verify-candidate.mjs /data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024 /dev/null signed
```

输出写入 /dev/null；命令输出及本报告保留结果，未另建授权外日志。三个 ES modules 只作计算/CLI stdout，无文件写入路径；检查后全部三个 SHA 与校验报告相同。离线 offline-result.json 只读取并 hash 绑定，没有在此分支重跑离线场景。

## 可供整合的结果

```json
{
  "scope": "composition-runtime-terminal-candidate-review",
  "testbed": "/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024",
  "runtime": "/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-composition",
  "sdkCommit": "eeea5d68ff1231be43206c4038f43dc2154d8ddf",
  "runtimeIntegrityPassed": true,
  "runtimeCheckedAt": "2026-09-28T13:36:39.388592Z",
  "runtimeEntries": 16564,
  "regularFiles": 16547,
  "internalSymlinks": 17,
  "extraEntries": 0,
  "missingEntries": 0,
  "hashSizeTargetMismatches": 0,
  "listedPackageBlobsChecked": 92,
  "runtimeManifestSha256": "04872991c85636da4fd03aa59aa4a4bd899f3cb8c1c6f4ebc6b9e3fbbdf1a515",
  "wasmSha256": "71e1f4adfd43a66dbaec28116a89b1028607b04ceacb099cdfe376694b8e3acf",
  "coreSourceSha256": "2ee191f7c37f75197c80d03929eb513bd3b43a624157527f503e83a76a129205",
  "candidatePassed": true,
  "candidateContract": "signed",
  "candidateCases": {
    "validationInputs": 141,
    "aggregationBatches": 7,
    "nonArrayCases": 6,
    "cliCases": 1
  },
  "candidateArtifacts": [
    {
      "name": "ledger.mjs",
      "sha256": "b4adb8caa6d68f4626d395afb40332310cb6650e7f39827f1c695dc5dc7c575b"
    },
    {
      "name": "validation.mjs",
      "sha256": "983913effd6be0890c8546a3429f3be307ed189fc3c9acfe2a54225ea33997b5"
    },
    {
      "name": "aggregation.mjs",
      "sha256": "79ab8108460995b86011c01ad260d1f0d19eb031f8aace6e32b89c898c604e50"
    }
  ],
  "terminalStatePassed": true,
  "gitHead": "71db5ebbcbfdeb2db8bdd793ab80420af1d51be3",
  "gitStateEqualsFinalStateBytes": true,
  "finalStateSha256": "18828450d930e8ff14010200e260b75270d50936944c8b36d8e3f09a8f9d51b3",
  "registryOwners": 6,
  "registryOwnersEnded": 6,
  "rootScopeCursor": [
    1
  ],
  "closedAt": "2026-09-28T13:22:56.522Z",
  "closedRecordReferencesChecked": 15,
  "processCheckedAt": "2026-09-28T13:39:04.197641Z",
  "originalPid": 2383079,
  "originalPidExists": false,
  "matchingNodeProcesses": [],
  "unreadableProcPids": [],
  "processesVanishedDuringScan": 9,
  "registrationSynchronized": false,
  "manifestStatus": "running",
  "indexStatus": "prepared",
  "officialBenchmark": false,
  "autonomousUsabilityEstablished": false
}
```

## 登记和边界

整合方应将2024 manifest/index更新为 stopped，started_at保留 manifest实际值2026-09-28T12:29:01.097Z，ready事件为12:29:01.051Z，ended_at使用已记录closedAt。此自定义PoC没有官方benchmark scorer，勿登记为官方verified或填写虚构official_score。1929 index行仍prepared；其入口离线失败/无模型的历史应另按实际证据登记，不能把2024成功覆盖旧尝试。1943/1950/2018行已stopped。

候选和runtime通过不证明整个真实工作流自主完成。已读同伴 trajectory.md 初报：六会话86采样/receipt pairs、160工具对、2次成功Spawn/4 typed returns、一次Next+Spawn组合拒绝；父前两轮提前结束，第四轮复盘还有读集和父测试的误述。这里只把这些作为整合边界，具体轨迹/所有权由同伴报告负责，没有由本分支重复验证。

## 来源快照 SHA256

以下是本审计读取时的文件；manifest/index后续正常登记会改变hash，应保留本次状态或前后对照，不要求旧hash永远匹配。

| 路径 | SHA256 |
| --- | --- |
| [evidence/collaboration/runtime-manifest-live.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/collaboration/runtime-manifest-live.json) | `04872991c85636da4fd03aa59aa4a4bd899f3cb8c1c6f4ebc6b9e3fbbdf1a515` |
| [evidence/composition/live-preparation.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/live-preparation.json) | `3b5431a4fd0a55c6e06ea2e1ff4ead5c58e4f5c2a5fc8cf00bdaf0bb1a1c0859` |
| [evidence/composition/interaction-session-closed.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/interaction-session-closed.json) | `762ab2b4d358fd392600f613f52fcd7aa440779e093ee8710957f70c741cbc9f` |
| [evidence/composition/offline-result.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/evidence/composition/offline-result.json) | `32e47eae0f228546a428e9786c27665709dae06f403fff0167e2577428ec3faf` |
| [composition/verify-candidate.mjs](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/composition/verify-candidate.mjs) | `7ff349a3a4c43c8bd85eb7d69495e9d77c08abe6d97a4a64eab7128c4d67f2e6` |
| [composition/dialogue.mjs](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/composition/dialogue.mjs) | `fcc4223a0588fdf850fe9acc6bb434d42c07e40b36c8d47ac52084c9d2eac9f8` |
| [composition/child-provider.mjs](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/composition/child-provider.mjs) | `a6c629c4ba8e01c147a4f87554b4afc341e42ab17f2d9a74cc77b595dcf0901c` |
| [composition/child-preload.mjs](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/composition/child-preload.mjs) | `b503f8e40562dab035fa7dc911b3e911bb16bdea5f7185f2e6e31ec265d3d0b2` |
| [runtime-composition/sdk/core-source.json](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-composition/sdk/core-source.json) | `2ee191f7c37f75197c80d03929eb513bd3b43a624157527f503e83a76a129205` |
| [runtime-composition/sdk/packages/plugin/spine.toml](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-composition/sdk/packages/plugin/spine.toml) | `c9041235c01258d922f701aac1d4e43f716fb2a1cbd646bdcec26ddd1a835ca6` |
| [runtime-composition/sdk/packages/sdk/wasm/node/spine_wasm_bg.wasm](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-composition/sdk/packages/sdk/wasm/node/spine_wasm_bg.wasm) | `71e1f4adfd43a66dbaec28116a89b1028607b04ceacb099cdfe376694b8e3acf` |
| [runtime-composition/sdk/packages/spinetree-plugin/dist/index.js](/data/swe/FramePilot/cachetree/scaffold/spine-sdk-plugin/tasks/sdk_review_branch_e2e_20260928_1232/runtime-composition/sdk/packages/spinetree-plugin/dist/index.js) | `306c27f42b22c6de876cab5806074d98ab3ea08df55d2173ea3c05e05a08bf1d` |
| [composition-spinetree-grok-20260928_2024/ready.json](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/ready.json) | `623b0fad869daca88b32e0ffaf3173685c892c28bd45399ae6fc8429d23a84ff` |
| [composition-spinetree-grok-20260928_2024/launch.log](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/launch.log) | `2280395a641ba52f5aae8d9409f0264c5dd17fde2dec2854c6cc49ad321a6576` |
| [composition-spinetree-grok-20260928_2024/final-state.json](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/final-state.json) | `18828450d930e8ff14010200e260b75270d50936944c8b36d8e3f09a8f9d51b3` |
| [composition-spinetree-grok-20260928_2024/manifest.yaml](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/manifest.yaml) | `9cf410d00da8f4e79b1c08de800d210a5320f6b8eed97961d8035a001d04237c` |
| [index.tsv](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/index.tsv) | `85c0bf3bd8735aa60f8922ed1be2b2de53d4a31181eddc8eebe22586147e7c36` |
| [composition-spinetree-grok-20260928_2024/SPEC.md](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/SPEC.md) | `4f20b293f42856571279b6ba367faaf78b43ddeafa9406352a6453c4258b78ee` |
| [composition-spinetree-grok-20260928_2024/GOAL.md](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/GOAL.md) | `f1560469df96a7772d42ba0ce6aeffb9061e12f1cc39a803dc3671bbe6ae78bf` |
| [composition-spinetree-grok-20260928_2024/ledger.mjs](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/ledger.mjs) | `b4adb8caa6d68f4626d395afb40332310cb6650e7f39827f1c695dc5dc7c575b` |
| [composition-spinetree-grok-20260928_2024/validation.mjs](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/validation.mjs) | `983913effd6be0890c8546a3429f3be307ed189fc3c9acfe2a54225ea33997b5` |
| [composition-spinetree-grok-20260928_2024/aggregation.mjs](/data/swe/FramePilot/cachetree/scaffold/project-tree-poc/temp/testbed/composition-spinetree-grok-20260928_2024/aggregation.mjs) | `79ab8108460995b86011c01ad260d1f0d19eb031f8aace6e32b89c898c604e50` |

补充枚举中一次将普通目录也记为 other，出现1581个伪 extra；随后只枚举文件/symlink，确认16564项集合相等，1581个目录均为容器目录。该补充轮全部文件hash/尺寸仍为0 mismatch；不是runtime漂移。候选命令两次执行均exit0、结果相同，不将重复执行算成新的覆盖。
