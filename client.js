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
      'page.intro': '管理本机所有会话：删除、批量清理，以及从回收站恢复。删除会同时清理会话日志、投影缓存、分组登记与工作区会话快照。',
      'page.refresh': '刷新',
      'page.loading': '加载中…',
      'page.failed': '请求失败：{message}',
      'tabs.sessions': '会话',
      'tabs.trash': '回收站',
      'tabs.settings': '设置',
      'sessions.search': '搜索标题或会话 ID',
      'sessions.empty': '没有匹配的会话。',
      'sessions.count': '共 {n} 个会话',
      'sessions.selected': '已选 {n} 个',
      'sessions.deleteSelected': '删除选中',
      'sessions.deleteOne': '删除',
      'sessions.restoreOne': '恢复',
      'sessions.purgeOne': '彻底删除',
      'sessions.archived': '已归档',
      'sessions.active': '运行中',
      'sessions.ungrouped': '未分组',
      'sessions.noWorkspace': '未分组',
      'sessions.batchConfirm': '删除选中的 {n} 个会话？',
      'sessions.batchWorking': '正在删除 {done}/{total}…',
      'sessions.batchDone': '已删除 {n} 个会话',
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
      'page.intro': 'Manage every session on this machine: delete, clean up in bulk, and restore from the recycle bin. Deleting also removes the log, projection cache, workspace accounting and the workspace session snapshot.',
      'page.refresh': 'Refresh',
      'page.loading': 'Loading…',
      'page.failed': 'Request failed: {message}',
      'tabs.sessions': 'Sessions',
      'tabs.trash': 'Recycle bin',
      'tabs.settings': 'Settings',
      'sessions.search': 'Search title or session id',
      'sessions.empty': 'No matching sessions.',
      'sessions.count': '{n} session(s)',
      'sessions.selected': '{n} selected',
      'sessions.deleteSelected': 'Delete selected',
      'sessions.deleteOne': 'Delete',
      'sessions.restoreOne': 'Restore',
      'sessions.purgeOne': 'Purge',
      'sessions.archived': 'archived',
      'sessions.active': 'resident',
      'sessions.ungrouped': 'Ungrouped',
      'sessions.noWorkspace': 'Ungrouped',
      'sessions.batchConfirm': 'Delete {n} selected session(s)?',
      'sessions.batchWorking': 'Deleting {done}/{total}…',
      'sessions.batchDone': 'Deleted {n} session(s)',
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
.dsh-sd-input{flex:1 1 220px;min-width:160px;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:8px;padding:6px 10px;background:transparent;color:inherit;font:inherit;font-size:13px}
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
.dsh-sd-settings{display:flex;flex-direction:column;gap:12px;max-width:560px}
.dsh-sd-checkbox{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;line-height:18px}
.dsh-sd-progress{font-size:12.5px;opacity:.75}
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
      const [tab, setTab] = useState('sessions')
      const [phase, setPhase] = useState('loading')
      const [sessions, setSessions] = useState([])
      const [trash, setTrash] = useState([])
      const [config, setConfig] = useState(null)
      const [counts, setCounts] = useState(null)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [search, setSearch] = useState('')
      const [selected, setSelected] = useState(() => new Set())
      const [working, setWorking] = useState(null)
      const [dragConfig, setDragConfig] = useState(null)

      const load = useCallback(async () => {
        setPhase('loading')
        setError(null)
        try {
          const list = await api('/list')
          const state = await api('/state')
          setSessions(Array.isArray(list?.sessions) ? list.sessions : [])
          setTrash(Array.isArray(list?.trash) ? list.trash : [])
          setConfig(state?.config ?? null)
          setDragConfig(state?.config ?? null)
          setCounts(state?.counts ?? null)
          setSelected(new Set())
          setPhase('ready')
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setPhase('failed')
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase()
        if (needle === '') return sessions
        return sessions.filter(row =>
          String(row.title ?? '').toLowerCase().includes(needle)
          || String(row.sessionId ?? '').toLowerCase().includes(needle)
          || String(row.workspaceTitle ?? '').toLowerCase().includes(needle))
      }, [sessions, search])

      const groups = useMemo(() => {
        const map = new Map()
        for (const row of filtered) {
          const key = row.workspaceTitle || row.workspacePath || t('sessions.ungrouped')
          if (!map.has(key)) map.set(key, [])
          map.get(key).push(row)
        }
        return [...map.entries()]
      }, [filtered])

      const toggle = id => setSelected(previous => {
        const next = new Set(previous)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })

      const deleteOne = async (row, event) => {
        if (event?.stopPropagation) event.stopPropagation()
        if (working !== null) return
        setNotice(null)
        setError(null)
        setWorking({ kind: 'one', sessionId: row.sessionId, label: row.title || row.sessionId })
        try {
          await api('/delete', {
            method: 'POST',
            body: JSON.stringify({ sessionId: row.sessionId, trash: config?.trashEnabled !== false }),
          })
          clearMainIfOpen(ctx, row.sessionId)
          refreshSessions(ctx)
          setNotice(t('toast.deleted'))
          await load()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setWorking(null)
        }
      }

      const deleteSelected = async () => {
        const ids = [...selected]
        if (ids.length === 0 || working !== null) return
        if (typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm(t('sessions.batchConfirm', { n: ids.length }))) return
        setNotice(null)
        setError(null)
        let done = 0
        let failed = 0
        for (const sessionId of ids) {
          setWorking({ kind: 'batch', done, total: ids.length })
          try {
            await api('/delete', {
              method: 'POST',
              body: JSON.stringify({ sessionId, trash: config?.trashEnabled !== false }),
            })
            done += 1
            clearMainIfOpen(ctx, sessionId)
          } catch {
            failed += 1
          }
        }
        setWorking(null)
        refreshSessions(ctx)
        setNotice(failed === 0
          ? t('sessions.batchDone', { n: done })
          : t('page.failed', { message: `${done}/${ids.length}` }))
        await load()
      }

      const restoreItem = async item => {
        setError(null)
        try {
          await api('/restore', { method: 'POST', body: JSON.stringify({ trashId: item.trashId }) })
          setNotice(t('trash.restored'))
          refreshSessions(ctx)
          await load()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }

      const purgeItem = async item => {
        setError(null)
        try {
          await api('/purge', { method: 'POST', body: JSON.stringify({ trashId: item.trashId }) })
          setNotice(t('trash.purged'))
          await load()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }

      const emptyTrash = async () => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm(t('trash.emptyConfirm'))) return
        setError(null)
        try {
          await api('/empty-trash', { method: 'POST', body: JSON.stringify({}) })
          setNotice(t('trash.emptied'))
          await load()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
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
        ['sessions', 'trash', 'settings'].map(name => h('button', {
          key: name,
          type: 'button',
          role: 'tab',
          className: 'dsh-sd-tab',
          'data-active': tab === name ? 'true' : 'false',
          'aria-selected': tab === name,
          onClick: () => setTab(name),
        }, t(`tabs.${name}`))))

      const body = tab === 'sessions'
        ? renderSessions({
          groups, selected, toggle, deleteOne, deleteSelected, working, search, setSearch,
          total: filtered.length, config, load,
        })
        : tab === 'trash'
          ? renderTrash({ trash, trashTotal, restoreItem, purgeItem, emptyTrash })
          : renderSettings({ dragConfig, setDragConfig, saveConfig })

      return h('div', { className: 'dsh-sd-page' },
        h('div', { className: 'dsh-sd-toolbar' },
          h('h2', null, t('page.title')),
          h('span', { style: { flex: '1 1 auto' } }),
          working !== null && working.kind === 'batch'
            ? h('span', { className: 'dsh-sd-progress' }, t('sessions.batchWorking', working))
            : null,
          h('button', { type: 'button', className: 'dsh-sd-btn', onClick: () => { void load() } }, t('page.refresh'))),
        h('p', { className: 'dsh-sd-note', style: { margin: 0 } }, t('page.intro')),
        phase === 'loading' ? h('p', { className: 'dsh-sd-muted' }, t('page.loading')) : null,
        phase === 'failed' ? h('div', { className: 'dsh-sd-error', role: 'alert' }, t('page.failed', { message: error ?? '' })) : null,
        error !== null && phase !== 'failed' ? h('div', { className: 'dsh-sd-error', role: 'alert' }, error) : null,
        notice !== null ? h('div', { className: 'dsh-sd-notice', role: 'status' }, notice) : null,
        tabs,
        body)
    }

    /** Sessions tab. */
    function renderSessions({ groups, selected, toggle, deleteOne, deleteSelected, working, search, setSearch, total, config, load }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { className: 'dsh-sd-toolbar' },
          h('input', {
            className: 'dsh-sd-input',
            type: 'search',
            placeholder: t('sessions.search'),
            value: search,
            onChange: event => setSearch(event.target.value),
          }),
          h('span', { className: 'dsh-sd-muted' }, t('sessions.count', { n: total })),
          h('span', { className: 'dsh-sd-muted' }, t('sessions.selected', { n: selected.size })),
          h('button', {
            type: 'button',
            className: 'dsh-sd-btn danger',
            disabled: selected.size === 0 || working !== null,
            onClick: () => { void deleteSelected() },
          }, t('sessions.deleteSelected'))),
        groups.length === 0
          ? h('p', { className: 'dsh-sd-muted' }, t('sessions.empty'))
          : groups.map(([group, rows]) => h('div', { key: group, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginTop: '6px' } }, `${group} (${rows.length})`),
            h('table', { className: 'dsh-sd-table' },
              h('thead', null,
                h('tr', null,
                  h('th', { style: { width: '28px' } }, ''),
                  h('th', null, 'Session'),
                  h('th', null, t('confirm.size')),
                  h('th', null, ''),
                  h('th', { style: { textAlign: 'right' } }, ''))),
              h('tbody', null, rows.map(row => h('tr', { key: row.sessionId },
                h('td', null, h('input', {
                  type: 'checkbox',
                  checked: selected.has(row.sessionId),
                  onChange: () => toggle(row.sessionId),
                })),
                h('td', null,
                  h('div', { title: row.title || row.sessionId },
                    row.title || h('span', { className: 'dsh-sd-muted' }, row.sessionId)),
                  h('div', { className: 'dsh-sd-mono' }, row.sessionId),
                  row.archived ? h('span', { className: 'dsh-sd-badge' }, t('sessions.archived')) : null,
                  row.active ? h('span', { className: 'dsh-sd-badge' }, t('sessions.active')) : null),
                h('td', { style: { whiteSpace: 'nowrap' } }, formatBytes(row.sizeBytes)),
                h('td', { className: 'dsh-sd-muted', style: { whiteSpace: 'nowrap' } }, formatTime(row.createdAt)),
                h('td', null, h('div', { className: 'dsh-sd-row-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dsh-sd-link',
                    disabled: working !== null,
                    onClick: event => { void deleteOne(row, event) },
                  }, t('sessions.deleteOne')))))))))))
    }

    /** Recycle-bin tab. */
    function renderTrash({ trash, trashTotal, restoreItem, purgeItem, emptyTrash }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { className: 'dsh-sd-toolbar' },
          h('span', { className: 'dsh-sd-trash-total' }, t('trash.count', { n: trash.length, size: formatBytes(trashTotal) })),
          h('span', { style: { flex: '1 1 auto' } }),
          h('button', {
            type: 'button',
            className: 'dsh-sd-btn',
            disabled: trash.length === 0,
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
                item.cwd ? h('div', { className: 'dsh-sd-muted' }, item.cwd) : null),
              h('td', { style: { whiteSpace: 'nowrap' } }, item.deletedAt ? formatTime(item.deletedAt) : '—'),
              h('td', { style: { whiteSpace: 'nowrap' } }, formatBytes(item.sizeBytes)),
              h('td', null, h('div', { className: 'dsh-sd-row-actions' },
                h('button', { type: 'button', className: 'dsh-sd-link neutral', onClick: () => { void restoreItem(item) } }, t('trash.restore')),
                h('button', { type: 'button', className: 'dsh-sd-link', onClick: () => { void purgeItem(item) } }, t('trash.purge')))))))))
    }

    /** Settings tab. */
    function renderSettings({ dragConfig, setDragConfig, saveConfig }) {
      if (dragConfig === null) return h('p', { className: 'dsh-sd-muted' }, t('page.loading'))
      const set = (field, value) => setDragConfig({ ...dragConfig, [field]: value })
      return h('div', { className: 'dsh-sd-settings' },
        h('label', { className: 'dsh-sd-checkbox' },
          h('input', {
            type: 'checkbox',
            checked: dragConfig.trashEnabled === true,
            onChange: event => set('trashEnabled', event.target.checked),
          }),
          h('span', null, t('settings.trashEnabled'))),
        h('label', { className: 'dsh-sd-checkbox' },
          h('input', {
            type: 'checkbox',
            checked: dragConfig.snapshotCleanup === true,
            onChange: event => set('snapshotCleanup', event.target.checked),
          }),
          h('span', null, t('settings.snapshotCleanup'))),
        h('label', { className: 'dsh-sd-checkbox' },
          h('input', {
            type: 'checkbox',
            checked: dragConfig.projCacheCleanup === true,
            onChange: event => set('projCacheCleanup', event.target.checked),
          }),
          h('span', null, t('settings.projCacheCleanup'))),
        h('label', { className: 'dsh-sd-label', style: { flexDirection: 'column', alignItems: 'stretch' } },
          h('span', null, t('settings.keepDays')),
          h('input', {
            className: 'dsh-sd-input',
            type: 'number',
            min: 0,
            value: dragConfig.keepDays ?? 0,
            onChange: event => set('keepDays', Number(event.target.value) || 0),
          })),
        h('label', { className: 'dsh-sd-label', style: { flexDirection: 'column', alignItems: 'stretch' } },
          h('span', null, t('settings.sessionsRoot')),
          h('input', {
            className: 'dsh-sd-input',
            type: 'text',
            value: dragConfig.sessionsRoot ?? '',
            placeholder: '~/.dsh/sessions',
            onChange: event => set('sessionsRoot', event.target.value),
          })),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'dsh-sd-btn danger', onClick: () => { void saveConfig() } }, t('settings.save'))))
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
