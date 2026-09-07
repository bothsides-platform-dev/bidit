// 드리프트 가드 — `target="_blank"` 를 쓰는 컴포넌트는 새 탭 고지를 함께 가져야 한다.
//
// 새 탭이 열리는 건 사용자가 요청하지 않은 맥락 변경이라 링크가 미리 알려야 하는데
// (WCAG 2.4.4 / G201), 이건 눈으로 보면 멀쩡해 보여서 리뷰에서 놓치기 쉽다. 실제로
// 2026-07-22 전수 조사 전까지 8개 사이트 중 6개에 고지가 없었다.
//
// ⚠ 정밀도의 한계를 알고 쓸 것: 파일 단위 검사다. 한 파일에 _blank 링크가 둘인데
// 하나에만 고지가 붙어도 통과한다. JSX 를 정규식으로 파싱해 링크 단위로 짝지으려면
// 깨지기 쉬운 코드가 되므로, "새 파일이 고지 없이 들어오는" 흔한 회귀만 막는다.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { NEW_TAB_NOTICE, NEW_TAB_DOWNLOAD_NOTICE } from '../link-notice';

const ROOT = path.resolve(__dirname, '../../..');

/** 링크의 목적 자체가 "새 창 열기" 라 라벨이 곧 고지인 경우(BidPdfPane 등). */
const VISIBLE_ACTION_LABEL = '새 창 열기';

function tsxFilesWithBlankTarget(): string[] {
  // git ls-files: node_modules·빌드 산출물을 자동으로 제외하고 추적 파일만 본다.
  const tracked = execFileSync('git', ['ls-files', '*.tsx'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('__tests__'))
    // git ls-files 는 삭제를 stage 하기 전까지 index의 경로를 포함한다.
    .filter((f) => existsSync(path.join(ROOT, f)));
  return tracked.filter((f) => readFileSync(path.join(ROOT, f), 'utf8').includes('target="_blank"'));
}

describe('target="_blank" 새 탭 고지', () => {
  it('전수 조사 기준선 — _blank 를 쓰는 파일이 실제로 존재한다', () => {
    // 검사 대상이 0개면 위 테스트가 공허하게 통과한다. 기준선을 못박아 그걸 막는다.
    expect(tsxFilesWithBlankTarget().length).toBeGreaterThanOrEqual(6);
  });

  it('_blank 를 쓰는 모든 컴포넌트가 새 탭 고지를 가진다', () => {
    const missing = tsxFilesWithBlankTarget().filter((f) => {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      return (
        !src.includes('NEW_TAB_NOTICE') &&
        !src.includes('NEW_TAB_DOWNLOAD_NOTICE') &&
        !src.includes(VISIBLE_ACTION_LABEL)
      );
    });
    expect(missing).toEqual([]);
  });

  it('두 고지 문구는 서로 다르다 — 다운로드 여부가 구분돼야 한다', () => {
    expect(NEW_TAB_NOTICE).not.toBe(NEW_TAB_DOWNLOAD_NOTICE);
  });
});
