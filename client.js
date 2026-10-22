/**
 * dsh-session-delete browser half.
 *
 * Three surfaces over the Host routes in `lib/api.js`:
 *   * `sidebar.workspaces.session.menu.item` — "Delete session" in every
 *     session row's "…" menu (greyed while the session owns running work);
 *   * `shell.overlay` — one confirmation dialog, alive even after the menu
 *     closes, with an optional "move to recycle bin" choice;
 *   * `settings.section` — the management page: browse every session, delete
 *     in bulk, restore or purge recycle-bin items, and tune the plugin.
 *
 * Build-free lazy CommonJS; the only require is React. All data comes from the
 * authenticated same-origin routes in lib/api.js.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-delete',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'dsh-session-delete'
    const API = '/api/dsh-session-delete'
    const SETTINGS_ORDER = 45
    const STYLE_ID = 'dsh-session-delete-style'
    const DANGER = '#e5484d'

    // ---------------------------------------------------------------------
    // Dictionaries (registered with the locale service; embedded fallback is
    // used when the service is absent).
    // ---------------------------------------------------------------------
    const zh = {
      nav: '会话删除',
      'menu.delete': '删除会话…',
      'menu.busy': '会话运行中，无法删除',
      'confirm.title': '删除此会话？',
      'confirm.desc': '将永久删除「{title}」的对话记录与本地数据。',
      'confirm.workspace': '工作区',
      'confirm.created': '创建时间',
      'confirm.size': '占用空间',
      'confirm.archived': '已归档',
      'confirm.active': '正在运行',
      'confirm.trash': '移入回收站（可恢复）',
      'confirm.trashHint': '关闭时直接永久删除，不可恢复。',
      'confirm.untitled': '未命名会话',
      'confirm.note': '删除后侧栏立即移除；回收站里的会话可在「设置 → 会话删除」恢复。',
      'confirm.busy': '该会话仍有进行中的工作，请先停止后再删除。',
      'confirm.cancel': '取消',
      'confirm.action': '删除',
      'confirm.working': '正在删除…',
      'toast.deleted': '会话已删除',
      'toast.trashed': '会话已移入回收站',
      'toast.failed': '删除失败：{message}',
      'page.title': '会话删除',
      'page.intro': '管理删除行为与回收站。删除单个会话请用侧栏会话行的 ⋯ 菜单；删除会同时清理会话日志、投影缓存、分组登记与工作区会话快照。',
      'page.refresh': '刷新',
      'page.loading': '加载中…',
      'page.failed': '请求失败：{message}',
      'tabs.trash': '回收站',
      'tabs.settings': '设置',
      'trash.empty': '回收站是空的。',
      'trash.count': '回收站 {n} 项，共 {size}',
      'trash.restore': '恢复',
      'trash.purge': '彻底删除',
      'trash.emptyAction': '清空回收站',
      'trash.emptyConfirm': '清空回收站？其中的会话将无法恢复。',
      'trash.deletedAt': '删除时间',
      'trash.restored': '已恢复会话',
      'trash.purged': '已彻底删除',
      'trash.emptied': '回收站已清空',
      'settings.group.behavior': '删除行为',
      'settings.group.trash': '回收站',
      'settings.group.advanced': '高级',
      'settings.trashEnabledDesc': '删除时先把会话移入本机回收站，可随时恢复。',
      'settings.snapshotCleanupDesc': '同时删除工作区里的会话快照，避免 dsh-workspace-session 把它重新导入。',
      'settings.projCacheCleanupDesc': '同时删除投影缓存，防止写回型缓存重新生成数据。',
      'settings.keepDaysDesc': '回收站里的会话保留多少天；0 表示永久保留，手动清空。',
      'settings.sessionsRootDesc': '留空自动探测（通常是 ~/.dsh/sessions）；自定义部署时填写 JSONL 后端使用的目录。',
      'settings.days': '天',
      'settings.trashEnabled': '默认移入回收站',
      'settings.snapshotCleanup': '同时清理工作区会话快照（防止重新导入）',
      'settings.projCacheCleanup': '同时清理投影缓存',
      'settings.keepDays': '回收站保留天数（0 = 永久）',
      'settings.sessionsRoot': '会话根目录覆盖（留空自动探测）',
      'settings.save': '保存设置',
      'settings.saved': '设置已保存',
      'common.cancel': '取消',
      'common.confirm': '确认',
      'common.close': '关闭',
    }

    const en = {
      nav: 'Session Delete',
      'menu.delete': 'Delete session…',
      'menu.busy': 'Session is busy and cannot be deleted',
      'confirm.title': 'Delete this session?',
      'confirm.desc': 'This permanently deletes the conversation and local data of "{title}".',
      'confirm.workspace': 'Workspace',
      'confirm.created': 'Created',
      'confirm.size': 'Size',
      'confirm.archived': 'Archived',
      'confirm.active': 'Resident',
      'confirm.trash': 'Move to recycle bin (restorable)',
      'confirm.trashHint': 'When off, the session is erased immediately and cannot be restored.',
      'confirm.untitled': 'Untitled session',
      'confirm.note': 'The sidebar row disappears immediately; recycle-bin items can be restored from Settings → Session Delete.',
      'confirm.busy': 'This session still owns running work. Stop it first, then delete.',
      'confirm.cancel': 'Cancel',
      'confirm.action': 'Delete',
      'confirm.working': 'Deleting…',
      'toast.deleted': 'Session deleted',
      'toast.trashed': 'Session moved to the recycle bin',
      'toast.failed': 'Delete failed: {message}',
      'page.title': 'Session Delete',
      'page.intro': 'Manage deletion behaviour and the recycle bin. Delete individual sessions from the sidebar row menu; deleting also removes the log, projection cache, workspace accounting and the workspace session snapshot.',
      'page.refresh': 'Refresh',
      'page.loading': 'Loading…',
      'page.failed': 'Request failed: {message}',
      'tabs.trash': 'Recycle bin',
      'tabs.settings': 'Settings',
      'trash.empty': 'The recycle bin is empty.',
      'trash.count': '{n} item(s), {size} total',
      'trash.restore': 'Restore',
      'trash.purge': 'Purge',
      'trash.emptyAction': 'Empty recycle bin',
      'trash.emptyConfirm': 'Empty the recycle bin? Those sessions cannot be restored.',
      'trash.deletedAt': 'Deleted',
      'trash.restored': 'Session restored',
      'trash.purged': 'Purged',
      'trash.emptied': 'Recycle bin emptied',
      'settings.group.behavior': 'Deletion',
      'settings.group.trash': 'Recycle bin',
      'settings.group.advanced': 'Advanced',
      'settings.trashEnabledDesc': 'Move deleted sessions into the local recycle bin first, so they can be restored.',
      'settings.snapshotCleanupDesc': 'Also remove workspace snapshots so dsh-workspace-session cannot re-import the session.',
      'settings.projCacheCleanupDesc': 'Also remove the projection cache so a write-behind cache cannot recreate the data.',
      'settings.keepDaysDesc': 'Days to keep recycle-bin items; 0 keeps them until you empty the bin.',
      'settings.sessionsRootDesc': 'Empty auto-detects (usually ~/.dsh/sessions); set it for custom JSONL deployments.',
      'settings.days': 'days',
      'settings.trashEnabled': 'Move to recycle bin by default',
      'settings.snapshotCleanup': 'Also remove workspace session snapshots (prevents re-import)',
      'settings.projCacheCleanup': 'Also remove the projection cache',
      'settings.keepDays': 'Recycle-bin retention in days (0 = forever)',
      'settings.sessionsRoot': 'Session root override (empty = auto-detect)',
      'settings.save': 'Save settings',
      'settings.saved': 'Settings saved',
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'common.close': 'Close',
    }

    // ---------------------------------------------------------------------
    // Runtime state and tiny helpers.
    // ---------------------------------------------------------------------
    const runtime = { t: null }
    const requestListeners = new Set()
    let pendingRequest = null

    /** @returns {any} current pending delete request. */
    function getPending() {
      return pendingRequest
    }

    /** @param {(() => void) => (() => void)} listener - subscribe callback. */
    function subscribePending(listener) {
      requestListeners.add(listener)
      return () => { requestListeners.delete(listener) }
    }

    /** @param {any} request - pending delete request or null. */
    function setPending(request) {
      pendingRequest = request
      for (const listener of [...requestListeners]) {
        try {
          listener()
        } catch {
          // A listener failure must not break the store.
        }
      }
    }

    /** @param {string} key - dictionary key. @param {any} [vars] - interpolation values. */
    function t(key, vars) {
      const dict = runtime.t
      let text = typeof dict === 'function' ? dict(key, vars) : undefined
      // A locale miss comes back as the key itself; fall back to the embedded
      // dictionary so a partially-registered namespace never shows raw keys.
      if (typeof text !== 'string' || text === '' || text === key) text = (zh[key] ?? en[key] ?? key)
      if (typeof vars === 'object' && vars !== null) {
        text = text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
      }
      return text
    }

    /** @param {any} ctx - client root context. */
    function bindLocale(ctx) {
      try {
        if (ctx?.locale && typeof ctx.locale.bind === 'function') return ctx.locale.bind(NS)
        if (ctx?.locale && typeof ctx.locale.translate === 'function') return (key, vars) => ctx.locale.translate(NS, key, vars)
      } catch {
        // Fall back to the embedded dictionary.
      }
      return null
    }

    /** @param {string} path - API path below the plugin prefix. @param {any} [options] - fetch options. */
    async function api(path, options) {
      const response = await fetch(API + path, {
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        ...options,
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (payload?.ok === true) return payload.value
      const message = payload?.error?.message ?? `HTTP ${response.status}`
      const error = new Error(message)
      error.code = payload?.error?.code
      error.details = payload?.error?.details
      throw error
    }

    /** @param {number} value - milliseconds. */
    function formatTime(value) {
      const date = new Date(Number(value))
      if (!Number.isFinite(date.getTime())) return '—'
      try {
        return date.toLocaleString()
      } catch {
        return date.toISOString()
      }
    }

    /** @param {number} bytes - byte count. */
    function formatBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value < 0) return '—'
      if (value < 1024) return `${value} B`
      const units = ['KB', 'MB', 'GB', 'TB']
      let size = value / 1024
      let index = 0
      while (size >= 1024 && index < units.length - 1) {
        size /= 1024
        index += 1
      }
      return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[index]}`
    }

    /** Refresh the client session list, best effort. */
    function refreshSessions(ctx) {
      try {
        const sessions = ctx?.get?.('sessions') ?? ctx?.sessions
        if (sessions && typeof sessions.refresh === 'function') void sessions.refresh()
      } catch {
        // The next full list read converges.
      }
    }

    /** Leave the main view when it showed the session that just vanished. */
    function clearMainIfOpen(ctx, sessionId) {
      try {
        const sessions = ctx?.get?.('sessions') ?? ctx?.sessions
        const info = sessions?.retainInfo?.(sessionId)?.getSnapshot?.()
        const retained = (info?.retainedBy?.mainView ?? 0) > 0
        if (!retained) return
        const uiWorkspace = ctx?.get?.('uiWorkspace') ?? ctx?.uiWorkspace
        if (uiWorkspace && typeof uiWorkspace.clearMain === 'function') uiWorkspace.clearMain()
      } catch {
        // Nothing else to do: the deleted session's view simply goes empty.
      }
    }

    // ---------------------------------------------------------------------
    // Stylesheet (injected once, removed with the plugin fiber).
    // ---------------------------------------------------------------------
    const CSS = `
.dsh-sd-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:${DANGER};font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer}
.dsh-sd-menu-item:hover:not(:disabled){background:color-mix(in srgb,${DANGER} 12%,transparent)}
.dsh-sd-menu-item:disabled{color:inherit;opacity:.45;cursor:not-allowed}
.dsh-sd-menu-icon{display:inline-flex;width:14px;height:14px;flex:0 0 auto}
.dsh-sd-backdrop{position:fixed;inset:0;z-index:10040;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.38);color-scheme:light dark;pointer-events:auto}
.dsh-sd-dialog{width:min(470px,calc(100vw - 32px));max-height:calc(100vh - 64px);overflow:auto;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:12px;padding:20px;background:Canvas;color:CanvasText;box-shadow:0 18px 48px rgba(0,0,0,.35)}
.dsh-sd-dialog h3{margin:0 0 8px;font-size:16px;font-weight:600}
.dsh-sd-dialog p{margin:0 0 12px;font-size:13px;line-height:20px}
.dsh-sd-rows{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0 0 14px;font-size:12.5px}
.dsh-sd-rows dt{opacity:.65}
.dsh-sd-rows dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-sd-badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;font-size:11px;line-height:16px;background:color-mix(in srgb,CanvasText 10%,transparent)}
.dsh-sd-note{font-size:12px;line-height:18px;opacity:.7}
.dsh-sd-error{margin:10px 0 0;padding:8px 10px;border-radius:8px;font-size:12.5px;background:color-mix(in srgb,${DANGER} 14%,transparent);color:${DANGER}}
.dsh-sd-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.dsh-sd-btn{appearance:none;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;background:transparent;color:inherit;cursor:pointer}
.dsh-sd-btn:hover:not(:disabled){background:color-mix(in srgb,CanvasText 7%,transparent)}
.dsh-sd-btn:disabled{opacity:.5;cursor:not-allowed}
.dsh-sd-btn.danger{border-color:color-mix(in srgb,${DANGER} 60%,transparent);background:${DANGER};color:#fff}
.dsh-sd-btn.danger:hover:not(:disabled){background:color-mix(in srgb,${DANGER} 86%,#000)}
.dsh-sd-label{display:flex;align-items:center;gap:8px;font-size:12.5px;line-height:18px}
.dsh-sd-page{display:flex;flex-direction:column;gap:14px}
.dsh-sd-page h2{margin:0;font-size:18px}
.dsh-sd-tabs{display:flex;gap:6px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent);padding-bottom:8px}
.dsh-sd-tab{border:0;border-radius:8px;padding:5px 12px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}
.dsh-sd-tab[data-active="true"]{background:color-mix(in srgb,CanvasText 10%,transparent);font-weight:600}
.dsh-sd-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsh-sd-input{border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:8px;padding:6px 10px;background:transparent;color:inherit;font:inherit;font-size:13px;outline:none;box-sizing:border-box;transition:border-color .15s ease}
.dsh-sd-input:focus{border-color:color-mix(in srgb,CanvasText 45%,transparent)}
.dsh-sd-input.num{width:96px;text-align:center}
.dsh-sd-input.path{width:320px;max-width:100%}
.dsh-sd-table{width:100%;border-collapse:collapse;font-size:12.5px}
.dsh-sd-table th,.dsh-sd-table td{text-align:left;padding:6px 8px;border-bottom:1px solid color-mix(in srgb,CanvasText 9%,transparent);vertical-align:top}
.dsh-sd-table th{font-weight:600;opacity:.65;white-space:nowrap}
.dsh-sd-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;opacity:.8}
.dsh-sd-muted{opacity:.6}
.dsh-sd-row-actions{display:flex;gap:6px;justify-content:flex-end}
.dsh-sd-link{border:0;background:transparent;color:${DANGER};font:inherit;font-size:12.5px;cursor:pointer;padding:2px 4px;border-radius:6px}
.dsh-sd-link:hover{background:color-mix(in srgb,${DANGER} 12%,transparent)}
.dsh-sd-link.neutral{color:inherit;opacity:.75}
.dsh-sd-notice{padding:8px 10px;border-radius:8px;font-size:12.5px;background:color-mix(in srgb,CanvasText 8%,transparent)}
.dsh-sd-trash-total{font-size:12.5px;opacity:.7}
.dsh-sd-section{display:flex;flex-direction:column;gap:10px}
.dsh-sd-settings{display:flex;flex-direction:column;gap:14px;max-width:700px}
.dsh-sd-group{border:1px solid color-mix(in srgb,CanvasText 12%,transparent);border-radius:12px;padding:2px 16px 4px;background:color-mix(in srgb,CanvasText 3%,transparent)}
.dsh-sd-group-title{margin:9px 0 2px;font-size:12px;font-weight:600;letter-spacing:.02em;opacity:.55}
.dsh-sd-setting{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:11px 0;border-bottom:1px solid color-mix(in srgb,CanvasText 8%,transparent)}
.dsh-sd-setting:last-child{border-bottom:0}
.dsh-sd-setting-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-sd-setting-title{font-size:13px;line-height:19px}
.dsh-sd-setting-desc{font-size:12px;line-height:17px;opacity:.58;max-width:430px}
.dsh-sd-setting-control{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.dsh-sd-switch{position:relative;display:inline-flex;width:36px;height:20px;flex:0 0 auto;cursor:pointer}
.dsh-sd-switch input{position:absolute;inset:0;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
.dsh-sd-switch span{position:absolute;inset:0;border-radius:999px;background:color-mix(in srgb,CanvasText 18%,transparent);transition:background .15s ease}
.dsh-sd-switch span::before{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:Canvas;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease}
.dsh-sd-switch input:checked + span{background:#3b82f6}
.dsh-sd-switch input:checked + span::before{transform:translateX(16px)}
.dsh-sd-switch input:focus-visible + span{outline:2px solid color-mix(in srgb,#3b82f6 45%,transparent);outline-offset:2px}
.dsh-sd-inline{display:flex;align-items:center;gap:8px}
.dsh-sd-unit{font-size:12.5px;opacity:.6}
.dsh-sd-path{font-size:11.5px;opacity:.55;word-break:break-all}
.dsh-sd-settings-footer{display:flex;justify-content:flex-end;padding-top:2px}
`

    /** Install the stylesheet once. */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /** One small trash glyph for the menu row. */
    function TrashIcon() {
      return h('svg', {
        className: 'dsh-sd-menu-icon', viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('path', { d: 'M4 7h16' }),
      h('path', { d: 'M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7' }),
      h('path', { d: 'M6.5 7l0.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7' }),
      h('path', { d: 'M10 11v5' }),
      h('path', { d: 'M14 11v5' }))
    }

    // ---------------------------------------------------------------------
    // Surface 1: the row-menu entry.
    // ---------------------------------------------------------------------
    /**
     * "Delete session" menu row. It only files a request; the dialog lives in
     * the shell overlay so closing the menu cannot dismiss it.
     * @param {any} props - owner share + standard hooks + the runtime seat.
     */
    function DeleteSessionMenuItem(props) {
      const { sessionId, displayTitle, useMenuOpenState, useSessionStatus } = props
      // Both hooks are unconditional: a missing one degrades to a plain
      // function so the hook order stays stable across renders.
      const menuHook = typeof useMenuOpenState === 'function' ? useMenuOpenState : () => [false, () => {}]
      const pair = menuHook()
      const setMenuOpen = Array.isArray(pair) && typeof pair[1] === 'function' ? pair[1] : () => {}
      const statusHook = typeof useSessionStatus === 'function' ? useSessionStatus : () => undefined
      const status = statusHook(snapshot =>
        snapshot instanceof Map ? snapshot.get(sessionId) : snapshot?.[sessionId])
      const busy = status?.running === true
        || (status?.pendingInteraction !== undefined && status?.pendingInteraction !== null)
      const label = busy ? t('menu.busy') : t('menu.delete')
      return h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dsh-sd-menu-item',
        disabled: busy,
        title: label,
        onClick: () => {
          if (busy) return
          setMenuOpen(false)
          setPending({
            sessionId,
            displayTitle: displayTitle || t('confirm.untitled'),
          })
        },
      }, TrashIcon(), h('span', null, label))
    }

    // ---------------------------------------------------------------------
    // Surface 2: the confirmation dialog (frame-wide overlay).
    // ---------------------------------------------------------------------
    /**
     * One dialog per pending request; the dialog owns its in-flight state.
     * @param {any} props - standard props + runtime seat.
     */
    function DeleteSessionOverlay(props) {
      const request = useSyncExternalStore(subscribePending, getPending, getPending)
      if (request === null) return null
      return h(DeleteConfirmForm, { key: request.sessionId, request, ctx: props.ctx })
    }

    /**
     * The confirmation body: probes the session, refuses while it is busy, and
     * deletes on confirm.
     * @param {any} props - the request and the client root context.
     */
    function DeleteConfirmForm({ request, ctx }) {
      const [phase, setPhase] = useState('loading')
      const [detail, setDetail] = useState(null)
      const [trash, setTrash] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const live = useRef(true)
      useEffect(() => () => { live.current = false }, [])
      useEffect(() => {
        let cancelled = false
        setPhase('loading')
        api(`/status?sessionId=${encodeURIComponent(request.sessionId)}`).then(value => {
          if (cancelled || !live.current) return
          setDetail(value)
          setTrash(value.trashEnabled !== false)
          setPhase('ready')
        }).catch(reason => {
          if (cancelled || !live.current) return
          setError(reason instanceof Error ? reason.message : String(reason))
          setPhase('failed')
        })
        return () => { cancelled = true }
      }, [request.sessionId])
      const close = () => { if (!busy) setPending(null) }
      const confirm = async () => {
        setBusy(true)
        setError(null)
        try {
          const result = await api('/delete', {
            method: 'POST',
            body: JSON.stringify({ sessionId: request.sessionId, trash }),
          })
          clearMainIfOpen(ctx, request.sessionId)
          refreshSessions(ctx)
          setPending(null)
          toast(result?.trashed === true ? t('toast.trashed') : t('toast.deleted'))
        } catch (reason) {
          setBusy(false)
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }
      const busyNow = detail?.busy === true
      return h('div', { className: 'dsh-sd-backdrop', role: 'presentation', onMouseDown: event => {
        if (event.target === event.currentTarget) close()
      } },
      h('div', { className: 'dsh-sd-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-sd-dialog-title' },
        h('h3', { id: 'dsh-sd-dialog-title' }, t('confirm.title')),
        h('p', null, t('confirm.desc', { title: request.displayTitle })),
        phase === 'loading' ? h('p', { className: 'dsh-sd-note' }, t('page.loading')) : null,
        phase === 'failed' ? h('div', { className: 'dsh-sd-error', role: 'alert' }, error ?? '') : null,
        detail !== null
          ? h('dl', { className: 'dsh-sd-rows' },
            detail.workspaceTitle || detail.cwd
              ? [h('dt', { key: 'ws-k' }, t('confirm.workspace')),
                h('dd', { key: 'ws-v', title: detail.cwd ?? '' }, detail.workspaceTitle || detail.cwd)]
              : null,
            h('dt', { key: 'ct-k' }, t('confirm.created')),
            h('dd', { key: 'ct-v' }, formatTime(detail.createdAt ?? detail.createdAtMs)),
            h('dt', { key: 'sz-k' }, t('confirm.size')),
            h('dd', { key: 'sz-v' }, formatBytes(detail.sizeBytes)),
            detail.archived === true
              ? [h('dt', { key: 'ar-k' }, t('confirm.archived')), h('dd', { key: 'ar-v' }, '✓')]
              : null)
          : null,
        detail?.busy === true
          ? h('div', { className: 'dsh-sd-error', role: 'alert' }, t('confirm.busy'))
          : null,
        h('label', { className: 'dsh-sd-label' },
          h('input', {
            type: 'checkbox',
            checked: trash,
            disabled: busy,
            onChange: event => setTrash(event.target.checked),
          }),
          h('span', null, t('confirm.trash'))),
        h('p', { className: 'dsh-sd-note' }, trash ? t('confirm.note') : t('confirm.trashHint')),
        error !== null && phase !== 'failed'
          ? h('div', { className: 'dsh-sd-error', role: 'alert' }, t('toast.failed', { message: error }))
          : null,
        h('div', { className: 'dsh-sd-footer' },
          h('button', { type: 'button', className: 'dsh-sd-btn', disabled: busy, onClick: close }, t('confirm.cancel')),
          h('button', {
            type: 'button',
            className: 'dsh-sd-btn danger',
            disabled: busy || busyNow || phase === 'loading',
            onClick: confirm,
          }, busy ? t('confirm.working') : t('confirm.action')))))
    }

    // ---------------------------------------------------------------------
    // Toast (frame-wide, self-dismissing).
    // ---------------------------------------------------------------------
    let toastTimer = null
    let toastText = null
    const toastListeners = new Set()

    /** Show a short transient notice. @param {string} text - message. */
    function toast(text) {
      toastText = text
      for (const listener of [...toastListeners]) listener()
      if (toastTimer !== null) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        toastTimer = null
        toastText = null
        for (const listener of [...toastListeners]) listener()
      }, 3600)
    }

    function ToastHost() {
      const text = useSyncExternalStore(
        listener => { toastListeners.add(listener); return () => { toastListeners.delete(listener) } },
        () => toastText,
        () => toastText,
      )
      if (text === null) return null
      return h('div', {
        style: {
          position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
          zIndex: 10050, padding: '8px 16px', borderRadius: '10px', fontSize: '13px',
          background: 'Canvas', color: 'CanvasText', border: '1px solid color-mix(in srgb, CanvasText 18%, transparent)',
          boxShadow: '0 10px 28px rgba(0,0,0,.28)', colorScheme: 'light dark',
          pointerEvents: 'none',
        },
        role: 'status',
      }, text)
    }

    // ---------------------------------------------------------------------
    // Surface 3: the management page (settings section).
    // ---------------------------------------------------------------------
    /**
     * The management page: sessions, recycle bin and settings.
     * @param {any} props - settings-section props + runtime seat.
     */
    function SessionDeleteSettings({ ctx }) {
      const [tab, setTab] = useState('trash')
      const [phase, setPhase] = useState('loading')
      const [trash, setTrash] = useState([])
      const [config, setConfig] = useState(null)
      const [counts, setCounts] = useState(null)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [dragConfig, setDragConfig] = useState(null)
      const [busyItem, setBusyItem] = useState(null)

      const load = useCallback(async (force = false) => {
        setPhase('loading')
        setError(null)
        try {
          // One combined read of the recycle bin and the configuration; the
          // settings page never lists sessions, so this stays cheap.
          const data = await api('/list' + (force === true ? '?refresh=1' : ''))
          setTrash(Array.isArray(data?.trash) ? data.trash : [])
          setConfig(data?.config ?? null)
          setDragConfig(data?.config ?? null)
          setCounts(data?.counts ?? null)
          setPhase('ready')
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setPhase('failed')
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const restoreItem = async item => {
        if (busyItem !== null) return
        setError(null)
        setBusyItem(item.trashId)
        try {
          await api('/restore', { method: 'POST', body: JSON.stringify({ trashId: item.trashId }) })
          setNotice(t('trash.restored'))
          refreshSessions(ctx)
          await load()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setBusyItem(null)
        }
      }

      const purgeItem = async item => {
        if (busyItem !== null) return
        setError(null)
        setBusyItem(item.trashId)
        try {
          await api('/purge', { method: 'POST', body: JSON.stringify({ trashId: item.trashId }) })
          setNotice(t('trash.purged'))
          await load()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setBusyItem(null)
        }
      }

      const emptyTrash = async () => {
        if (busyItem !== null) return
        if (typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm(t('trash.emptyConfirm'))) return
        setError(null)
        setBusyItem('*')
        try {
          await api('/empty-trash', { method: 'POST', body: JSON.stringify({}) })
          setNotice(t('trash.emptied'))
          await load()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setBusyItem(null)
        }
      }

      const saveConfig = async () => {
        setError(null)
        try {
          const patch = {
            trashEnabled: dragConfig?.trashEnabled === true,
            snapshotCleanup: dragConfig?.snapshotCleanup === true,
            projCacheCleanup: dragConfig?.projCacheCleanup === true,
            keepDays: Number(dragConfig?.keepDays ?? 0),
            sessionsRoot: String(dragConfig?.sessionsRoot ?? ''),
          }
          const value = await api('/config', { method: 'POST', body: JSON.stringify({ patch }) })
          setConfig(value?.config ?? patch)
          setDragConfig(value?.config ?? patch)
          setNotice(t('settings.saved'))
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }

      const trashTotal = useMemo(
        () => trash.reduce((sum, row) => sum + (Number(row.sizeBytes) || 0), 0),
        [trash],
      )

      const tabs = h('div', { className: 'dsh-sd-tabs', role: 'tablist' },
        ['trash', 'settings'].map(name => h('button', {
          key: name,
          type: 'button',
          role: 'tab',
          className: 'dsh-sd-tab',
          'data-active': tab === name ? 'true' : 'false',
          'aria-selected': tab === name,
          onClick: () => setTab(name),
        }, t(`tabs.${name}`))))

      return h('div', { className: 'dsh-sd-page' },
        h('div', { className: 'dsh-sd-toolbar' },
          h('h2', null, t('page.title')),
          h('span', { style: { flex: '1 1 auto' } }),
          h('button', { type: 'button', className: 'dsh-sd-btn', onClick: () => { void load(true) } }, t('page.refresh'))),
        h('p', { className: 'dsh-sd-note', style: { margin: 0 } }, t('page.intro')),
        phase === 'loading' ? h('p', { className: 'dsh-sd-muted' }, t('page.loading')) : null,
        phase === 'failed' ? h('div', { className: 'dsh-sd-error', role: 'alert' }, t('page.failed', { message: error ?? '' })) : null,
        error !== null && phase !== 'failed' ? h('div', { className: 'dsh-sd-error', role: 'alert' }, error) : null,
        notice !== null ? h('div', { className: 'dsh-sd-notice', role: 'status' }, notice) : null,
        tabs,
        tab === 'trash'
          ? renderTrash({ trash, trashTotal, restoreItem, purgeItem, emptyTrash, busyItem })
          : renderSettings({ dragConfig, setDragConfig, saveConfig }))
    }

    /**
     * Recycle-bin tab: the parked sessions with restore/purge per row and one
     * empty action.
     */
    function renderTrash({ trash, trashTotal, restoreItem, purgeItem, emptyTrash, busyItem }) {
      const busy = busyItem !== null
      return h('div', { className: 'dsh-sd-section' },
        h('div', { className: 'dsh-sd-toolbar' },
          h('span', { className: 'dsh-sd-trash-total' }, t('trash.count', { n: trash.length, size: formatBytes(trashTotal) })),
          h('span', { style: { flex: '1 1 auto' } }),
          h('button', {
            type: 'button',
            className: 'dsh-sd-btn',
            disabled: trash.length === 0 || busy,
            onClick: () => { void emptyTrash() },
          }, t('trash.emptyAction'))),
        trash.length === 0
          ? h('p', { className: 'dsh-sd-muted' }, t('trash.empty'))
          : h('table', { className: 'dsh-sd-table' },
            h('thead', null, h('tr', null,
              h('th', null, 'Session'),
              h('th', null, t('trash.deletedAt')),
              h('th', null, t('confirm.size')),
              h('th', { style: { textAlign: 'right' } }, ''))),
            h('tbody', null, trash.map(item => h('tr', { key: item.trashId },
              h('td', null,
                h('div', { className: 'dsh-sd-mono' }, item.sessionId ?? item.trashId),
                item.cwd ? h('div', { className: 'dsh-sd-path' }, item.cwd) : null),
              h('td', { style: { whiteSpace: 'nowrap' } }, item.deletedAt ? formatTime(item.deletedAt) : '—'),
              h('td', { style: { whiteSpace: 'nowrap' } }, formatBytes(item.sizeBytes)),
              h('td', null, h('div', { className: 'dsh-sd-row-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-sd-link neutral',
                  disabled: busy,
                  onClick: () => { void restoreItem(item) },
                }, t('trash.restore')),
                h('button', {
                  type: 'button',
                  className: 'dsh-sd-link',
                  disabled: busy,
                  onClick: () => { void purgeItem(item) },
                }, t('trash.purge')))))))))
    }

    /**
     * Settings tab: grouped cards, iOS-style switches and compact inputs.
     * @param {any} props - the draft configuration, its setter and the save callback.
     */
    function renderSettings({ dragConfig, setDragConfig, saveConfig }) {
      if (dragConfig === null) return h('p', { className: 'dsh-sd-muted' }, t('page.loading'))
      const set = (field, value) => setDragConfig({ ...dragConfig, [field]: value })
      const row = (key, title, desc, control) => h('div', { key, className: 'dsh-sd-setting' },
        h('div', { className: 'dsh-sd-setting-text' },
          h('div', { className: 'dsh-sd-setting-title' }, title),
          desc ? h('div', { className: 'dsh-sd-setting-desc' }, desc) : null),
        h('div', { className: 'dsh-sd-setting-control' }, control))
      const toggle = field => h('label', { className: 'dsh-sd-switch' },
        h('input', {
          type: 'checkbox',
          checked: dragConfig[field] === true,
          onChange: event => set(field, event.target.checked),
        }),
        h('span', { 'aria-hidden': 'true' }))
      return h('div', { className: 'dsh-sd-settings' },
        h('section', { className: 'dsh-sd-group' },
          h('h3', { className: 'dsh-sd-group-title' }, t('settings.group.behavior')),
          row('trashEnabled', t('settings.trashEnabled'), t('settings.trashEnabledDesc'), toggle('trashEnabled')),
          row('snapshotCleanup', t('settings.snapshotCleanup'), t('settings.snapshotCleanupDesc'), toggle('snapshotCleanup')),
          row('projCacheCleanup', t('settings.projCacheCleanup'), t('settings.projCacheCleanupDesc'), toggle('projCacheCleanup'))),
        h('section', { className: 'dsh-sd-group' },
          h('h3', { className: 'dsh-sd-group-title' }, t('settings.group.trash')),
          row('keepDays', t('settings.keepDays'), t('settings.keepDaysDesc'),
            h('div', { className: 'dsh-sd-inline' },
              h('input', {
                className: 'dsh-sd-input num',
                type: 'number',
                min: 0,
                value: dragConfig.keepDays ?? 0,
                onChange: event => set('keepDays', Number(event.target.value) || 0),
              }),
              h('span', { className: 'dsh-sd-unit' }, t('settings.days'))))),
        h('section', { className: 'dsh-sd-group' },
          h('h3', { className: 'dsh-sd-group-title' }, t('settings.group.advanced')),
          row('sessionsRoot', t('settings.sessionsRoot'), t('settings.sessionsRootDesc'),
            h('input', {
              className: 'dsh-sd-input path',
              type: 'text',
              spellCheck: false,
              value: dragConfig.sessionsRoot ?? '',
              placeholder: '~/.dsh/sessions',
              onChange: event => set('sessionsRoot', event.target.value),
            }))),
        h('div', { className: 'dsh-sd-settings-footer' },
          h('button', {
            type: 'button',
            className: 'dsh-sd-btn danger',
            onClick: () => { void saveConfig() },
          }, t('settings.save'))))
    }

    // ---------------------------------------------------------------------
    // Plugin entry.
    // ---------------------------------------------------------------------
    /**
     * Register the three surfaces once their target slots exist.
     * @param {any} ctx - client root context.
     */
    function apply(ctx) {
      installStyles()
      runtime.t = bindLocale(ctx)
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-delete: dictionaries')
      } catch {
        // The embedded fallback dictionary still works.
      }
      ctx.effect(() => () => {
        if (typeof document !== 'undefined') document.getElementById(STYLE_ID)?.remove()
      }, 'dsh-session-delete: stylesheet')

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'dsh-session-delete', order: 460 },
          props => h(DeleteSessionMenuItem, { ...props, ctx }),
        ))

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-session-delete' },
          props => h(DeleteSessionOverlay, { ...props, ctx }),
        ))

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-session-delete-toast', order: 90 },
          () => h(ToastHost),
        ))

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({
          name: 'settings.section',
          id: 'session-delete',
          order: SETTINGS_ORDER,
          label: () => t('nav'),
          locale: NS,
        }, props => h(SessionDeleteSettings, { ...props, ctx })))
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
