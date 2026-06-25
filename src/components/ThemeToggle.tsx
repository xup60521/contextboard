import { useThemeMode } from '../hooks/useThemeMode'
import { setThemeMode } from '../lib/theme'

export default function ThemeToggle() {
  const mode = useThemeMode()

  function toggleMode() {
    const nextMode =
      mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light'
    setThemeMode(nextMode)
  }

  const label =
    mode === 'auto'
      ? 'Theme mode: auto (system). Click to switch to light mode.'
      : `Theme mode: ${mode}. Click to switch mode.`

  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={label}
      title={label}
      className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
    >
      {mode === 'auto' ? 'Auto' : mode === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
