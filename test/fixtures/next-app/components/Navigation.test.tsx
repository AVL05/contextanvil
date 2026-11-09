import { render, screen } from '@testing-library/react'
import Navigation from './Navigation'

test('renders the main navigation landmark', () => {
  render(<Navigation />)
  expect(screen.getByRole('navigation')).toBeTruthy()
})
