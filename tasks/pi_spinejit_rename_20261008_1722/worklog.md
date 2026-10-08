# pi-spinejit 改名与发布

用户授权统一处理名称、发布流程、文档和迁移。目标 @spinejit/pi-spinejit@0.1.0，SDK/host 维持原名和 0.1.0。npm 登录已失效（401），已发起 web 登录。

- npm web 登录完成，npm whoami=ghabix。
- 更新 30 个 active tracked 文件：包名、import、host 注册依赖、测试 fixture、锁文件、README 和 release workflow；源码改动仅包身份字符串。历史协议 schema 和 session 数据格式保持原值。
- workflow 改为选择 plugin/sdk/host，默认只发 plugin，避免重发已存在的 SDK/host 0.1.0。
- workflow YAML 解析和单包发布目标检查通过。

- 全套 npm test 380/380 通过；core-source 验证 48 files。
- 独立 consumer 安装 tarball 成功（从 registry 获取 SDK/host/Pi 依赖）；首次 smoke 脚本误用 CommonJS require.resolve 定位 ESM-only 包，改用 import.meta.resolve，产品代码无需调整。

- 55a9e9f 已提交并推送到 origin/main；GitHub 描述和 topic 已同步 pi-spinejit。
- 测试 tarball shasum=1c5a0277d45a0989c90ffd3b478cc6761c0748ae。独立 consumer 的所有 7 个导出导入成功，Pi loader errors=[]、四个工具正确，owner ID 为新包名。
- 首次非 TTY 发布遇 npm EOTP；TTY 重试在打开本机浏览器时退出。已以 --browser=false 重新发起，等待用户完成当前网页验证。尚未标记旧包弃用。

- npm 10 publish 命令 exit 0 后，registry 曾短暂只返回 0.0.0-stage placeholder。使用 task-local npm 11.21.0 检查 stage list 为空；随后 /0.1.0 与 /latest 已返回实际版本，SHA-512/shasum 与测试包一致。
- registry abbreviated metadata (Accept application/vnd.npm.install-v1+json) 已显示 latest 0.1.0，但 full JSON / npm 正常安装仍暂报 404。继续验证正常安装，未弃用旧包；不能凭 publish exit 0 宣称安装已闭环。

- 正常 registry 安装已成功：npm 10 安装 123 packages；同一 smoke 完整通过，四个工具与 7 个导出均正常。
- 隔离 PI_CODING_AGENT_DIR 下 pi install npm:@spinejit/pi-spinejit 成功（4 packages）；pi list 返回新包。未改用户真实 Pi settings。
- 旧包弃用命令已提交到 npm 2FA 验证流程，等待独立身份验证；不删除/下架旧版本。

- 当前 pending 项仅 npm 旧包弃用的 web 2FA；发布进程在等待。目录详情/搜索结果见 validation/pi-directory-latest.json。执行树 root 标记 blocked，完成账号验证后应先恢复并检查 session/registry，避免重复发布新包。
