# 设计记录

## 目标

补回 DSH 官方缺失的「删除会话」，同时满足四条约束：

1. **真删**——不留"看起来删了、下次又冒出来"的尾巴；
2. **可恢复**——默认进回收站，误删能救；
3. **不碰宿主**——不 patch `app.asar`、不改官方装载行，DSH 升级不受影响；
4. **与本机已有插件协同**——尤其 `dsh-workspace-session` 的快照不能把会话带回来。

## 关键决策

### 1. 扩展点选官方 list slot，而不是自绘 UI

`sidebar.workspaces.session.menu.item` 是官方给插件预留的会话行菜单列表（内置 pin=100 / rename=200 / fork=300 / archive=400 / session-id=450）。本插件以 order 460 插入一项，和内置动作平级；确认框和 toast 放在 frame-wide 的 `shell.overlay`，菜单关闭不会连带销毁对话框。管理页注册在 `settings.section`。

### 2. 删除顺序：先删文件，再 detach 内存会话

`dsh-workspace-session` 在 `session/disposed` 时会导出快照。如果先 detach 再删文件，export 路径此刻仍能 `stat` 到日志，会把快照重新写出来——用户删完 60 秒内又被导入"复活"。

因此顺序固定为：

```
flush → 移动/删除日志目录 → detach → 清账本 → 清快照 → 清投影缓存 → 广播 → 250ms 复查快照
```

先删日志后 detach，让 exporter 的 `persistence.stat()` 落空而跳过；250ms 复查兜住它 60ms 防抖导出的竞态。

### 3. 两套 id 拼写都要处理

真实存储里同时存在 `<uuid>` 与 `session-<uuid>` 两种目录名（历史数据）。`locateSessionDir` / `locateSnapshotDir` 会遍历 `sessionIdVariants`，账本 detach/unarchive/unpin 与 projcache 删除同样按两种拼写执行。路径规则从 `session-persistence-jsonl` 的 `encodeSegment` / `projectKey` 逐字移植，并用本机真实目录验证过一致。

### 4. 驻留会话的卸载是能力探测

DSH 没有公开的会话卸载 API。插件调用框架自己的拆除原语 `SessionStore.liveEntryFor(session).detach()`（等价于 `store.delete` + `session/disposed`），并对每一步做能力探测：

- 探测失败 → 走"归档隐藏"降级，并在 API 响应里如实标注 `hidden`，绝不谎报删除成功；
- 成功 → 客户端收到 `api-session/removed`，侧栏行真正消失、日志写入器关闭、投影缓存清掉脏标记。

Agent 对象没有公开卸载入口，属于已知残留：它不再出现在任何列表里，重启后消失。

### 5. 回收站用 rename 而不是复制

会话目录与回收站同在 `$DSH_HOME` 下，`rename` 是原子的且不产生额外 IO。跨文件系统（自定义 `sessionsRoot`）自动退化为 `cp + rm`。恢复时把 `session/` 与 `snapshot/` 各放回原位，并通过 `workspaceRegistry.resolveByPath(cwd)` 尝试重新 `attachSession`。

### 6. 加载性能：一次 overview + 异步标题

设置页早期版本有两个问题：`/list` 与 `/state` 各跑一次「全量会话列表 + 标题折叠」，而标题折叠要读并解析每个会话的完整事件日志（本机 92 个会话 / 36MB 日志时尤其明显）。

现在：

- `/list` 返回合并的 overview（sessions + trash + config + counts），列表本身不折叠标题；
- overview 缓存 2 分钟，删除/恢复/清空/改配置都会 `invalidate()`；「刷新」按钮用 `?refresh=1` 强制重扫；
- 标题通过 `POST /titles` 在列表渲染后异步折叠（8 秒上限；已折叠的会话进内存缓存，不重复读）。

### 7. 配置与根目录

会话根目录解析顺序：`config.sessionsRoot` → JSONL 后端的私有 `root`（尽力探测，兼容自定义部署）→ `$DSH_HOME/sessions`（官方默认）。配置存在 `$DSH_HOME/dsh-session-delete/config.json`，设置页可改。

### 8. 安全

- 全部路由走 `ctx.connection.fetch`，天然位于 `/api` 认证围栏内，非 owner peer 返回 401；
- 路径先经 `encodeSegment`/`projectKey` 编码，再用于文件系统；
- 只动目标会话自己的目录；附件按内容共享，保留不动；
- 无网络请求、无遥测。
