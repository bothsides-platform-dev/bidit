import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readPage = (route: 'rfp' | 'inbox') =>
  readFileSync(resolve(__dirname, `../${route}/page.tsx`), 'utf8');

const readHomeLoading = () =>
  readFileSync(resolve(__dirname, '../home/loading.tsx'), 'utf8');

describe('견적 목록 페이지 표 전용 계약', () => {
  it.each(['rfp', 'inbox'] as const)(
    '/%s는 view 쿼리·쿠키와 칸반 컴포넌트를 사용하지 않는다',
    (route) => {
      const source = readPage(route);

      expect(source).not.toMatch(/\bcookies\s*\(/);
      expect(source).not.toContain('resolveBoardView');
      expect(source).not.toContain('paramsForView');
      expect(source).not.toContain('BoardViewToggle');
      expect(source).not.toContain('PipelineBoard');
      expect(source).not.toMatch(/\bview\s*[:=]/);
    },
  );

  it('/rfp는 필터 결과를 RfpListTable에 전달한다', () => {
    const source = readPage('rfp');

    expect(source).toContain('filterRfps(allRfps, params, now)');
    expect(source).toContain('<RfpListTable rfps={rfps} />');
  });

  it('/inbox는 필터 결과를 InboxList에 전달한다', () => {
    const source = readPage('inbox');

    expect(source).toContain('filterInboxRows(allRows, params, now)');
    expect(source).toContain('<InboxList rows={rows} />');
  });

  it('/home 로딩 화면은 칸반이 아니라 현재 대시보드 스켈레톤을 사용한다', () => {
    const source = readHomeLoading();

    expect(source).toContain('HomeDashboardSkeleton');
    expect(source).not.toContain('KanbanBoardSkeleton');
  });
});
