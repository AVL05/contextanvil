import { formatTitle } from './format'

test('capitalises', () => {
  expect(formatTitle('home')).toBe('Home')
})
