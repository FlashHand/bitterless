export const TRENCH_HOST_CHANGED_EVENT = 'trench/hostChanged';

export interface TrenchHostState {
  host: 'standalone' | 'tab';
  canDock: boolean;
  pending: boolean;
}

export interface TrenchHostApi {
  openCoinWindow(): Promise<void>;
  openCoinTab(): Promise<void>;
  getHostState(input: { token: string }): Promise<TrenchHostState>;
  toggleHost(input: { token: string }): Promise<void>;
}
