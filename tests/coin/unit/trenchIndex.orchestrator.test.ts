import assert from 'node:assert/strict';
import test from 'node:test';
import { TrenchIndexOrchestrator } from '../../../src/main/coin/index/trenchIndex.orchestrator';
import type { GmgnReadInput } from '../../../src/main/coin/resources/gmgnCli.service';
import type {
  TrenchIndexStorageAddTargetsAndBeginRunInput,
  TrenchIndexWorkspaceSnapshot,
  TrenchIndexCompletedBatch,
  TrenchIndexStorageBeginRunInput,
} from '../../../src/shared/trench/trenchIndex.type';

const first = '0x1111111111111111111111111111111111111111';
const second = '0x2222222222222222222222222222222222222222';

const workspace: TrenchIndexWorkspaceSnapshot = {
  schema: 'bl-trench-index-workspace-v2',
  revision: 0,
  jobState: 'idle',
  activeRun: null,
  currentRun: null,
  lastFailedRun: null,
  chainProjections: [
    { chain: 'solana', targets: [], wallets: [] },
    { chain: 'bsc', targets: [], wallets: [] },
  ],
};

const makeHarness = (
  identity: (input: GmgnReadInput) => string,
  currentWorkspace: TrenchIndexWorkspaceSnapshot = workspace,
) => {
  const writes: TrenchIndexStorageAddTargetsAndBeginRunInput[] = [];
  const reads: GmgnReadInput[] = [];
  const storage = {
    getWorkspace: async () => ({ ok: true as const, value: currentWorkspace }),
    saveTargets: async (input: TrenchIndexStorageAddTargetsAndBeginRunInput) => {
      writes.push(input);
      return {
        ok: true as const,
        value: {
          requestId: input.requestId,
          revision: 1,
          targetPersistedCount: input.targets.length,
          replayed: false,
        },
      };
    },
    beginRun: async () => { throw new Error('unused'); },
    completeRun: async () => { throw new Error('unused'); },
    failRun: async () => { throw new Error('unused'); },
  };
  const orchestrator = new TrenchIndexOrchestrator({
    storage,
    gmgn: {
      read: async (input) => {
        reads.push(input);
        return {
          operation: input.operation,
          observedAt: 10,
          data: {
            address: identity(input),
            name: 'Token',
            symbol: 'TOK',
            market_cap: 10,
          },
        };
      },
    },
    broadcast: () => undefined,
  });
  return { orchestrator, reads, writes };
};

test('resolves an Add CA batch completely before one atomic storage command', async () => {
  const { orchestrator, writes } = makeHarness((input) => input.chain === 'bsc'
    ? String('address' in input ? input.address : '')
    : '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const result = await orchestrator.addTargets({
    requestId: '11111111-1111-4111-8111-111111111111',
    targets: [{ contractAddress: first }, { contractAddress: second }],
  });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.targets.length, 2);
  if (result.ok) assert.equal(result.value.targetPersistedCount, 2);
});

test('duplicate resolved identities collapse while unresolved items fail before storage mutation', async () => {
  const duplicate = makeHarness((input) => String('address' in input ? input.address : ''));
  const duplicateResult = await duplicate.orchestrator.addTargets({
    requestId: '22222222-2222-4222-8222-222222222222',
    targets: [{ contractAddress: first, chain: 'bsc' }, { contractAddress: first, chain: 'bsc' }],
  });
  assert.equal(duplicateResult.ok, true);
  assert.equal(duplicate.writes.length, 1);
  assert.equal(duplicate.writes[0]?.targets.length, 1);
  assert.equal(duplicate.reads.length, 1);

  const unresolved = makeHarness(() => '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const unresolvedResult = await unresolved.orchestrator.addTargets({
    requestId: '33333333-3333-4333-8333-333333333333',
    targets: [{ contractAddress: first, chain: 'bsc' }],
  });
  assert.equal(unresolvedResult.ok, false);
  if (!unresolvedResult.ok) assert.equal(unresolvedResult.error.code, 'TOKEN_NOT_FOUND');
  assert.equal(unresolved.writes.length, 0);
});

test('rejects an Add batch before GMGN resolution while a run is active', async () => {
  const harness = makeHarness((input) => String('address' in input ? input.address : ''), {
    ...workspace,
    jobState: 'running',
    activeRun: {
      runId: '88888888-8888-4888-8888-888888888888',
      trigger: 'reanalyze',
      status: 'running',
      startedAt: 10,
      completedAt: null,
      targetCount: 1,
      candidateCount: 0,
      eligibleCount: 0,
      publishedCount: 0,
      errorCode: null,
      errorMessage: null,
    },
  });
  const result = await harness.orchestrator.addTargets({
    requestId: '99999999-9999-4999-8999-999999999999',
    targets: [{ contractAddress: first }, { contractAddress: second }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'ANALYSIS_BUSY');
  assert.equal(harness.reads.length, 0);
  assert.equal(harness.writes.length, 0);
});

test('Add saves metadata only; selected-chain Generate explicitly analyzes incumbents and newcomers', async () => {
  const incumbent = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const newcomer = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const snapshot: TrenchIndexWorkspaceSnapshot = {
    ...workspace,
    chainProjections: [workspace.chainProjections[0]!, { chain: 'bsc', targets: [], wallets: [{
      walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      walletAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      chain: 'bsc', address: incumbent, canonicalAddress: incumbent,
      name: null, avatarUrl: null, note: null, metadata: {}, metadataSource: 'gmgn',
      walletKind: 'user', classificationSource: 'gmgn-addr-type', classificationUpdatedAt: 1,
      chainRank: 1, totalProfitUsd: 100, sourceCaCount: 1, profitableCaCount: 1, bestSourceRank: 1,
      realizedProfitUsd: 100, unrealizedProfitUsd: null,
    }] }],
  };
  const run = { runId: '99999999-9999-4999-8999-999999999999', revision: 1,
    targets: [{ targetId: '11111111-1111-4111-8111-111111111111', chain: 'bsc' as const,
      contractAddress: first, canonicalAddress: first }], replayed: false, status: 'running' as const };
  const batches: TrenchIndexCompletedBatch[] = [];
  const reads: GmgnReadInput[] = [];
  const runs: TrenchIndexStorageBeginRunInput[] = [];
  const orchestrator = new TrenchIndexOrchestrator({
    storage: {
      getWorkspace: async () => ({ ok: true, value: snapshot }),
      saveTargets: async (input) => ({ ok: true, value: {
        requestId: input.requestId, revision: 1, targetPersistedCount: input.targets.length, replayed: false,
      } }),
      beginRun: async (input) => { runs.push(input); return { ok: true, value: run }; },
      completeRun: async (batch) => { batches.push(batch); return { ok: true, value: { revision: 2 } }; },
      failRun: async () => { throw new Error('unexpected failure'); },
    },
    gmgn: { read: async (input) => {
      reads.push(input);
      return { operation: input.operation, observedAt: 100, data: input.operation === 'token-traders'
        ? { list: [{ address: incumbent, profit: 100, addr_type: 0 }, { address: newcomer, profit: 200, addr_type: 0 }] }
        : { address: 'address' in input ? input.address : '', name: 'Token' } };
    } },
    broadcast: () => undefined,
  });
  const added = await orchestrator.addTargets({ requestId: '11111111-1111-4111-8111-111111111111',
    targets: [{ chain: 'bsc', contractAddress: first }] });
  assert.equal(added.ok, true);
  await orchestrator.waitForIdle();
  assert.equal(batches.length, 0);
  assert.equal(runs.length, 0);
  assert.equal(reads.filter((read) => read.operation === 'token-traders').length, 0);
  assert.equal(reads.length, 1);
  assert.equal(reads.every((read) => 'address' in read && read.address === first), true);
  await orchestrator.reanalyze({ requestId: '22222222-2222-4222-8222-222222222222', chain: 'bsc' });
  await orchestrator.waitForIdle();
  assert.equal(runs[0]?.chain, 'bsc');
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0]!.wallets.map((row) => row.canonicalAddress), [newcomer, incumbent]);
  assert.equal(reads.filter((read) => read.operation === 'token-traders').length, 1);
});
