import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

const referenceSource = '/contextboard_logo.png'
const svgSource = '/contextboard_logo.svg'

export const Route = createFileRoute('/test/logo')({
  component: RouteComponent,
})

function RouteComponent() {
  const [stackedOpacity, setStackedOpacity] = useState(0.5)
  const [differenceMode, setDifferenceMode] = useState(false)

  return (
    <main className="min-h-full w-full bg-[#f4f7fb] p-6 text-[#3e495b]">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[1400px] flex-col justify-center gap-5">
        <header className="flex items-end justify-between border-b border-[#d9e1ec] pb-4">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#718096]">Logo comparison</p>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Raster reference vs. SVG recreation</h1>
          </div>
          <p className="text-xs text-[#718096]">Smooth vector overlay · 1024 x 1024 viewBox</p>
        </header>

        <section className="overflow-hidden rounded-[24px] border border-[#d9e1ec] bg-white p-4 shadow-[0_16px_40px_rgba(62,73,91,0.08)]">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Stacked alignment check</h2>
              <p className="mt-1 text-xs text-[#718096]">Both assets share the same 1024 x 1024 box. Use difference mode to expose doubled edges.</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-[#718096]">
              <label className="flex items-center gap-2">
                <span>SVG opacity</span>
                <input
                  aria-label="SVG overlay opacity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={stackedOpacity}
                  onChange={(event) => setStackedOpacity(Number(event.target.value))}
                  className="accent-[#3e91f6]"
                />
                <span className="w-8 font-mono text-[10px]">{Math.round(stackedOpacity * 100)}%</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setDifferenceMode((current) => !current)
                  setStackedOpacity(differenceMode ? 0.5 : 1)
                }}
                className="rounded-full border border-[#cbd6e4] px-3 py-1.5 font-medium text-[#3e495b] transition-colors hover:border-[#3e91f6] hover:text-[#2f7ee9]"
              >
                {differenceMode ? 'Normal blend' : 'Difference mode'}
              </button>
            </div>
          </div>

          <div className="relative mx-auto aspect-square w-full max-w-[500px] overflow-hidden rounded-[16px] bg-white">
            <img src={referenceSource} alt="" className="absolute inset-0 block h-full w-full object-contain" />
            <img
              src={svgSource}
              alt=""
              className="absolute inset-0 block h-full w-full object-contain"
              style={{ opacity: stackedOpacity, mixBlendMode: differenceMode ? 'difference' : 'normal' }}
            />
          </div>
        </section>
      </div>
    </main>
  )
}
