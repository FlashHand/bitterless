import type { OnlyPreviewShellStore } from './onlyPreviewShell.store';
import { getOnlyPreviewParentPath } from './onlyPreviewTree.service';

export class OnlyPreviewTreeExpansionStore {
  revision = 0;
  private suppressedSelection: string | null = null;

  collapse(
    owner: Pick<
      OnlyPreviewShellStore,
      'workspace' | 'index' | 'selectedRelativePath' | 'expandedPaths'
    >
  ): void {
    if (!owner.workspace || !owner.index) return;
    this.suppressedSelection = owner.selectedRelativePath;
    this.revision += 1;
    owner.expandedPaths.clear();
    owner.expandedPaths.add('');
  }

  reset(): void {
    this.suppressedSelection = null;
    this.revision += 1;
  }

  expandSelectedParents(owner: OnlyPreviewShellStore, explicit = false): void {
    if (explicit) this.suppressedSelection = null;
    if (this.suppressedSelection === owner.selectedRelativePath) return;
    let current = getOnlyPreviewParentPath(owner.selectedRelativePath);
    while (current) {
      owner.expandedPaths.add(current);
      current = getOnlyPreviewParentPath(current);
    }
  }

  async locate(owner: OnlyPreviewShellStore, loadParents: () => Promise<void>): Promise<string> {
    if (!owner.selectedRelativePath) return '';
    const revision = this.revision;
    owner.collapseTreeSelection();
    owner.treeSelectedRelativePath = owner.selectedRelativePath;
    this.expandSelectedParents(owner, true);
    await loadParents();
    if (revision !== this.revision || !owner.selectedEntry) return '';
    owner.focusedRelativePath = owner.selectedEntry.relativePath;
    return owner.focusedRelativePath;
  }
}
