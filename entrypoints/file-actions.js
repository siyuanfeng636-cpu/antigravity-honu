// codex-file-actions-start
/* 为聊天中的本机文件添加右键菜单。重复注入时先清理旧实例。 */
(() => {
  if (window.top !== window || location.protocol !== 'https:' || location.hostname !== '127.0.0.1' ||
      !/Antigravity\//i.test(navigator.userAgent)) return;
  const key = '__AG_FILE_ACTIONS__';
  window[key]?.dispose?.();
  const lifecycle = new AbortController();
  let menu = null, toast = null, toastTimer = null, menuController = null;
  const style = document.createElement('style');
  style.id = 'ag-file-actions-style';
  style.textContent = `
    #ag-file-actions-menu{position:fixed;z-index:2147483647;width:292px;max-width:calc(100vw - 16px);padding:6px;border:1px solid #d9dfe7;border-radius:10px;background:#fff;color:#243247;box-shadow:0 12px 38px #0003;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;user-select:none}
    #ag-file-actions-menu .ag-path{padding:7px 9px 9px;margin-bottom:4px;border-bottom:1px solid #e5e8ee;font-size:11px;color:#6e7888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #ag-file-actions-menu button{display:block;width:100%;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;padding:9px 10px;cursor:pointer}
    #ag-file-actions-menu button:hover,#ag-file-actions-menu button:focus-visible{background:#edf3ff;outline:none}
    #ag-file-actions-menu button:disabled{opacity:.45;cursor:default}
    #ag-file-actions-toast{position:fixed;right:24px;bottom:28px;z-index:2147483647;max-width:420px;padding:11px 16px;background:#27364a;color:#fff;border-radius:8px;box-shadow:0 4px 20px #0003;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
    @media(prefers-color-scheme:dark){#ag-file-actions-menu{background:#27292f;color:#f1f3f7;border-color:#41454f}#ag-file-actions-menu .ag-path{color:#b4bdcb;border-color:#41454f}#ag-file-actions-menu button:hover,#ag-file-actions-menu button:focus-visible{background:#3b414e}}
  `;
  (document.head || document.documentElement).append(style);

  function localFile(raw) {
    try {
      const uri = new URL(raw);
      if (uri.protocol !== 'file:' || (uri.hostname && uri.hostname !== 'localhost')) return null;
      uri.search = ''; uri.hash = '';
      const path = decodeURIComponent(uri.pathname);
      if (!path.startsWith('/') || path.includes('\0')) return null;
      return {uri:uri.href,path};
    } catch { return null; }
  }
  function fileAt(target) {
    if (!(target instanceof Element)) return null;
    const pill = target.closest('[data-uri]');
    if (pill) return localFile(pill.getAttribute('data-uri'));
    const link = target.closest('a[href^="file:"]');
    if (link) return localFile(link.getAttribute('href'));
    const card = target.closest('[data-testid="artifact-card"]');
    return card ? localFile(card.querySelector('[data-uri]')?.getAttribute('data-uri')) : null;
  }
  function dismiss() {
    menuController?.abort(); menuController = null;
    menu?.remove(); menu = null;
  }
  function notify(message) {
    toast?.remove(); clearTimeout(toastTimer);
    toast = document.createElement('div'); toast.id = 'ag-file-actions-toast';
    toast.setAttribute('role','status'); toast.textContent = message;
    document.body.append(toast); toastTimer = setTimeout(() => { toast?.remove(); toast = null; },3500);
  }
  async function copyPath(path) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(path);
    const input = document.createElement('textarea'); input.value = path;
    input.style.cssText = 'position:fixed;left:-10000px;top:0';
    document.body.append(input); input.select();
    const copied = document.execCommand('copy'); input.remove();
    if (!copied) throw new Error('复制失败，请重试');
  }
  function show(event, file) {
    dismiss();
    menuController = new AbortController();
    const signal = menuController.signal;
    const source = event.target.closest('[data-uri],a,[data-testid="artifact-card"]');
    menu = document.createElement('div'); menu.id = 'ag-file-actions-menu';
    menu.setAttribute('role','menu'); menu.setAttribute('aria-label','文件位置');
    const path = document.createElement('div'); path.className = 'ag-path';
    path.textContent = file.path; path.title = file.path; menu.append(path);
    const actions = [
      ['在访达中显示', async () => {
        const native = window.electronNative || window.electronAPI;
        if (typeof native?.revealInFilePicker !== 'function') throw new Error('当前窗口没有访达接口');
        await native.revealInFilePicker(file.uri);
      }],
      ['复制文件路径', async () => { await copyPath(file.path); if (!lifecycle.signal.aborted) notify('已复制文件路径'); }],
    ];
    for (const [label, action] of actions) {
      const button = document.createElement('button'); button.type = 'button';
      button.setAttribute('role','menuitem'); button.textContent = label;
      button.addEventListener('click', async e => {
        e.preventDefault(); e.stopPropagation(); dismiss();
        try { await action(); } catch (error) { if (!lifecycle.signal.aborted) notify(error.message || '操作失败，请重试'); }
      },{signal});
      menu.append(button);
    }
    document.body.append(menu);
    const rect = source?.getBoundingClientRect();
    const x = event.clientX || rect?.left || 8, y = event.clientY || rect?.bottom || 8;
    menu.style.left = Math.max(8,Math.min(x,window.innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top = Math.max(8,Math.min(y,window.innerHeight-menu.offsetHeight-8))+'px';
    const buttons = [...menu.querySelectorAll('button')]; buttons[0].focus();
    document.addEventListener('pointerdown', e => { if (!menu?.contains(e.target)) dismiss(); },{capture:true,signal});
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); source?.focus(); }
      if (e.key === 'Tab') dismiss();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const current = buttons.indexOf(document.activeElement);
        buttons[(current+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();
      }
    },{capture:true,signal});
    window.addEventListener('blur',dismiss,{signal});
    window.addEventListener('resize',dismiss,{signal});
    document.addEventListener('scroll',dismiss,{capture:true,signal});
  }
  window.addEventListener('contextmenu', event => {
    const file = fileAt(event.target);
    if (!file) return;
    event.preventDefault(); event.stopImmediatePropagation(); show(event,file);
  },{capture:true,signal:lifecycle.signal});
  window[key] = {version:'0.1.0',dispose() {
    lifecycle.abort(); dismiss(); clearTimeout(toastTimer); toast?.remove(); style.remove(); delete window[key];
  }};
  ctx.onCleanup(window[key].dispose);
})();

// codex-file-actions-end
