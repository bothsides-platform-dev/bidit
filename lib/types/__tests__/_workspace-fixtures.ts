// 표시용 워크스페이스 신원(`WorkspaceDisplay`) 테스트 픽스처 — 아바타를 그리는 화면의
// 테스트가 공유한다.
//
// 왜 한 곳인가: 이 픽스처를 파일마다 복사하면 `logoUpdatedAt` 기본값이 파일마다 갈라질 수
// 있고, 그러면 "로고가 없다"와 "로고를 안 넘겼다"를 구분하려고 타입을 필수로 만든 이번
// 변경의 취지가 테스트 쪽에서 도로 흐려진다. `_` 접두사라 vitest include
// (`*.{test,spec}.*`)에 걸리지 않는다.
import type { WorkspaceDisplay } from '@/lib/types/workspace';

/** 구매사 신원 — 이름만 바꿔 쓰는 단일 구매사 시나리오용. */
export const buyerOf = (name: string): WorkspaceDisplay => ({
  id: 'ws-buyer',
  name,
  type: 'buyer',
  logoUpdatedAt: null,
});

/**
 * pgWsId → PG 신원 맵. 이름 맵과 로고 맵을 나누지 않는다 — 둘로 나뉜 병렬 Record 가
 * 한쪽만 배선되는 사고를 낳았고, 그것이 이번 수정의 원인이다.
 *
 * `logos` 를 생략하면 전원 로고 없음(`null`)이다. "이름은 아는데 로고가 없는 PG" 와
 * "아예 모르는 PG" 는 다른 시나리오이므로, 전자를 검증할 때 `names` 를 비우지 말 것.
 */
export const wsById = (
  names: Record<string, string>,
  logos: Record<string, string | null> = {},
): Record<string, WorkspaceDisplay> =>
  Object.fromEntries(
    Object.entries(names).map(([id, name]) => [
      id,
      { id, name, type: 'pg' as const, logoUpdatedAt: logos[id] ?? null },
    ]),
  );
