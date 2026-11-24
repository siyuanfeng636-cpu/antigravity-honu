import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../dock-badge.js', import.meta.url), 'utf8');

function snapshot(summaries, { unread = [], waiting = [], activeId, viewed = {} } = {}) {
  const index = ids => Object.fromEntries(ids.map(id => [id, true]));
  return {
    trajectorySummaries: {
      hasLoadedInitialSummaries: true,
      summaries,
      indexes: { serverUnread: index(unread), hasWaitingSteps: index(waiting) },
    },
    conversation: {
      convoState: activeId ? { type: 'active', cascadeId: activeId } : { type: 'idle' },
      localLastViewedTimes: viewed,
    },
  };
}

function mount(initial) {
  let state = initial;
  let focused = false;
  let dispose;
  let lock;
  const writes = [];
  const listeners = new Set();
  const store = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const window = new EventTarget();
  window.top = window;
  const document = Object.assign(new EventTarget(), {
    hasFocus: () => focused,
    visibilityState: 'visible',
    querySelector: () => ({ __reactFiber$mock: { memoizedProps: { value: { store } } } }),
  });
  runInNewContext(script, {
    window, document, AbortController, setTimeout, clearTimeout,
    location: new URL('https://127.0.0.1/c/example'),
    navigator: {
      userAgent: 'Antigravity/2.33.0',
      setAppBadge: async count => { writes.push(count); },
      clearAppBadge: async () => { writes.push(0); },
      locks: { request: (_name, _options, grant) => { lock = grant(); return lock; } },
    },
    ctx: { onCleanup: handler => { dispose = handler; } },
  });
  return {
    writes,
    setState(nextState) {
      state = nextState;
      for (const listener of listeners) listener();
    },
    setFocus(value) {
      focused = value;
      window.dispatchEvent(new Event(value ? 'focus' : 'blur'));
    },
    async uninstall() {
      dispose();
      await lock;
      assert.equal(listeners.size, 0);
    },
  };
}

const finished = { status: 1, latestExecutorTerminationReason: 4, lastModifiedTime: { seconds: 100 } };
const approval = { status: 2, waitingSteps: [{}, {}] };

test('普通回复结束时计入后台未读，已读或用户取消时不计数', async () => {
  const summaries = {
    reply: { ...finished, summary: '要继续吗？' },
    canceled: { ...finished, latestExecutorTerminationReason: 2 },
  };
  const unread = Object.keys(summaries);
  const app = mount(snapshot(summaries, { unread, activeId: 'reply' }));
  assert.deepEqual(app.writes, [1]);
  app.setFocus(true);
  assert.deepEqual(app.writes, [1, 0]);

  app.setState(snapshot(summaries, { unread, viewed: { reply: 101 } }));
  app.setFocus(false);
  assert.deepEqual(app.writes, [1, 0]);
  await app.uninstall();
});

test('独立审批与未读完成分别计数，同一会话的多个请求及转发只计一次', async () => {
  const forwarded = {
    status: 1,
    hasActiveChildren: true,
    waitingSteps: [{ step: { metadata: { sourceTrajectoryStepInfo: { cascadeId: 'child' } } } }],
  };
  const summaries = { parent: forwarded, child: approval, reply: finished };
  const app = mount(snapshot(summaries, { unread: ['reply'], waiting: ['parent', 'child'] }));
  assert.deepEqual(app.writes, [2]);

  app.setState(snapshot(summaries, { waiting: ['parent', 'child'] }));
  app.setState(snapshot({ ...summaries, child: finished }, { unread: ['child'], waiting: ['parent'] }));
  assert.deepEqual(app.writes, [2, 1]);

  app.setState(snapshot({}));
  assert.deepEqual(app.writes, [2, 1, 0]);
  await app.uninstall();
});

test('热卸载清除角标和订阅，后续状态变化不会重新写入', async () => {
  const pending = snapshot({ child: approval }, { waiting: ['child'] });
  const app = mount(pending);
  await app.uninstall();
  app.setState(pending);
  app.setFocus(true);
  assert.deepEqual(app.writes, [1, 0]);
});
