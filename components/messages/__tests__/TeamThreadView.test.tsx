// TeamThreadView — RFP 팀 채팅(내부 메모) 스레드. ThreadView 와 동일한 시각
// 언어(말풍선·날짜 구분선·그룹핑)를 따르되 표면은 훨씬 작다: 메시지만 (타이핑/
// 프레즌스/읽음/첨부 없음 — v1 확정 결정). 내부 스레드이므로 타인 메시지에
// 멤버 이름+아바타 헤더를 단다.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { formatTime } from '../format';
import { isThreadOpen } from '@/lib/chat/open-threads';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// 하단 센티널 가시성 관찰자 — 읽음의 두 번째 게이트. jsdom 에 없어 스텁한다.
type IoCb = (entries: { isIntersecting: boolean }[]) => void;
const intersectionObservers: { fire: (v: boolean) => void }[] = [];
class IntersectionObserverStub {
  constructor(cb: IoCb) {
    intersectionObservers.push({ fire: (v) => cb([{ isIntersecting: v }]) });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);

function scrollAwayFromBottom(): void {
  for (const o of intersectionObservers) o.fire(false);
}
function scrollBackToBottom(): void {
  for (const o of intersectionObservers) o.fire(true);
}

const sendTeamMessageAction = vi.fn();
vi.mock('@/lib/server/actions/chat/sendTeamMessageAction', () => ({
  sendTeamMessageAction: (...args: unknown[]) => sendTeamMessageAction(...args),
}));

vi.mock('@/lib/server/actions/chat/markTeamThreadReadAction', () => ({
  markTeamThreadReadAction: vi.fn().mockResolvedValue({ ok: true, readAt: '2026-06-14T00:00:00Z' }),
}));
import { markTeamThreadReadAction } from '@/lib/server/actions/chat/markTeamThreadReadAction';

// uploadAttachment (presigned 3-step client helper) — mock so the test controls the upload.
const uploadAttachment = vi.fn();
vi.mock('@/lib/attachments/upload-client', () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachment(...args),
}));

type TeamPayload = { type?: string; [k: string]: unknown };
let channelOptions: { onMessage?: (d: TeamPayload) => void } = {};
let channelResult: { connected: boolean | null } = { connected: null };
vi.mock('@/lib/hooks/useTeamChannel', () => ({
  useTeamChannel: (
    _rfpId: string,
    _wsId: string,
    opts: typeof channelOptions,
  ): typeof channelResult => {
    channelOptions = opts;
    return channelResult;
  },
}));

// 알림 스토어의 로컬 배지 정리 — 서버 액션 체인을 끌고 오므로 mock 한다.
const markThreadReadLocal = vi.fn();
vi.mock('@/lib/hooks/useNotifications', () => ({
  markThreadReadLocal: (...args: unknown[]) => markThreadReadLocal(...args),
}));

const toast = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: (...args: unknown[]) => toast(...args),
}));

// Author avatars now render as UserProfileCard triggers — that pulls in (at import
// time) getUserProfileAction + MessageComposeSheet's 'use server' chain
// (next-auth/DB, jsdom-unsafe) and useUserPresence. Mock them all.
vi.mock('@/lib/server/actions/user/getUserProfileAction', () => ({
  getUserProfileAction: vi.fn(),
}));
vi.mock('@/lib/server/actions/chat/sendChatMessageAction', () => ({
  sendChatMessageAction: vi.fn(),
}));
vi.mock('@/lib/server/actions/chat/listTemplatesAction', () => ({
  listTemplatesAction: vi.fn().mockResolvedValue({ ok: true, templates: [] }),
}));
vi.mock('@/lib/server/actions/chat/saveTemplateAction', () => ({
  saveTemplateAction: vi.fn(),
}));
vi.mock('@/components/presence/WorkspacePresenceProvider', () => ({
  useUserPresence: () => false,
}));

afterEach(() => cleanup());
beforeEach(() => {
  sendTeamMessageAction.mockReset();
  sendTeamMessageAction.mockResolvedValue({
    ok: true,
    messageId: 'tm-new',
    createdAt: '2026-06-10T10:05:00.000Z',
  });
  toast.mockReset();
  uploadAttachment.mockReset();
  channelOptions = {};
  channelResult = { connected: null };
  vi.mocked(markTeamThreadReadAction).mockClear();
  intersectionObservers.length = 0;
});

import { TeamThreadView } from '../TeamThreadView';
import type { TeamThreadMessage } from '@/lib/server/actions/chat/teamThreadLoader';

// T03:00Z–T14:00Z 창 안의 타임스탬프 — UTC/KST 날짜가 일치(타임존 플레이크 방지).
const messages: TeamThreadMessage[] = [
  {
    id: 'tm1',
    authorUserId: 'u-mate',
    authorName: '이동료',
    authorAvatarUpdatedAt: null,
    body: '이 견적 수수료 괜찮은데요?',
    createdAt: '2026-06-09T05:00:00.000Z',
    isSelf: false,
    attachments: [],
  },
  {
    id: 'tm2',
    authorUserId: 'u-me',
    authorName: '김구매',
    authorAvatarUpdatedAt: null,
    body: '내일 회의에서 정리하시죠.',
    createdAt: '2026-06-10T05:00:00.000Z',
    isSelf: true,
    attachments: [],
  },
];

const teamMembers = [
  { userId: 'u-mate', name: '이동료', joinedAt: '2026-03-14T00:00:00.000Z', avatarUpdatedAt: null },
  { userId: 'u-me', name: '김구매', joinedAt: '2026-04-01T00:00:00.000Z', avatarUpdatedAt: null },
];

function base(overrides: Partial<React.ComponentProps<typeof TeamThreadView>> = {}) {
  return (
    <TeamThreadView
      rfpId="rfp-1"
      workspaceId="ws-1"
      viewerUserId="u-me"
      viewerAvatarUpdatedAt={null}
      messages={messages}
      teamMembers={teamMembers}
      {...overrides}
    />
  );
}

describe('TeamThreadView — 렌더', () => {
  it('타인 메시지는 좌측 + 작성자 이름/아바타, 본인 메시지는 우측 + 헤더 생략', () => {
    render(base());

    const other = screen
      .getByText('이 견적 수수료 괜찮은데요?')
      .closest('[data-message-row]');
    const self = screen
      .getByText('내일 회의에서 정리하시죠.')
      .closest('[data-message-row]');

    expect(other).toHaveAttribute('data-sender', 'other');
    expect(self).toHaveAttribute('data-sender', 'self');
    expect(screen.getByText('이동료')).toBeInTheDocument();
    expect(screen.queryByText('김구매')).not.toBeInTheDocument();
  });

  it('날짜가 바뀌면 날짜 구분선을 렌더한다', () => {
    render(base());
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('메시지가 없으면 내부 전용임을 알리는 빈 상태를 보여준다', () => {
    render(base({ messages: [] }));
    expect(screen.getByText('아직 팀 메시지가 없어요')).toBeInTheDocument();
  });

  it('마운트 시 팀 스레드를 읽음 처리한다', () => {
    render(<TeamThreadView rfpId="r1" workspaceId="w1" viewerUserId="u1" viewerAvatarUpdatedAt={null} messages={[]} />);
    expect(markTeamThreadReadAction).toHaveBeenCalledWith({ rfpId: 'r1' });
  });

  it('열려 있는 동안 동료 메시지가 오면 다시 읽음 처리한다', async () => {
    render(base({ viewerUserId: 'u-me' }));
    await waitFor(() => expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1));

    act(() =>
      channelOptions.onMessage?.({
        type: 'message',
        id: 'tm-live-read',
        body: '동료 메시지',
        authorUserId: 'u-mate',
        authorName: '이동료',
        createdAt: '2026-06-10T07:00:00.000Z',
      }),
    );

    await waitFor(() => expect(markTeamThreadReadAction).toHaveBeenCalledTimes(2));
  });

  it('위로 스크롤해 최신 메시지가 화면에 없으면 읽음 처리하지 않는다', async () => {
    render(base({ viewerUserId: 'u-me' }));
    await waitFor(() => expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1));

    act(() => scrollAwayFromBottom());
    act(() =>
      channelOptions.onMessage?.({
        type: 'message',
        id: 'tm-offscreen',
        body: '화면 밖 동료 메시지',
        authorUserId: 'u-mate',
        authorName: '이동료',
        createdAt: '2026-06-10T07:03:00.000Z',
      }),
    );

    expect(await screen.findByText('화면 밖 동료 메시지')).toBeInTheDocument();
    expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1);
  });

  it('아래로 다시 내려와 최신 메시지가 보이면 그때 읽음 처리한다', async () => {
    render(base({ viewerUserId: 'u-me' }));
    await waitFor(() => expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1));

    act(() => scrollAwayFromBottom());
    act(() =>
      channelOptions.onMessage?.({
        type: 'message',
        id: 'tm-catchup',
        body: '나중에 볼 동료 메시지',
        authorUserId: 'u-mate',
        authorName: '이동료',
        createdAt: '2026-06-10T07:04:00.000Z',
      }),
    );
    expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1);

    act(() => scrollBackToBottom());

    await waitFor(() => expect(markTeamThreadReadAction).toHaveBeenCalledTimes(2));
  });

  it('탭이 숨겨져 있으면 도착한 메시지로 읽음 처리하지 않는다', async () => {
    render(base({ viewerUserId: 'u-me' }));
    await waitFor(() => expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1));

    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      act(() =>
        channelOptions.onMessage?.({
          type: 'message',
          id: 'tm-live-hidden',
          body: '숨은 탭 동료 메시지',
          authorUserId: 'u-mate',
          authorName: '이동료',
          createdAt: '2026-06-10T07:01:00.000Z',
        }),
      );
      expect(await screen.findByText('숨은 탭 동료 메시지')).toBeInTheDocument();
      expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(document, 'visibilityState', original);
      else
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
    }
  });

  it('내 메시지 echo 로는 읽음 처리하지 않는다', async () => {
    render(base({ viewerUserId: 'u-me' }));
    await waitFor(() => expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1));

    act(() =>
      channelOptions.onMessage?.({
        type: 'message',
        id: 'tm-live-self',
        body: '내가 쓴 메모',
        authorUserId: 'u-me',
        authorName: '나',
        createdAt: '2026-06-10T07:02:00.000Z',
      }),
    );

    expect(await screen.findByText('내가 쓴 메모')).toBeInTheDocument();
    expect(markTeamThreadReadAction).toHaveBeenCalledTimes(1);
  });

  it('읽음 처리와 함께 그 스레드의 알림 배지를 로컬에서도 내린다', async () => {
    render(base());

    await waitFor(() =>
      expect(markThreadReadLocal).toHaveBeenCalledWith('/messages?t=rfp-1'),
    );
  });

  it('열려 있는 동안 그 팀 스레드를 열린 스레드로 등록한다(토스트 억제 근거)', () => {
    const { unmount } = render(base());
    expect(isThreadOpen('/messages?t=rfp-1')).toBe(true);

    unmount();
    expect(isThreadOpen('/messages?t=rfp-1')).toBe(false);
  });

  it('컴포저는 좁은 레일에서 placeholder 가 두 줄로 잘리지 않도록 min-w-0 슬롯과 한 줄 placeholder 를 쓴다', () => {
    render(base({ messages: [] }));
    const ta = screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…');
    expect(ta.parentElement).toHaveClass('min-w-0');
    expect(ta).toHaveClass('placeholder:truncate');
    expect(ta).toHaveClass('box-border');
  });
});

describe('TeamThreadView — 전송', () => {
  it('전송 중 말풍선을 morph 오버레이 없이 목록에 직접 표시한다', async () => {
    const user = userEvent.setup();
    let resolveSend!: (v: unknown) => void;
    sendTeamMessageAction.mockReturnValue(new Promise((res) => { resolveSend = res; }));
    render(base());

    await user.type(screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…'), '즉시 표시 메모');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    const bubble = await screen.findByText('즉시 표시 메모');
    expect(bubble.closest('[data-message-row]')).toHaveAttribute('data-sender', 'self');
    expect(document.querySelector('[data-morph-bounds]')).toBeNull();

    await act(async () => {
      resolveSend({ ok: true, messageId: 'tm-new', createdAt: '2026-06-10T01:23:00.000Z' });
    });
  });

  it('보내기 클릭 시 sendTeamMessageAction({rfpId, body}) 호출 + 낙관적 말풍선 표시 후 확정 승격', async () => {
    const user = userEvent.setup();
    render(base());

    await user.type(
      screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…'),
      '새 팀 메모',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await screen.findByText('새 팀 메모');
    await waitFor(() => {
      expect(sendTeamMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          rfpId: 'rfp-1',
          body: '새 팀 메모',
          attachmentIds: [],
        }),
      );
    });
    // 확정 승격 — pending 표시가 사라진다.
    await waitFor(() => {
      const row = screen.getByText('새 팀 메모').closest('[data-message-row]')!;
      expect(row.querySelector('[aria-label="전송 중"]')).not.toBeInTheDocument();
    });
  });

  it('Enter 는 전송, Shift+Enter 는 줄바꿈이다', async () => {
    const user = userEvent.setup();
    render(base());
    const textarea = screen.getByPlaceholderText(
      '우리 팀에게만 보이는 메모를 남겨보세요…',
    );

    await user.type(textarea, '줄1{Shift>}{Enter}{/Shift}줄2');
    expect(sendTeamMessageAction).not.toHaveBeenCalled();

    await user.type(textarea, '{Enter}');
    await waitFor(() => {
      expect(sendTeamMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          rfpId: 'rfp-1',
          body: '줄1\n줄2',
          attachmentIds: [],
        }),
      );
    });
  });

  it('빈 본문이면 보내기 버튼이 비활성화된다', () => {
    render(base());
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();
  });

  it('한글 IME 조합 중 Enter 는 전송하지 않는다', async () => {
    const user = userEvent.setup();
    render(base());
    const ta = screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…');

    await user.type(ta, '한글입력');
    fireEvent.keyDown(ta, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(sendTeamMessageAction).not.toHaveBeenCalled();
  });

  it('확정 승격 시 서버 createdAt 을 채택한다 (클라이언트 시계 드리프트 방지)', async () => {
    sendTeamMessageAction.mockResolvedValue({
      ok: true,
      messageId: 'tm-new',
      createdAt: '2026-06-10T01:23:00.000Z',
    });
    const user = userEvent.setup();
    render(base());

    await user.type(
      screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…'),
      '시각 확인 메모',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await waitFor(() => {
      const row = screen.getByText('시각 확인 메모').closest('[data-message-row]')!;
      expect(
        within(row as HTMLElement).getByText(formatTime('2026-06-10T01:23:00.000Z')),
      ).toBeInTheDocument();
    });
  });

  it('전송 실패 시 말풍선을 걷어내고 입력을 복원하며 토스트를 띄운다', async () => {
    sendTeamMessageAction.mockResolvedValue({ ok: false, error: 'FORBIDDEN' });
    const user = userEvent.setup();
    render(base());

    const textarea = screen.getByPlaceholderText(
      '우리 팀에게만 보이는 메모를 남겨보세요…',
    );
    await user.type(textarea, '실패할 메모');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await waitFor(() => {
      expect(screen.queryByText('실패할 메모', { selector: '[data-message-row] *' })).not.toBeInTheDocument();
    });
    expect(textarea).toHaveValue('실패할 메모');
    expect(toast).toHaveBeenCalled();
  });
});

describe('TeamThreadView — 첨부', () => {
  it('파일 업로드 후 보내기 시 attachmentIds 를 함께 전송하고 버블에 첨부를 렌더한다', async () => {
    uploadAttachment.mockResolvedValue({ id: 'att-1', name: '제안서.pdf', size: 1234, mimeType: 'application/pdf' });
    sendTeamMessageAction.mockResolvedValue({
      ok: true,
      messageId: 'tm-att',
      createdAt: '2026-06-10T10:06:00.000Z',
      attachments: [
        { id: 'att-1', name: '제안서.pdf', size: 1234, mimeType: 'application/pdf', url: '/api/files/att-1' },
      ],
    });
    const user = userEvent.setup();
    const { container } = render(base());

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '제안서.pdf', { type: 'application/pdf' });
    await user.upload(input, file);
    await screen.findByLabelText('제안서.pdf 첨부 제거');

    // 업로드는 team_message 소유로, ownerId 는 rfpId 로 보낸다.
    expect(uploadAttachment).toHaveBeenCalledWith(expect.any(File), {
      ownerKind: 'team_message',
      ownerId: 'rfp-1',
    });

    await user.type(
      screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…'),
      '첨부 메모',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));

    await waitFor(() => {
      expect(sendTeamMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          rfpId: 'rfp-1',
          body: '첨부 메모',
          attachmentIds: ['att-1'],
        }),
      );
    });
    const link = await screen.findByRole('link', { name: /제안서.pdf/ });
    expect(link).toHaveAttribute('href', '/api/files/att-1');
  });

  it('본문이 비어도 첨부만 있으면 전송할 수 있다', async () => {
    uploadAttachment.mockResolvedValue({ id: 'att-2', name: '이미지.png', size: 500, mimeType: 'image/png' });
    const user = userEvent.setup();
    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '이미지.png', { type: 'image/png' });
    await user.upload(input, file);
    await screen.findByLabelText('이미지.png 첨부 제거');

    const sendBtn = screen.getByRole('button', { name: '보내기' });
    expect(sendBtn).toBeEnabled();
    await user.click(sendBtn);
    await waitFor(() => {
      expect(sendTeamMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          rfpId: 'rfp-1',
          body: '',
          attachmentIds: ['att-2'],
        }),
      );
    });
  });

  it('첨부가 있는 메시지는 버블에 첨부 링크를 렌더한다', () => {
    const withAtt: TeamThreadMessage[] = [
      {
        id: 'a1',
        authorUserId: 'u-mate',
        authorName: '이동료',
        authorAvatarUpdatedAt: null,
        body: '파일 봐주세요',
        createdAt: '2026-06-10T05:00:00.000Z',
        isSelf: false,
        attachments: [
          { id: 'att-x', name: '명세.pdf', size: 100, mimeType: 'application/pdf', url: '/api/files/att-x' },
        ],
      },
    ];
    render(base({ messages: withAtt }));
    const link = screen.getByRole('link', { name: /명세.pdf/ });
    expect(link).toHaveAttribute('href', '/api/files/att-x');
  });

  it('라이브 onMessage 의 attachments 를 버블에 렌더한다', async () => {
    render(base());
    act(() =>
      channelOptions.onMessage?.({
        type: 'message',
        id: 'tm-live-att',
        body: '라이브 첨부',
        authorUserId: 'u-mate',
        authorName: '이동료',
        createdAt: '2026-06-10T06:00:00.000Z',
        attachments: [
          { id: 'att-live', name: '회의록.pdf', size: 200, mimeType: 'application/pdf', url: '/api/files/att-live' },
        ],
      }),
    );
    await screen.findByText('라이브 첨부');
    const link = screen.getByRole('link', { name: /회의록.pdf/ });
    expect(link).toHaveAttribute('href', '/api/files/att-live');
  });
});

describe('TeamThreadView — 첨부 검증·에러', () => {
  it('지원하지 않는 파일 형식 선택 시 에러 칩이 노출된다', async () => {
    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '보고서.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(await screen.findByLabelText('보고서.docx 업로드 실패')).toBeInTheDocument();
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('MAX_BYTES 초과 파일은 칩에 추가되지 않는다(silent skip)', async () => {
    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const oversized = new File([new Uint8Array(1)], '큰파일.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 21 * 1024 * 1024 });
    Object.defineProperty(input, 'files', { value: [oversized], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(screen.queryByLabelText('큰파일.pdf 업로드 중')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('큰파일.pdf 업로드 실패')).not.toBeInTheDocument();
    });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it('업로드 중에는 스켈레톤 칩 + 전송 잠금, 완료되면 일반 칩으로 바뀐다', async () => {
    const user = userEvent.setup();
    let resolveUpload: ((v: unknown) => void) | null = null;
    uploadAttachment.mockReturnValue(new Promise((res) => { resolveUpload = res; }));
    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '제안서.pdf', { type: 'application/pdf' });
    await user.upload(input, file);

    expect(screen.getByLabelText('제안서.pdf 업로드 중')).toBeInTheDocument();
    expect(screen.queryByLabelText('제안서.pdf 첨부 제거')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled();

    await act(async () => {
      resolveUpload?.({ id: 'att-1', name: '제안서.pdf', size: 1234, mimeType: 'application/pdf' });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('제안서.pdf 첨부 제거')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('제안서.pdf 업로드 중')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '보내기' })).not.toBeDisabled();
  });

  it('업로드 실패 시 에러 칩으로 전환되고 토스트는 띄우지 않으며, 제거할 수 있다', async () => {
    const user = userEvent.setup();
    uploadAttachment.mockRejectedValue(new Error('upload failed'));
    const { container } = render(base());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], '실패.pdf', { type: 'application/pdf' });
    await user.upload(input, file);

    await screen.findByLabelText('실패.pdf 업로드 실패');
    expect(toast).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('실패.pdf 첨부 제거'));
    await waitFor(() =>
      expect(screen.queryByLabelText('실패.pdf 업로드 실패')).not.toBeInTheDocument(),
    );
  });
});

describe('TeamThreadView — 라이브 수신', () => {
  it('onMessage 수신 시 메시지를 append 하고 같은 id 는 중복 append 하지 않는다', async () => {
    render(base());

    const evt = {
      type: 'message',
      id: 'tm-live',
      body: '라이브 팀 메모',
      authorUserId: 'u-mate',
      authorName: '이동료',
      createdAt: '2026-06-10T06:00:00.000Z',
    };
    act(() => channelOptions.onMessage?.(evt));
    await screen.findByText('라이브 팀 메모');

    act(() => channelOptions.onMessage?.(evt));
    expect(screen.getAllByText('라이브 팀 메모')).toHaveLength(1);
  });

  it('본인 echo 가 액션 응답보다 먼저 오면 pending 말풍선을 승격한다 (중복 없음)', async () => {
    // 액션 응답을 보류해 echo-first 레이스를 강제한다.
    let resolveSend!: (v: unknown) => void;
    sendTeamMessageAction.mockImplementation(
      () => new Promise((res) => (resolveSend = res)),
    );
    const user = userEvent.setup();
    render(base());

    await user.type(
      screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…'),
      '레이스 메모',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await screen.findByText('레이스 메모'); // pending 상태

    // echo 선착 — pending 이 실제 id 로 승격돼야 한다 (append 아님).
    act(() =>
      channelOptions.onMessage?.({
        type: 'message',
        id: 'tm-echo',
        body: '레이스 메모',
        authorUserId: 'u-me',
        authorName: '김구매',
        createdAt: '2026-06-10T07:00:00.000Z',
      }),
    );
    expect(screen.getAllByText('레이스 메모')).toHaveLength(1);

    // 액션이 늦게 같은 id 로 응답 — temp 행은 이미 승격됐으므로 중복이 생기면 안 된다.
    await act(async () => {
      resolveSend({ ok: true, messageId: 'tm-echo', createdAt: '2026-06-10T07:00:00.000Z' });
    });
    expect(screen.getAllByText('레이스 메모')).toHaveLength(1);
    const row = screen.getByText('레이스 메모').closest('[data-message-row]')!;
    expect(row.querySelector('[aria-label="전송 중"]')).not.toBeInTheDocument();
  });

  it('타인 echo 는 pending 을 건드리지 않고 append 된다', async () => {
    let resolveSend!: (v: unknown) => void;
    sendTeamMessageAction.mockImplementation(
      () => new Promise((res) => (resolveSend = res)),
    );
    const user = userEvent.setup();
    render(base());

    await user.type(
      screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…'),
      '내 메모',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await screen.findByText('내 메모');

    act(() =>
      channelOptions.onMessage?.({
        type: 'message',
        id: 'tm-other',
        body: '동료 메모',
        authorUserId: 'u-mate',
        authorName: '이동료',
        createdAt: '2026-06-10T07:00:00.000Z',
      }),
    );
    // 동료 메시지가 append 됐고 내 pending 은 그대로 살아 있다.
    expect(screen.getByText('동료 메모')).toBeInTheDocument();
    const myRow = screen.getByText('내 메모').closest('[data-message-row]')!;
    expect(myRow.querySelector('[aria-label="전송 중"]')).toBeInTheDocument();

    await act(async () => {
      resolveSend({ ok: true, messageId: 'tm-mine', createdAt: '2026-06-10T07:01:00.000Z' });
    });
  });
});

describe('TeamThreadView — 스크롤', () => {
  function setScrolledUp(list: HTMLElement) {
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
    list.scrollTop = 0; // diff = 700 > 임계값 → 하단 아님
  }

  it('위로 올려둔 상태에서 팀원 라이브 메시지가 와도 하단으로 끌려가지 않는다', async () => {
    const { container } = render(base());
    const list = container.querySelector('[data-message-list]') as HTMLElement;
    setScrolledUp(list);
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {});

    act(() =>
      channelOptions.onMessage?.({
        type: 'message',
        id: 'tm-yank',
        body: '읽는 중 끼어든 메모',
        authorUserId: 'u-mate',
        authorName: '이동료',
        createdAt: '2026-06-10T06:00:00.000Z',
      }),
    );
    await screen.findByText('읽는 중 끼어든 메모');
    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('본인 전송은 위로 올려둔 상태여도 하단으로 따라간다', async () => {
    const user = userEvent.setup();
    const { container } = render(base());
    const list = container.querySelector('[data-message-list]') as HTMLElement;
    setScrolledUp(list);
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {});

    await user.type(
      screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…'),
      '내가 보낸 메모',
    );
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await screen.findByText('내가 보낸 메모');
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });
});

describe('TeamThreadView — 그룹핑', () => {
  it('같은 작성자의 5분 이내 연속 메시지는 작성자 헤더를 생략한다', () => {
    const grouped: TeamThreadMessage[] = [
      {
        id: 'g1',
        authorUserId: 'u-mate',
        authorName: '이동료',
        authorAvatarUpdatedAt: null,
        body: '첫 메시지',
        createdAt: '2026-06-10T05:00:00.000Z',
        isSelf: false,
        attachments: [],
      },
      {
        id: 'g2',
        authorUserId: 'u-mate',
        authorName: '이동료',
        authorAvatarUpdatedAt: null,
        body: '바로 이어진 메시지',
        createdAt: '2026-06-10T05:02:00.000Z', // 2분 뒤 — 그룹핑
        isSelf: false,
        attachments: [],
      },
      {
        id: 'g3',
        authorUserId: 'u-mate',
        authorName: '이동료',
        authorAvatarUpdatedAt: null,
        body: '한참 뒤 메시지',
        createdAt: '2026-06-10T05:30:00.000Z', // 28분 뒤 — 새 그룹
        isSelf: false,
        attachments: [],
      },
    ];
    render(base({ messages: grouped }));

    // 헤더(이름)는 그룹 시작에만 — 1·3번째 메시지에서 두 번.
    expect(screen.getAllByText('이동료')).toHaveLength(2);
  });
});

describe('TeamThreadView — 멘션', () => {
  // parseMentions 는 UUID 형식 토큰만 인식한다(team-mentions.ts MENTION_SOURCE).
  // 멘션 시나리오는 실제로 토큰화/파싱이 동작하는 UUID id 를 써야 한다.
  const MATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const mentionMembers = [
    { userId: MATE, name: '이동료', joinedAt: '2026-03-14T00:00:00.000Z', avatarUpdatedAt: null },
    { userId: ME, name: '김구매', joinedAt: '2026-04-01T00:00:00.000Z', avatarUpdatedAt: null },
  ];

  it('@ 입력 시 멤버 드롭다운이 뜨고, 선택하면 @이름 이 삽입된다', async () => {
    const user = userEvent.setup();
    render(base({ teamMembers: mentionMembers, viewerUserId: ME }));
    const ta = screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…');
    await user.type(ta, '@이');
    // 드롭다운 옵션에 '이동료'.
    const option = await screen.findByRole('option', { name: /이동료/ });
    await user.click(option);
    expect((ta as HTMLTextAreaElement).value).toContain('@이동료');
  });

  it('멘션 선택 후 전송하면 body 에 토큰이 들어간다', async () => {
    const user = userEvent.setup();
    render(base({ teamMembers: mentionMembers, viewerUserId: ME }));
    const ta = screen.getByPlaceholderText('우리 팀에게만 보이는 메모를 남겨보세요…');
    await user.type(ta, '@이');
    await user.click(await screen.findByRole('option', { name: /이동료/ }));
    await user.type(ta, '확인');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await waitFor(() => {
      expect(sendTeamMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          rfpId: 'rfp-1',
          body: `<@${MATE}> 확인`,
          attachmentIds: [],
        }),
      );
    });
  });

  it('수신된 멘션 메시지를 @이름 으로 강조 렌더한다', () => {
    render(
      base({
        teamMembers: mentionMembers,
        viewerUserId: ME,
        messages: [
          {
            id: 'tmM', authorUserId: MATE, authorName: '이동료',
            authorAvatarUpdatedAt: null,
            body: `<@${ME}> 봐주세요`, createdAt: '2026-06-10T05:00:00.000Z',
            isSelf: false, attachments: [],
          },
        ],
      }),
    );
    // 본인(ME) 멘션 → 강조 span.
    const el = screen.getByText('@김구매');
    expect(el).toHaveAttribute('data-self-mention', 'true');
  });
});
