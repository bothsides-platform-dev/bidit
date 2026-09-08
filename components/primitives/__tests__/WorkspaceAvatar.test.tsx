import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

import { WorkspaceAvatar } from '../WorkspaceAvatar';

afterEach(() => {
  cleanup();
});

describe('WorkspaceAvatar', () => {
  it('renders initials when logoUpdatedAt is null', () => {
    render(<WorkspaceAvatar name="서포트 B" workspaceId="ws-1" logoUpdatedAt={null} />);
    expect(screen.getByRole('img')).toHaveTextContent('B');
  });

  it('renders initials when there is no workspaceId', () => {
    render(<WorkspaceAvatar name="Acme Corp" logoUpdatedAt={null} />);
    expect(screen.getByRole('img')).toHaveTextContent('A');
  });

  it('renders img element when logoUpdatedAt is set and workspaceId is provided', () => {
    render(<WorkspaceAvatar name="서포트 B" workspaceId="ws-123" logoUpdatedAt="2026-06-21T00:00:00.000Z" />);
    const img = screen.getByRole('img');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', `/api/workspace/ws-123/avatar?v=${Date.parse('2026-06-21T00:00:00.000Z')}`);
    expect(img).toHaveAttribute('alt', '서포트 B');
  });

  it('falls back to initials when img onError fires', () => {
    render(<WorkspaceAvatar name="서포트 B" workspaceId="ws-123" logoUpdatedAt="2026-06-21T00:00:00.000Z" />);
    const img = screen.getByRole('img');
    expect(img.tagName).toBe('IMG');

    fireEvent.error(img);

    // After error, initials should be shown instead
    const fallback = screen.getByRole('img');
    expect(fallback.tagName).not.toBe('IMG');
    expect(fallback).toHaveTextContent('B');
  });

  it('renders img with ?v cache-bust when logoUpdatedAt is set', () => {
    render(<WorkspaceAvatar name="서포트 B" workspaceId="ws-9" logoUpdatedAt="2026-06-21T00:00:00.000Z" />);
    const img = screen.getByRole('img');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', `/api/workspace/ws-9/avatar?v=${Date.parse('2026-06-21T00:00:00.000Z')}`);
  });

  it('renders initials when logoUpdatedAt is null', () => {
    render(<WorkspaceAvatar name="Acme" workspaceId="ws-9" logoUpdatedAt={null} />);
    const el = screen.getByRole('img');
    expect(el.tagName).not.toBe('IMG');
  });

  it('re-renders img after logoUpdatedAt changes following an error fallback', () => {
    const { rerender } = render(<WorkspaceAvatar name="Acme" workspaceId="ws-9" logoUpdatedAt="2026-06-21T00:00:00.000Z" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img').tagName).not.toBe('IMG');
    rerender(<WorkspaceAvatar name="Acme" workspaceId="ws-9" logoUpdatedAt="2026-06-22T00:00:00.000Z" />);
    const img = screen.getByRole('img');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', `/api/workspace/ws-9/avatar?v=${Date.parse('2026-06-22T00:00:00.000Z')}`);
  });
});
