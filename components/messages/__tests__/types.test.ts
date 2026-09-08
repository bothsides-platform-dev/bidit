// toCounterparty — WorkspaceDisplay → Counterparty 다리. RfpInviteManager·RfpPendingRequests·
// RfpBriefPanel·BidContextStrip 이 전부 이 함수 하나로 신원을 옮긴다(손으로 필드를 펼치지
// 않는다). 지금까지 4곳 전부 컴포넌트 렌더 테스트로만 간접 검증됐다 — 여기서 함수 자체의
// 계약(필드 매핑 + logoUpdatedAt null 보존)을 직접 고정한다.
import { describe, expect, it } from 'vitest';

import { toCounterparty } from '../types';
import type { WorkspaceDisplay } from '@/lib/types/workspace';

describe('toCounterparty', () => {
  it('워크스페이스 신원 필드를 그대로 옮긴다 (id→workspaceId, 나머지는 동명)', () => {
    const ws: WorkspaceDisplay = {
      id: 'ws-1',
      name: 'KG이니시스',
      type: 'pg',
      logoUpdatedAt: '2026-01-02T03:04:05.000Z',
    };

    expect(toCounterparty(ws)).toEqual({
      name: 'KG이니시스',
      type: 'pg',
      workspaceId: 'ws-1',
      logoUpdatedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('logoUpdatedAt=null 을 undefined 로 바꾸지 않고 그대로 보존한다', () => {
    const ws: WorkspaceDisplay = {
      id: 'ws-2',
      name: '(주)진짜상사',
      type: 'buyer',
      logoUpdatedAt: null,
    };

    const result = toCounterparty(ws);
    expect(result.logoUpdatedAt).toBeNull();
    expect('logoUpdatedAt' in result).toBe(true);
  });
});
