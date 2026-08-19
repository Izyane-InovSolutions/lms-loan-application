import React from 'react'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Wizard progress. Completed steps are activated to jump back — the page already
 * exposes that via the overview's Edit buttons, so the stepper should not be the
 * one place the shortcut is missing.
 *
 * Below `md` the rail collapses to a labelled progress bar; five stacked labels
 * are unreadable on a phone.
 */
export function StepProgress({ steps, currentStep, onStepSelect }) {
  const progress = steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0

  return (
    <nav aria-label="Application progress">
      {/* Mobile */}
      <div className="md:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">{steps[currentStep]}</p>
          <p className="shrink-0 text-xs font-medium text-muted-foreground">
            Step {currentStep + 1} of {steps.length}
          </p>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={currentStep + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-label={`Step ${currentStep + 1} of ${steps.length}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Desktop */}
      <ol className="relative hidden md:grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        <div
          aria-hidden="true"
          className="absolute top-[1.125rem] h-0.5 bg-border"
          style={{ left: `${50 / steps.length}%`, right: `${50 / steps.length}%` }}
        />
        <div
          aria-hidden="true"
          className="absolute top-[1.125rem] h-0.5 bg-primary transition-all duration-500"
          style={{
            left: `${50 / steps.length}%`,
            width: `calc((100% - ${100 / steps.length}%) * ${progress / 100})`,
          }}
        />

        {steps.map((title, index) => {
          const isCompleted = currentStep > index
          const isActive = currentStep === index
          const canNavigate = isCompleted && typeof onStepSelect === 'function'

          const marker = (
            <>
              <span
                className={cn(
                  'grid size-9 place-items-center rounded-full border-2 text-sm font-semibold transition-colors',
                  isActive && 'border-primary bg-primary text-primary-foreground',
                  isCompleted && 'border-primary bg-primary text-primary-foreground',
                  !isActive && !isCompleted && 'border-border bg-background text-muted-foreground'
                )}
              >
                {isCompleted ? <Check className="size-4" aria-hidden="true" /> : index + 1}
              </span>
              <span
                className={cn(
                  'text-xs font-semibold leading-tight',
                  isActive ? 'text-primary' : isCompleted ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {title}
              </span>
            </>
          )

          return (
            <li key={title} className="relative flex justify-center">
              {canNavigate ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(index)}
                  className="group flex flex-col items-center gap-2 rounded-md px-2 pb-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {marker}
                  <span className="sr-only">Go back to {title}</span>
                </button>
              ) : (
                <div
                  className="flex flex-col items-center gap-2 px-2 pb-1 text-center"
                  aria-current={isActive ? 'step' : undefined}
                >
                  {marker}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
