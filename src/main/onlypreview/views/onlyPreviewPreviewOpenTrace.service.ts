import type { OnlyPreviewOpenTrace } from '@shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';
import { onlyPreviewOpenDiagnostics } from '@main/onlypreview/onlyPreviewOpenDiagnostics.runtime';

type OnlyPreviewOpenTraceSurface = 'vue' | 'chrome' | 'office' | 'unknown';

export type OnlyPreviewOpenTraceOutcome = 'ready' | 'error' | 'superseded';

/**
 * One open trace per selection revision. A revision that never began a trace — a transition to an
 * empty selection — silently ignores every later mark and terminal, so callers do not have to know
 * whether the revision they hold is traced.
 */
export class OnlyPreviewPreviewOpenTraceRegistry {
  private readonly traces = new Map<
    number,
    { trace: OnlyPreviewOpenTrace; surface: OnlyPreviewOpenTraceSurface }
  >();

  begin(revision: number, parentOpenTag?: string): void {
    this.traces.set(revision, {
      trace: onlyPreviewOpenDiagnostics.trace(
        'preview',
        { parentTag: parentOpenTag, revision, surface: 'unknown' },
        'p'
      ),
      surface: 'unknown'
    });
  }

  mark(revision: number, fields: Record<string, unknown>): void {
    const active = this.traces.get(revision);
    if (!active) return;
    if (fields.surface === 'vue' || fields.surface === 'chrome' || fields.surface === 'office') {
      active.surface = fields.surface;
    }
    active.trace.mark({ revision, ...fields });
  }

  finish(revision: number, outcome: OnlyPreviewOpenTraceOutcome): void {
    const active = this.traces.get(revision);
    if (!active) return;
    this.traces.delete(revision);
    active.trace.end({ revision, surface: active.surface, outcome });
  }

  supersedeAll(): void {
    for (const [revision] of this.traces) this.finish(revision, 'superseded');
  }
}
