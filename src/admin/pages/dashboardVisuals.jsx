import React from 'react'
import { Area, AreaChart, Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { cn } from '@/lib/utils'

/*
 * The dashboard's small graphics: donuts for a split of a whole, sparklines and mini bars
 * for a figure's days, and the welcome banner's illustration. Colours are theme tokens
 * (--viz-1..3 for identity, success/warning/destructive for state), so they follow the
 * brand and dark mode. A donut carries at most three colours: the theme's three pass the
 * colour-blind checks against each other, a fourth would not.
 */

const dayLabel = (day) => new Date(day).toLocaleDateString('en-ZM', { weekday: 'short', day: 'numeric', month: 'short' })

/** Every day of the period, oldest first, as YYYY-MM-DD: days with nothing still count. */
export const periodDays = (days) =>
  Array.from({ length: days }, (_, index) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - (days - 1 - index))
    return date.toISOString().slice(0, 10)
  })

function SmallTooltip({ active, payload, format, labelFor }) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="pointer-events-none rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lift">
      <p className="text-muted-foreground">{labelFor(entry)}</p>
      <p className="font-medium tabular-nums">{format(entry.value)}</p>
    </div>
  )
}

/**
 * A figure's days as a thin line (`kind` 'area' fills under it, 'line' does not) or as
 * bars ('bars'), with the day and value on hover. `data` is [{ day, value }]; a day with
 * no value (null) leaves a gap in a line.
 */
export function Sparkline({ data, kind = 'area', color = 'var(--viz-1)', format = (value) => value, label, className }) {
  // Each area its own gradient: several sparklines share a page.
  const fillId = `spark-${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const tooltip = <Tooltip cursor={kind === 'bars' ? { fill: 'hsl(var(--muted))' } : { stroke: 'hsl(var(--border))' }} content={<SmallTooltip format={format} labelFor={(entry) => dayLabel(entry.payload.day)} />} />
  return (
    <div className={cn('h-11', className)} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'bars' ? (
          <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap={data.length > 60 ? 0 : 1}>
            {tooltip}
            <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} minPointSize={0} />
          </BarChart>
        ) : kind === 'line' ? (
          <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
            {tooltip}
            <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 4, stroke: 'hsl(var(--card))', strokeWidth: 2 }} />
          </LineChart>
        ) : (
          <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {tooltip}
            <Area dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${fillId})`} isAnimationActive={false} activeDot={{ r: 4, stroke: 'hsl(var(--card))', strokeWidth: 2 }} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

/**
 * A whole split into at most three parts, as a ring with the parts named beside it
 * (`legend`), so colour is never the only way to tell them apart. `slices` is
 * [{ key, label, value, color }]; `center` is what the hole says.
 */
export function Donut({ slices, size = 72, center, format = (value) => value.toLocaleString(), legend = true, label, compact = false }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const shown = slices.filter((slice) => slice.value > 0)
  const thickness = Math.max(8, Math.round(size * 0.16))
  return (
    <div className={cn('flex items-center', compact ? 'gap-2.5' : 'gap-4')}>
      <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label || slices.map((slice) => `${slice.label}: ${format(slice.value)}`).join(', ')}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {total ? (
              <Pie
                data={shown}
                dataKey="value"
                nameKey="label"
                innerRadius={size / 2 - thickness}
                outerRadius={size / 2}
                startAngle={90}
                endAngle={-270}
                paddingAngle={shown.length > 1 ? 3 : 0}
                cornerRadius={2}
                stroke="hsl(var(--card))"
                strokeWidth={1}
                isAnimationActive={false}
              >
                {shown.map((slice) => (
                  <Cell key={slice.key} fill={slice.color} />
                ))}
              </Pie>
            ) : (
              // Nothing yet: an empty ring, not a missing chart.
              <Pie data={[{ value: 1 }]} dataKey="value" innerRadius={size / 2 - thickness} outerRadius={size / 2} fill="hsl(var(--muted))" stroke="none" isAnimationActive={false} />
            )}
            {total ? <Tooltip content={<SmallTooltip format={format} labelFor={(entry) => entry.name} />} /> : null}
          </PieChart>
        </ResponsiveContainer>
        {center ? <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-xs font-semibold tabular-nums text-foreground">{center}</div> : null}
      </div>
      {legend ? (
        <ul className="min-w-0 flex-1 space-y-1 text-xs">
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-start gap-1.5">
              <span className="mt-1 size-2 shrink-0 rounded-sm" style={{ background: slice.color }} aria-hidden="true" />
              <span className="min-w-0 leading-snug text-muted-foreground">{slice.label}</span>
              <span className={cn('ml-auto font-medium tabular-nums text-foreground', compact ? 'pl-1.5' : 'pl-2')}>{format(slice.value)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** A part of a whole as a thin meter, for a tile whose figure is a share of something (open cases). */
export function ShareMeter({ value, total, tone = 'primary', label }) {
  const share = total ? Math.min(1, value / total) : 0
  return (
    <div className="mt-3" role="img" aria-label={label}>
      <div className="h-1.5 rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', tone === 'alert' ? 'bg-brand' : 'bg-[var(--viz-1)]')}
          style={{ width: `${share * 100}%`, minWidth: value ? '4px' : 0 }}
        />
      </div>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">{total ? `${Math.round(share * 100)}% of ${total.toLocaleString()} open` : 'No open cases'}</p>
    </div>
  )
}

/**
 * The welcome banner's picture: a loan file, its chart and an approval stamp, drawn in the
 * theme's own colours (currentColor and tokens), so it follows the brand and dark mode.
 */
export function DashboardIllustration({ className }) {
  return (
    <svg viewBox="0 0 240 150" className={className} aria-hidden="true" focusable="false">
      {/* Soft circles behind */}
      <circle cx="170" cy="70" r="62" fill="currentColor" opacity="0.08" />
      <circle cx="206" cy="122" r="22" fill="currentColor" opacity="0.08" />
      {/* The file */}
      <g transform="rotate(-6 92 78)">
        <rect x="46" y="22" width="96" height="116" rx="10" fill="hsl(var(--card))" opacity="0.96" />
        <rect x="60" y="38" width="44" height="7" rx="3.5" fill="currentColor" opacity="0.55" />
        <rect x="60" y="52" width="66" height="5" rx="2.5" fill="currentColor" opacity="0.2" />
        <rect x="60" y="62" width="58" height="5" rx="2.5" fill="currentColor" opacity="0.2" />
        {/* Its chart */}
        <rect x="62" y="104" width="10" height="18" rx="2" fill="var(--viz-1)" />
        <rect x="78" y="94" width="10" height="28" rx="2" fill="var(--viz-3)" />
        <rect x="94" y="84" width="10" height="38" rx="2" fill="var(--viz-2)" />
        <rect x="110" y="76" width="10" height="46" rx="2" fill="var(--viz-1)" />
        <path d="M60 98 L78 90 L94 80 L118 68" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </g>
      {/* The approval stamp */}
      <g transform="translate(168 52)">
        <circle r="30" fill="hsl(var(--card))" />
        <circle r="24" fill="none" stroke="hsl(var(--success))" strokeWidth="3" />
        <path d="M-11 0 L-3 8 L12 -8" fill="none" stroke="hsl(var(--success))" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* A coin */}
      <g transform="translate(196 112)">
        <circle r="16" fill="hsl(var(--card))" />
        <text y="5" textAnchor="middle" fontSize="15" fontWeight="700" fill="hsl(var(--primary))">K</text>
      </g>
    </svg>
  )
}
