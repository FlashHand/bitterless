import type { WebContents, WebContentsView } from 'electron';

export interface CoinWindowSurface {
  readonly view: WebContentsView;
  readonly webContents: WebContents;
  readonly token: string;
  isDestroyed(): boolean;
}
