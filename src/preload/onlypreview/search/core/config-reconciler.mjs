import { CONFIG_QUIET_MS } from './constants.mjs';

export const createWorkspaceConfigReconciler = ({
  enqueue,
  readConfig,
  readSignature,
  initialSignature,
  applyConfig,
  isCurrent,
  onError,
  clock = { now: Date.now, setTimeout, clearTimeout }
}) => {
  let revision = 0;
  let deadline = 0;
  let pending = false;
  let queued = false;
  let closed = false;
  let timer;
  let signature = initialSignature;
  let observing;
  let observationRequested = false;
  let probeRequested = false;

  const current = (expected) => !closed && isCurrent() && expected === revision;
  const clearTimer = () => {
    clock.clearTimeout(timer);
    timer = undefined;
  };
  const report = (error) => {
    try {
      onError(error);
    } catch {
      /* Reporting cannot restart or break the config queue. */
    }
  };
  const schedule = () => {
    clearTimer();
    if (closed || !pending || queued) return;
    timer = clock.setTimeout(dispatch, Math.max(0, deadline - clock.now()));
    timer?.unref?.();
  };
  const dispatch = () => {
    timer = undefined;
    if (closed || queued || !pending) return;
    const expected = revision;
    queued = true;
    enqueue(async () => {
      if (!current(expected) || clock.now() < deadline) return;
      try {
        const config = await readConfig();
        if (!current(expected) || clock.now() < deadline) return;
        pending = false;
        await applyConfig(config);
      } catch (error) {
        if (!current(expected)) return;
        pending = false;
        report(error);
      }
    })
      .finally(() => {
        queued = false;
        schedule();
      })
      .catch(report);
  };
  const observe = (markIfChanged) => {
    if (closed) return Promise.resolve();
    observationRequested = true;
    probeRequested ||= markIfChanged;
    if (observing) return observing;
    observing = (async () => {
      while (observationRequested && !closed) {
        const expected = revision;
        const shouldMark = probeRequested;
        observationRequested = false;
        probeRequested = false;
        const nextSignature = await readSignature();
        if (!current(expected) || signature === nextSignature) continue;
        signature = nextSignature;
        if (shouldMark) markChanged(false);
      }
    })().finally(() => {
      observing = undefined;
      if (observationRequested && !closed) void observe(false).catch(report);
    });
    return observing;
  };
  const markChanged = (observeSignature = true) => {
    if (closed || !isCurrent()) return;
    revision += 1;
    pending = true;
    deadline = clock.now() + CONFIG_QUIET_MS;
    schedule();
    if (observeSignature) void observe(false).catch(report);
  };
  return {
    markChanged,
    probe: () => observe(true),
    close() {
      closed = true;
      pending = false;
      revision += 1;
      clearTimer();
    }
  };
};
