// antigravity-dock-badge-start
(() => {
  if (window.top !== window || location.protocol !== 'https:' || location.hostname !== '127.0.0.1' ||
      !/Antigravity\//i.test(navigator.userAgent) || typeof navigator.setAppBadge !== 'function') return;
  if (/^\/(settings-standalone|artifact|terminal-standalone)/.test(location.pathname)) return;

  function findStore() {
    const anchor = document.querySelector('[data-testid="settings-button"], [id="antigravity.agentSidePanelInputBox"]');
    if (!anchor) return;
    const fiberKey = Object.keys(anchor).find(key => key.startsWith('__reactFiber$'));
    for (let fiber = anchor[fiberKey]; fiber; fiber = fiber.return) {
      const store = fiber.memoizedProps?.value?.store;
      if (typeof store?.subscribe === 'function' && store.getState?.().trajectorySummaries) return store;
    }
  }

  function badgeCount(slice, view, focused) {
    const conversations = new Set();
    // serverUnread 是宿主维护的已结束、未归档、未读的主会话索引。
    for (const id of Object.keys(slice.indexes?.serverUnread ?? {})) {
      const row = slice.summaries[id];
      if (!row || row.latestExecutorTerminationReason === 2) continue; // USER_CANCELED
      const viewing = focused && view?.convoState?.type === 'active' && view.convoState.cascadeId === id;
      const lastView = view?.localLastViewedTimes?.[id] ?? 0;
      if (row.annotations?.markedAsUnread || (!viewing && (row.lastModifiedTime?.seconds ?? 0) > lastView)) {
        conversations.add(id);
      }
    }
    const ids = Object.keys(slice.indexes?.hasWaitingSteps ?? slice.summaries);
    for (const id of ids) {
      const row = slice.summaries[id];
      // 2.33 的 RUNNING = 2、BUSY = 4。父会话也可能转发子会话的同一个请求。
      if (!row || !(row.status === 2 || row.status === 4 || row.hasActiveChildren)) continue;
      const meta = row.trajectoryMetadata;
      const source = meta?.sourceMetadata;
      if (source?.hideFromConversationList && !meta.parentConversationId &&
          !(source.payload?.case === 'tool' && source.payload.value?.conversationId)) continue;
      for (const step of row.waitingSteps ?? []) {
        conversations.add(step.step?.metadata?.sourceTrajectoryStepInfo?.cascadeId || id);
      }
    }
    return conversations.size;
  }

  const lifetime = new AbortController();
  let retry, unsubscribe, release;
  function monitor(store) {
    let lastSlice, lastView, lastFocused, lastCount;
    function update() {
      const {trajectorySummaries: slice, conversation: view} = store.getState();
      if (!slice?.hasLoadedInitialSummaries || slice.snapshotInFlight) return;
      const focused = document.visibilityState === 'visible' && document.hasFocus();
      if (slice === lastSlice && view === lastView && focused === lastFocused) return;
      lastSlice = slice;
      lastView = view;
      lastFocused = focused;
      const count = badgeCount(slice, view, focused);
      if (count === lastCount) return;
      lastCount = count;
      const write = count ? navigator.setAppBadge(count) : navigator.clearAppBadge();
      write.catch(() => { lastSlice = lastCount = undefined; });
    }
    unsubscribe = store.subscribe(update);
    window.addEventListener('focus', update, { signal: lifetime.signal });
    window.addEventListener('blur', update, { signal: lifetime.signal });
    document.addEventListener('visibilitychange', update, { signal: lifetime.signal });
    update();
  }

  function attach() {
    const store = findStore();
    if (!store) {
      retry = setTimeout(attach, 1500);
      return;
    }
    // 多个主窗口共用一个 Dock 图标，只让一个窗口写角标。
    navigator.locks.request('antigravity-pending-input-dock-badge', { signal: lifetime.signal }, () => {
      if (lifetime.signal.aborted) return;
      const held = new Promise(resolve => { release = resolve; });
      monitor(store);
      return held;
    }).catch(error => { if (error.name !== 'AbortError') console.warn('Dock 角标订阅失败', error); });
  }

  function dispose() {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    clearTimeout(retry);
    unsubscribe?.();
    if (release) {
      navigator.clearAppBadge().catch(() => {});
      release();
    }
  }
  window.addEventListener('pagehide', dispose, { once: true, signal: lifetime.signal });
  ctx.onCleanup(dispose);
  attach();
})();
// antigravity-dock-badge-end
