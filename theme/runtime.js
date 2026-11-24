// honu-lagoon-start
(() => {
  const key = '__AG_HONU__';
  window[key]?.dispose();
  const settings = __HONU_SETTINGS__;
  const scenes = __HONU_SCENES__;
  const root = document.documentElement;
  const originalTheme = root.getAttribute('data-ag-honu');
  const lifecycle = new AbortController(), signal = lifecycle.signal;
  const storageKey = 'ag-honu-settings-v1';
  let saved; try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch {}
  let mode = saved?.revision === settings.revision ? saved.mode : settings.mode;
  const modes = ['honu-lagoon','night-reef','auto','off'];
  if (!modes.includes(mode)) mode = settings.mode;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const paneSelector = '[data-testid="conversation-view"],.agy-home';
  let stage, sceneHost, sceneRoot, currentScene, frame = 0;
  const surfaces = new Map(), cleared = new Map(), projectColors = new Map();
  const decorations = new WeakSet();
  const control = document.createElement('select');
  control.id = 'ag-honu-control'; control.setAttribute('aria-label','海景主题'); control.title = '海景主题：浅色、深色、跟随系统或关闭海景';
  for (const [value,label] of [['honu-lagoon','☀ 浅色海景'],['night-reef','☾ 深色海景'],['auto','◐ 跟随系统'],['off','○ 关闭海景']]) {
    const option = document.createElement('option'); option.value=value; option.textContent=label; control.append(option);
  }
  control.addEventListener('change',()=>setMode(control.value),{signal});
  function restoreAttribute(element, name, previous) {
    if (previous === null) element.removeAttribute(name);
    else element.setAttribute(name, previous);
  }
  function mark(element, name, value = '') {
    const previous = element.getAttribute(name);
    element.setAttribute(name, value);
    return () => restoreAttribute(element, name, previous);
  }
  function findAnchor(owner) {
    const anchors = [...owner.querySelectorAll('[data-testid="agent-input-box"]')]
      .filter(element => element.closest(paneSelector) === owner);
    if (anchors.length) return anchors.length === 1 ? anchors[0] : null;
    return owner.matches('.agy-home')
      ? owner.querySelector(':scope [data-testid="home-greeting"]')
      : null;
  }
  function bindSurface(owner, anchor) {
    const glass = document.createElement('div');
    glass.className = 'ag-honu-glass';
    glass.setAttribute('aria-hidden', 'true');
    decorations.add(glass);
    const restoreOwner = mark(owner, 'data-ag-honu-pane');
    const restoreAnchor = mark(anchor, 'data-ag-honu-anchor');
    owner.append(glass);
    return { anchor, glass, restore() { glass.remove(); restoreAnchor(); restoreOwner(); } };
  }
  function refreshSurfaces(app) {
    const panes = new Map();
    const ancestors = new Set();
    for (const owner of app.querySelectorAll(paneSelector)) {
      const anchor = findAnchor(owner);
      if (!anchor) continue;
      panes.set(owner, anchor);
      for (let el = owner.parentElement; el && el !== document.body; el = el.parentElement) {
        ancestors.add(el);
      }
    }
    for (const [owner, binding] of surfaces) {
      if (panes.get(owner) === binding.anchor && binding.glass.parentElement === owner) continue;
      binding.restore();
      surfaces.delete(owner);
    }
    for (const [owner, anchor] of panes) {
      if (!surfaces.has(owner)) surfaces.set(owner, bindSurface(owner, anchor));
    }
    for (const [element, restore] of cleared) {
      if (ancestors.has(element)) continue;
      restore();
      cleared.delete(element);
    }
    for (const element of ancestors) {
      if (!cleared.has(element)) cleared.set(element, mark(element, 'data-ag-honu-clear'));
    }
  }
  function pause() {
    sceneHost?.toggleAttribute('data-paused',document.hidden || !document.hasFocus());
  }
  function cleanupStage() {
    stage?.remove(); stage=null; sceneHost=null; sceneRoot=null; currentScene=null;
    for (const restore of projectColors.values()) restore();
    projectColors.clear();
    for (const binding of surfaces.values()) binding.restore();
    surfaces.clear();
    for (const restore of cleared.values()) restore();
    cleared.clear();
  }
  function renderScene(name) {
    if(!stage) {
      stage=document.createElement('div');stage.id='ag-honu-stage';stage.setAttribute('aria-hidden','true');
      decorations.add(stage);
      sceneHost=document.createElement('div');sceneHost.id='ag-honu-scene';stage.append(sceneHost);
      sceneRoot=sceneHost.attachShadow({mode:'open'});
      document.body.prepend(stage);
    }
    if(currentScene!==name) {
      sceneRoot.innerHTML = `<style>:host{display:block;position:absolute;inset:0;pointer-events:none}svg{display:block;width:100%;height:100%}:host([data-paused]) *{animation-play-state:paused!important}</style>` + scenes[name];
      currentScene=name;pause();
    }
  }
  function refresh() {
    frame=0;
    const app = document.getElementById('root');
    const toolbar = app?.querySelector('[data-testid="pane-titlebar-toolbar"]');
    if(toolbar && control.parentElement!==toolbar)toolbar.prepend(control);
    control.value=mode;
    if(mode==='off' || !app)return;
    for(const el of app.querySelectorAll('[data-testid="project-header"]'))if(!projectColors.has(el)) {
      const label=el.dataset.projectLabel||el.textContent;let hash=0;for(const c of label)hash=(hash*31+c.charCodeAt(0))>>>0;
      projectColors.set(el,mark(el,'data-ag-honu-color',String(hash%5)));
    }
    for (const [el, restore] of projectColors) {
      if (app.contains(el)) continue;
      restore();
      projectColors.delete(el);
    }
    refreshSurfaces(app);
  }
  function schedule() {if(!frame)frame=requestAnimationFrame(refresh);}
  function apply() {
    control.value=mode;
    if(mode==='off') {root.removeAttribute('data-ag-honu');cleanupStage();schedule();return;}
    const name=mode==='auto'?(media.matches?'night-reef':'honu-lagoon'):mode;
    root.setAttribute('data-ag-honu',name);renderScene(name);schedule();
  }
  function setMode(next) {
    if(!modes.includes(next))return;
    mode=next;localStorage.setItem(storageKey,JSON.stringify({mode,revision:settings.revision}));apply();
  }
  const observer=new MutationObserver(records=>{
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
      node.nodeType === 1 && node !== control && !decorations.has(node)))) schedule();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('focus',pause,{signal});window.addEventListener('blur',pause,{signal});document.addEventListener('visibilitychange',pause,{signal});
  media.addEventListener('change',apply,{signal});
  window[key]={setMode,get mode(){return mode},dispose(){
    if (signal.aborted) return;
    lifecycle.abort();observer.disconnect();cancelAnimationFrame(frame);cleanupStage();control.remove();
    restoreAttribute(root,'data-ag-honu',originalTheme);delete window[key];
  }};
  ctx.onCleanup(window[key].dispose);
  apply();
})();
// honu-lagoon-end
