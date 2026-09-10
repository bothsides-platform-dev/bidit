/**
 * 통합 알림 팬아웃. 수신자마다 channels 에 따라 in-app row insert(dispatchNotification)
 * 와 email outbox enqueue 를 tx 안에서 수행하고, 생성한 in-app Notification[] 을
 * 반환한다. 호출자는 반환값을 pendingEmits 에 모아 commit 후 emitAfterCommit 한다.
 *
 * 채널은 호출 단위로 모든 recipient 에 적용된다. 수신자별 채널 차이나 채널별
 * 수신자 집합 차이는 notify() 를 여러 번 호출해 표현한다.
 */
import { randomUUID } from 'node:crypto';
import { getOutboxRepo } from '@/lib/server/repositories/factory';
import { dispatchNotifications } from './dispatch';
import type { Notification } from '@/lib/types/notification';
import type { Tx } from '@/lib/server/repositories/types';
import type { OutboxEvent } from '@/lib/server/outbox/types';

export type NotifyChannel = 'inapp' | 'email';

export type NotifyRecipient = {
  userId: string;
  workspaceId: string | null;
  email: string;
};

export type NotifyEmail = {
  event: OutboxEvent;
  subject: string;
  html: string;
  /**
   * 수신자로부터 파생. 생략 시 dedupeKey 없음.
   *
   * ⚠️ **수신자마다 다른 키를 내야 한다.** 전원이 같은 키를 내면 outbox 의
   * dedupe UNIQUE 에 걸려 1건만 저장되고 나머지 이메일이 조용히 유실된다.
   * 인자로 `NotifyRecipient` 전체를 받으므로 email 이 아닌 userId 기반 키도
   * `(r) => \`...:${r.userId}\`` 로 표현된다 — 예전 `(email) => string` 시그니처
   * 시절에는 이게 불가능해 호출부가 수신자 1명씩 루프를 돌아야 했다.
   * (중복 억제가 목적이라 의도적으로 상수 키를 주는 것은 여전히 유효하다.)
   */
  dedupeKey?: (recipient: NotifyRecipient) => string;
  /** digest 코얼레싱용 미래 시각. 생략 시 즉시 발송. */
  scheduledAt?: Date;
};

export type NotifyInput = {
  recipients: NotifyRecipient[];
  channels: NotifyChannel[];
  type: string;
  title: string;
  body: string;
  /** 사건의 서버 권위 시각. 생략하면 알림 생성 시각을 쓴다. */
  createdAt?: Date;
  /**
   * 문자열이면 전원 동일. 함수면 수신자별로 파생한다 — 같은 사건이라도 링크가
   * 역할별로 갈리는 경우(구매사 `/rfp/{code}` vs PG `/inbox/{code}`)를 위해서다.
   * 이것 역시 예전에는 표현할 수 없어 호출부가 수신자 1명씩 루프를 돌았다.
   */
  linkUrl?: string | ((recipient: NotifyRecipient) => string);
  email?: NotifyEmail;
};

/**
 * `dedupeKey` 가 `(email: string) => …` 에서 `(recipient) => …` 로 넓어졌을 때,
 * 고치지 않은 옛 호출부는 **컴파일을 통과한다** — 파라미터 이름은 타입이 아니라
 * `(email) => \`k:${email}\`` 가 그대로 살아남는다. 그러면 키가
 * `k:[object Object]` 로 굳고 전원이 같은 값을 내, outbox dedupe UNIQUE 에 걸려
 * 첫 1명 외에는 메일이 조용히 사라진다. 타입이 못 막으니 여기서 막는다.
 */
function assertUsableDedupeKey(key: string): string {
  if (key.includes('[object Object]')) {
    throw new Error(
      `notify: dedupeKey 가 수신자 객체를 문자열로 넣었습니다(${key}). ` +
        '`(r) => `...${r.email}`` 처럼 필드를 지정하세요.',
    );
  }
  return key;
}

export async function notify(tx: Tx, input: NotifyInput): Promise<Notification[]> {
  const wantInapp = input.channels.includes('inapp');
  const wantEmail = input.channels.includes('email');
  if (wantEmail && !input.email) {
    throw new Error('notify: channels includes "email" but no email payload was provided');
  }

  const created: Notification[] = [];
  const linkUrlFor = (r: NotifyRecipient): string | undefined =>
    typeof input.linkUrl === 'function' ? input.linkUrl(r) : input.linkUrl;

  // 채널당 한 문장씩. 예전에는 수신자마다 INSERT 를 돌아 트랜잭션이 수신자
  // 수만큼 길어졌다.
  if (wantInapp) {
    for (const r of input.recipients) {
      const link = linkUrlFor(r);
      created.push({
        id: randomUUID(),
        userId: r.userId,
        workspaceId: r.workspaceId,
        type: input.type,
        title: input.title,
        body: input.body,
        channel: 'inapp',
        status: 'pending',
        ...(link ? { linkUrl: link } : {}),
        createdAt: (input.createdAt ?? new Date()).toISOString(),
      });
    }
    await dispatchNotifications(tx, created);
  }

  if (wantEmail && input.email && input.recipients.length > 0) {
    const email = input.email;
    const outbox = await getOutboxRepo();
    await outbox.enqueueMany(
      input.recipients.map((r) => ({
        event: email.event,
        to: r.email,
        subject: email.subject,
        html: email.html,
        ...(email.dedupeKey ? { dedupeKey: assertUsableDedupeKey(email.dedupeKey(r)) } : {}),
        ...(email.scheduledAt ? { scheduledAt: email.scheduledAt } : {}),
      })),
      tx,
    );
  }

  return created;
}
