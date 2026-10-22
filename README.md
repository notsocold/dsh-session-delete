# dsh-session-delete

**给 DeepSeek Harness 补上官方缺失的「删除会话」。**

DSH 有归档、重命名、分叉，却没有真正的删除：归档只是把会话收进归档集合，日志仍留在 `~/.dsh/sessions`。本插件在侧栏每个会话的 `⋯` 菜单里加一项「删除会话…」，确认后**真删**会话日志、投影缓存、分组登记与工作区快照；默认先移入本机回收站，可恢复。

> English summary: this plugin restores a real "Delete session" capability for DeepSeek Harness. It removes the JSONL session log, the `session_projcache` row, the workspace accounting (grouping/archive/pin) and the `dsh-workspace-session` snapshot, with a local recycle bin and a management settings page.

---

## 功能

| 能力 | 说明 |
|---|---|
| 侧栏菜单删除 | 每个会话行的 `⋯` 菜单新增红色「删除会话…」（内置置顶/重命名/分叉/归档之后的 order 460） |
| 运行中置灰 | 会话还在回复、等待审批/回答时菜单项不可点；Host 侧删除前会再查一次，UI 状态过期也拦得住 |
| 二次确认 | 确认框显示工作区、创建时间、占用空间、归档状态，并可勾选"移入回收站" |
| 真删链路 | 会话目录 + `session_projcache` 行 + 分组/置顶/归档登记；默认进回收站，关闭则直接擦除 |
| 工作区快照联动 | 同时删除 `<workspace>/.dsh/sessions/<id>/`，避免 `dsh-workspace-session` 把删掉的会话重新导入（"复活"） |
| 回收站 | `~/.dsh/dsh-session-delete/trash/`；可恢复（含快照）或彻底删除 |
| 会话管理页 | 设置 → 会话删除：全量会话列表、搜索、按工作区分组、批量删除、回收站管理、插件开关 |
| 立即刷新 | 删除成功后广播 `api-session/removed`，侧栏对应行立即消失 |
| 不碰附件 | `~/.dsh/attachments/` 按内容哈希共享，保留不动 |

---

## 为什么官方没有

- JSONL 持久化后端 README 明确写着：**不删除会话文件**——日志在 `root` 下累积，直到外部移除；seam 无删除接口。
- 侧栏里曾经那个 visual-only 的「删除会话」占位，在 2026-07 的提交里被换成了「归档会话」。

所以「删除」只能由插件在官方 seam 之外完成：直接清理磁盘、投影缓存与工作区账本，并用框架事件让客户端掉行。本插件不修改任何官方装载行，也不 patch `app.asar`。

---

## 安装

在 DSH 中安装（推荐，源码目录即插件目录）：

```text
plugin_manager install_bundle
  target: /home/<user>/work/NodeJsProjects/dsh-session-delete
```

安装后刷新 Web 页面；若 Host 行为有更新，可重启 `dsh web` 进程或通过插件页禁用→启用一次本插件。

---

## 使用

### 删除单个会话

1. 侧栏会话行悬停 → `⋯`
2. 点「删除会话…」
3. 确认框里核对信息，选择是否移入回收站
4. 点「删除」

运行中的会话菜单项会置灰；若确认框打开后会话又忙起来，确认按钮也会拒绝并提示。

### 批量清理

设置 → **会话删除** → 「会话」页签：

- 搜索标题 / 会话 ID / 工作区
- 勾选多个会话 → 「删除选中」
- 或逐行点「删除」

### 回收站

设置 → 会话删除 → 「回收站」：

- **恢复**：把会话日志与工作区快照放回原位，并尝试重新挂回原工作区
- **彻底删除**：永久擦除该项
- **清空回收站**：一次清空（受「保留天数」约束）

---

## 删除到底做了什么

| | |
|---|---|
| ✅ 删除 | 会话日志目录（`~/.dsh/sessions/<project>/<id>/`）、`session_projcache` 行与背板文件、工作区分组登记、全局归档/置顶标记、`<workspace>/.dsh/sessions/<id>/` 快照 |
| ⛔ 不删除 | `~/.dsh/attachments/` 附件原件（按内容共享）、其他插件自己复制的副本、本插件自己的回收站元数据 |

删除是**不可恢复的**（除非进了回收站）。删除后侧栏立即移除，刷新页面也不会回来。

---

## 配置

配置文件：`~/.dsh/dsh-session-delete/config.json`（也可在设置页修改）。

| 字段 | 默认 | 说明 |
|---|---|---|
| `sessionsRoot` | `""` | 会话根目录覆盖；空 = 自动探测（优先读 JSONL 后端的 root，否则 `$DSH_HOME/sessions`） |
| `trashEnabled` | `true` | 默认移入回收站 |
| `snapshotCleanup` | `true` | 同时删除工作区会话快照（`dsh-workspace-session`） |
| `projCacheCleanup` | `true` | 同时删除投影缓存行 |
| `keepDays` | `0` | 回收站保留天数，0 = 永久 |

---

## 与 dsh-workspace-session 的配合

本机安装 `dsh-workspace-session` 时，属于工作区的会话会镜像到 `<workspace>/.dsh/sessions/`。如果只删原生日志，下次导入（启动扫描/手动"从工作区导入"/另一台机器同步）会把会话**重新导入**。

本插件 `snapshotCleanup` 默认开启：删除时把快照一并移入回收站（或删除），因此不会复活；回收站恢复时快照也一起还原。

---

## 边界与限制

- **运行中会话不可删**：回复中、等待审批/回答、运行中的子代理等会被拒绝（与官方归档的忙碌判定同源）。
- **内存残留**：DSH 没有公开的会话卸载 API，本插件探测框架内部拆除路径（`liveEntryFor`/`detachEntered`）把驻留会话从内存移除并关闭写入器；若某版本移除了这些内部成员，插件会降级为"只藏不删"并**如实报告**，不会假装删干净。
- **Agent 残留**：已驻留会话的 Agent 对象可能保留到进程退出（官方没有公开卸载入口），但它不再出现在任何列表里，重启后彻底消失。
- **其他插件副本**：例如 dsh-memory 的独立数据、第三方插件自己抄到数据库里的记录，不在本插件的删除范围内。
- **投影缓存**：通过活动 `storageDomain` 删除，避免写回型缓存把文件重新写出来；若存储域不可用会跳过并如实返回。

---

## 安全

- 所有 HTTP 接口都注册在官方 `/api` 认证围栏内（`ctx.connection.fetch`），只有页面 owner peer 能访问；外部连接拿不到数据。
- 路径经 `encodeSegment` 与 `projectKey` 编码，`../`、绝对路径、NUL 等会被中和。
- 只删除目标会话自己的目录；回收站写入在 `$DSH_HOME/dsh-session-delete/` 下。
- 无任何网络请求、无遥测。

---

## 测试

```bash
node --test test/*.test.js      # 20 个 Host 单元/冒烟测试
npm run check                   # 语法检查
```

覆盖：编码与路径规则（含裸 uuid / `session-` 前缀双拼写）、配置校验、删除链路、回收站、恢复、忙碌拒绝、快照联动、HTTP 路由信封。

---

## 卸载

在插件页移除本插件即可。回收站数据保留在 `~/.dsh/dsh-session-delete/`，可手动删除。
