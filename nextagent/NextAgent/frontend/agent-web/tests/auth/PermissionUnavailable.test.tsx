// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionUnavailable } from '../../src/features/auth/PermissionUnavailable.tsx';

afterEach(cleanup);

describe('PermissionUnavailable', () => {
  it('renders the title and description', () => {
    render(<PermissionUnavailable />);
    expect(screen.getByTestId('permission-unavailable')).toBeTruthy();
    expect(screen.getByText('权限不足')).toBeTruthy();
    expect(screen.getByText('请联系管理员为您的账号添加具备查看权限及写入权限的角色')).toBeTruthy();
  });
});
