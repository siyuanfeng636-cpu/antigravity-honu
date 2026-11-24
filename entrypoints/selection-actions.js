// codex-selection-actions-start
/* 将文件阅读选区接入 Antigravity 原生引用和 /btw 草稿。 */
(() => {
  if (window.top !== window || location.protocol !== 'https:' || location.hostname !== '127.0.0.1' ||
      !/Antigravity\//i.test(navigator.userAgent)) return;
  const key = '__AG_SELECTION_ACTIONS__';
  window[key]?.dispose?.();
  const lifecycle = new AbortController(), signal = lifecycle.signal;
  let toolbar, timer, toast, toastTimer;
  const viewerSelector = [
    'File Viewer', 'Virtual File Viewer', 'Artifact Viewer', '文件查看器',
  ].flatMap(label => [`[aria-label="${label}"]`, `[data-ag-orig-aria-label="${label}"]`]).join(',');
  const style = document.createElement('style');
  style.textContent = `
    #ag-selection-toolbar{position:fixed;z-index:2147483646;display:flex;padding:4px;gap:3px;border:1px solid var(--border,#ccd5e0);border-radius:9px;background:var(--background,#fff);color:var(--foreground,#243247);box-shadow:0 5px 24px #0003;font:13px -apple-system,"PingFang SC",sans-serif;user-select:none}
    #ag-selection-toolbar button{font:inherit;color:inherit;border:0;background:transparent;padding:8px 10px;border-radius:5px;cursor:pointer;white-space:nowrap}
    #ag-selection-toolbar button:hover{background:var(--secondary,#edf3ff)}
    #ag-selection-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#26364b;color:#fff;padding:10px 16px;border-radius:8px;font:13px -apple-system,"PingFang SC",sans-serif}
    body[data-ag-file-selection] :is(${viewerSelector}) .selection-popup{visibility:hidden}
  `;
  (document.head || document.documentElement).append(style);
  function visible(el) { return !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden'; }
  function notify(message) {
    toast?.remove(); clearTimeout(toastTimer); toast = document.createElement('div');
    toast.id = 'ag-selection-toast'; toast.setAttribute('role','status'); toast.textContent = message;
    document.body.append(toast); toastTimer = setTimeout(() => toast?.remove(),4000);
  }
  function fibers(node) {
    const prop = Object.keys(node || {}).find(k => k.startsWith('__reactFiber$'));
    const result = []; let fiber = node?.[prop];
    for (let n=0; fiber && n<60; n++,fiber=fiber.return) result.push(fiber);
    return result;
  }
  function conversation(id) {
    const views = [...document.querySelectorAll('[data-testid="conversation-view"]')].filter(visible);
    if (id) return views.find(el => el.dataset.cascadeId === id);
    if (views.length === 1) return views[0];
    const focused = document.activeElement?.closest('[data-testid="conversation-view"]');
    if (focused) return focused;
    throw new Error('请先点击要引用到的对话，再重新选择文字。');
  }
  function sourceInfo(area) {
    const out = {};
    for (const f of fibers(area)) {
      const p = f.memoizedProps || {};
      const content = p.tab?.content || p.content;
      out.uri ||= p.fileUri || content?.fileView?.fileUri || content?.virtualFileView?.fileUri;
      out.conversationId ||= p.treeId?.kind === 'cascadeId' ? p.treeId.cascadeId : p.cascadeId;
    }
    return out;
  }
  function nativeQuote(view, content, btw=false) {
    const el = [...view.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].find(visible);
    const editor = el?.__lexicalEditor;
    const Mention = editor?._nodes?.get('contextScopeItemMention')?.klass;
    const Paragraph = editor?._nodes?.get('paragraph')?.klass;
    const Text = editor?._nodes?.get('text')?.klass;
    if (!editor || !Mention || !Paragraph || !Text) throw new Error('未找到当前对话输入框，请打开对话后重试。');
    const hasBtw = JSON.stringify(editor.getEditorState().toJSON()).includes('\\"recipeId\\":\\"btw\\"');
    let failure, insertedKey;
    editor.update(() => { try {
      const root = editor.getEditorState()._nodeMap.get('root').getLatest();
      const quote = Mention.importJSON({type:'contextScopeItemMention',version:1,data:{data:JSON.stringify({textBlock:{label:'Quote',content}})}});
      if (!root.getFirstChild()) root.append(new Paragraph());
      const nodes=[];
      if(btw&&!hasBtw)nodes.push(Mention.importJSON({type:'contextScopeItemMention',version:1,data:{data:JSON.stringify({recipe:{recipeId:'btw',title:'btw',description:'Ask a quick question without interrupting the main conversation.'}})}}),new Text(' '));
      nodes.push(quote,new Text(' '));root.selectEnd().insertNodes(nodes);
      insertedKey=quote.getKey();
    } catch(error) { failure=error; }
    },{discrete:true,tag:'history-push'});
    if(failure)throw failure;
    if(!insertedKey || !editor.getEditorState()._nodeMap.has(insertedKey))throw new Error('引用未进入输入框，请重试。');
    const stored=editor.getEditorState().read(()=>JSON.parse(editor.getEditorState()._nodeMap.get(insertedKey).exportJSON().data.data).textBlock?.content);
    if(stored!==content)throw new Error('引用内容核对失败，请重试。');
    editor.focus();
  }
  function nativeBtw(view, content) {
    for (const node of view.querySelectorAll('[data-quotable-root],[data-testid="autoscroll-viewport"] *')) {
      for (const f of fibers(node)) {
        if (typeof f.memoizedProps?.onSideQuestion === 'function') {
          f.memoizedProps.onSideQuestion(content);
          return '已打开顺便问一下，可输入问题';
        }
      }
    }
    nativeQuote(view,content,true);
    return '已加入 /btw 和引用，请输入问题后发送';
  }
  function quoteContent(item) {
    let uri = item.file || '';
    try { if (uri.startsWith('file:')) uri = decodeURIComponent(new URL(uri).pathname); } catch {}
    const source = uri ? `来源：${uri}` : '来源：当前文件预览';
    return `${item.text}\n\n${source}${item.locator ? '\n位置：'+item.locator : ''}`;
  }
  function perform(action,item) {
    if (!item.text?.trim()) throw new Error('请先选择文字或单元格。');
    if (item.text.length > 100000) throw new Error('选区超过 10 万字，请缩小范围。');
    const view = conversation(item.conversationId);
    if (!view) throw new Error('对应对话当前未打开，请返回原对话后重试。');
    const content = quoteContent(item);
    if (action === 'quote') {nativeQuote(view,content);return `已添加引用${item.locator?'（'+item.locator+'）':''}，可继续输入问题`;}
    else if (action === 'btw') return nativeBtw(view,content);
    else throw new Error('未知的选区操作。');
  }
  function clear() { toolbar?.remove(); toolbar=null; if (document.body) delete document.body.dataset.agFileSelection; }
  function show(item,rect) {
    clear(); document.body.dataset.agFileSelection='true';
    toolbar=document.createElement('div'); toolbar.id='ag-selection-toolbar';
    toolbar.setAttribute('role','toolbar'); toolbar.setAttribute('aria-label','文件选区操作');
    toolbar.addEventListener('pointerdown',e=>e.preventDefault());
    for (const [label,action] of [['添加到对话','quote'],['顺便问一下 /btw','btw']]) {
      const button=document.createElement('button'); button.type='button'; button.textContent=label;
      button.addEventListener('click',()=>{
        try { const message=perform(action,item); window.getSelection()?.removeAllRanges(); clear(); notify(message); }
        catch(error) { notify(error.message); }
      }); toolbar.append(button);
    }
    document.body.append(toolbar);
    toolbar.style.left=Math.max(8,Math.min(rect.right-toolbar.offsetWidth,innerWidth-toolbar.offsetWidth-8))+'px';
    toolbar.style.top=Math.max(8,Math.min(rect.bottom+8,innerHeight-toolbar.offsetHeight-8))+'px';
  }
  function readSelection() {
    const selection=window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) { clear(); return; }
    const range=selection.getRangeAt(0), start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const end=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
    const area=start?.closest(viewerSelector);
    if (!area || !area.contains(end) || start.closest('[contenteditable="true"],input,textarea')) { clear(); return; }
    const text=selection.toString().trim(); if (!text) { clear(); return; }
    const info=sourceInfo(area), inline=start.closest('[data-file-uri]');
    const first=start.closest('[data-line-start]')?.dataset.lineStart, last=end.closest('[data-line-end]')?.dataset.lineEnd;
    show({text,file:inline?.dataset.fileUri||info.uri,conversationId:info.conversationId,locator:first?`第 ${first}–${last||first} 行`:''},range.getBoundingClientRect());
  }
  document.addEventListener('selectionchange',()=>{clearTimeout(timer);timer=setTimeout(readSelection,130);},{signal});
  document.addEventListener('pointerup',e=>{if(!toolbar?.contains(e.target)){clearTimeout(timer);timer=setTimeout(readSelection,0);}},{signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')clear();},{signal});
  document.addEventListener('scroll',clear,{capture:true,signal});
  window.addEventListener('resize',clear,{signal});
  window[key]={version:'0.1.0',dispose(){lifecycle.abort();clearTimeout(timer);clearTimeout(toastTimer);clear();toast?.remove();style.remove();delete window[key];}};
  ctx.onCleanup(window[key].dispose);
})();

// codex-selection-actions-end
