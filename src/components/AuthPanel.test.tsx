import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPanel } from './AuthPanel'

const { beginSsoLogin } = vi.hoisted(() => ({
  beginSsoLogin: vi.fn(),
}))

vi.mock('../lib/auth', () => ({ beginSsoLogin }))

describe('AuthPanel', () => {
  beforeEach(() => beginSsoLogin.mockReset())
  afterEach(cleanup)

  it('offers only the configured common SSO providers', () => {
    render(<AuthPanel configured />)

    expect(screen.getByRole('button', { name: 'Google로 계속' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '카카오로 계속' })).toBeTruthy()
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
  })

  it('starts the selected SSO provider', async () => {
    beginSsoLogin.mockResolvedValue(undefined)
    render(<AuthPanel configured />)

    fireEvent.click(screen.getByRole('button', { name: 'Google로 계속' }))

    await waitFor(() => expect(beginSsoLogin).toHaveBeenCalledWith('google'))
  })

  it('does not expose login actions when DB1 is not configured', () => {
    render(<AuthPanel configured={false} />)

    expect(screen.getByRole('alert').textContent).toContain('배포 설정이 필요합니다.')
    expect(screen.queryByRole('button', { name: 'Google로 계속' })).toBeNull()
  })
})
