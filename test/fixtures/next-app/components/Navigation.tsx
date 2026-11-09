import Link from 'next/link'

export default function Navigation() {
  return (
    <nav aria-label="Main">
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
    </nav>
  )
}
