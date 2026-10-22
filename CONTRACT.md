# CONTRACT

本文件描述 `dsh-session-delete` 对宿主、浏览器与文件系统的稳定契约。

## Host

### 插件

- 包名：`@local/dsh-session-delete`
- Cordis 插件名：`dsh-session-delete`（装载行 id `session-delete`）
- 必需注入：`sessionPersistence`
- 可选服务（防御式读取）：`workspaceRegistry`、`sessions`、`storageDomain`、`connection`、`sessionQuery`

### 依赖的 Harness 服务/事件

| 名称 | 用途 |
|---|---|
| `ctx.sessionPersistence.stat/list` | 读取会话 header（cwd/createdAt/大小），判断存在性 |
| `ctx.workspaceRegistry.list()` + `Workspace.detachSession()` | 清理分组登记 |
| `ctx.workspaceRegistry.unarchiveSession()/unpinSession()` | 清理全局归档/置顶集合 |
| `ctx.get('sessions').get/flush/liveEntryFor/detachEntered` | 驻留会话的 flush 与卸载（内部成员，能力探测） |
| `ctx.waterfall('workspace/session-activity')` | 忙碌判定（与官方归档同源） |
| `ctx.get('storageDomain').get('session_projcache').table('sessions').delete()` | 删除投影缓存行 |
| `ctx.get('sessionQuery').readTitleSnapshots()` | 管理页标题折叠（失败降级为空） |
| `ctx.connection.fetch.register()` | 注册认证围栏内的 HTTP 路由 |
| `ctx.emit('api-session/removed')` | 通知客户端移除侧栏行 |

### 文件契约

| 路径 | 读写 | 内容 |
|---|---|---|
| `$DSH_HOME/sessions/<projectKey>/<encoded-id>/` | 插件移动/删除 | 会话日志目录（JSONL 后端布局） |
| `<workspace>/.dsh/sessions/<encoded-id>/` | 插件移动/删除 | `dsh-workspace-session` 快照镜像 |
| `$DSH_HOME/dsh-session-delete/config.json` | 插件读写 | 本插件配置 |
| `$DSH_HOME/dsh-session-delete/trash/<trashId>/meta.json` | 插件读写 | 回收站元数据（sessionId/cwd/projectKey/删除时间/大小/快照来源） |
| `$DSH_HOME/dsh-session-delete/trash/<trashId>/session/` | 插件移动 | 原会话目录内容 |
| `$DSH_HOME/dsh-session-delete/trash/<trashId>/snapshot/` | 插件移动 | 原工作区快照目录内容 |

## HTTP API

前缀：`/api/dsh-session-delete`；全部通过 `ctx.connection.fetch` 注册（owner peer 限定）。

响应统一信封：`{ "ok": true, "value": … }` 或 `{ "ok": false, "error": { "code", "message", "details?" } }`。

| 方法 路径 | body/query | 行为 |
|---|---|---|
| `GET /list` | `?refresh=1` 可选 | `{ trash, config, counts }`；只读回收站与配置，overview 缓存 2 分钟，`refresh=1` 强制重扫 |
| `POST /titles` | `{ ids }` | `{ titles }` 折叠显示标题；保留接口，当前管理页不再使用 |
| `GET /status` | `?sessionId=` | 单会话删除前置信息（busy/archived/pinned/大小/目录/快照目录） |
| `POST /delete` | `{ sessionId, trash? }` | 删除会话；`trash:false` 直接擦除 |
| `POST /restore` | `{ trashId }` | 从回收站恢复（含快照）并尝试重新挂回工作区 |
| `POST /purge` | `{ trashId }` | 彻底删除回收站项 |
| `POST /empty-trash` | `{}` | 清空回收站（受 `keepDays` 约束） |
| `POST /config` | `{ patch }` | 校验并保存配置 |
| `GET /state` | — | `{ config, counts }` 汇总 |

错误码：`invalid-request`(400)、`not-found`(404)、`session-busy`/`already-exists`(409)、`internal`(500)。

## Client

- 入口：`client.js`，通过 `window.__ModuleLoader__.load({ id: '@local/dsh-session-delete', factory })` 注册。
- 依赖：`slots`、`locale`；`ctx` 与内嵌字典兜底。
- 注册：
  - `sidebar.workspaces.session.menu.item`（id `dsh-session-delete`，order 460）——菜单项
  - `shell.overlay`（id `dsh-session-delete`）——确认对话框
  - `shell.overlay`（id `dsh-session-delete-toast`，order 90）——全局 toast
  - `settings.section`（id `session-delete`，order 45）——管理页
- 样式：注入 `<style id="dsh-session-delete-style">`，随插件 fiber 卸载移除。

## 删除顺序（稳定性契约）

```
1. 忙碌检查（waterfall）→ 拒绝
2. 驻留则 flush
3. 先移动/删除会话日志目录
4. 卸载驻留会话（session/disposed 时快照插件已无日志可导出）
5. 清工作区分组 / 归档 / 置顶
6. 移动/删除工作区快照
7. 删除投影缓存行
8. emit api-session/removed
9. 250ms 后复查并再次清理迟到写入的快照
10. 写回收站 meta（若启用了回收站）
```

第 3 步先于第 4 步，是为了让 `dsh-workspace-session` 在 `session/disposed` 时 `stat` 不到日志而跳过导出；第 9 步兜住它防抖导出的竞态。
