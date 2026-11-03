import React from 'react'
import { ArrowRight, CheckCircle2, Info } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { describeFee, describeInterest, formatKwacha, purposeOf } from '@/config/loanProducts'
import { productTags } from '@/config/eligibility'
import { asksForCollateral, describeRequirement } from '@/config/collateral'

function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

/**
 * One loan product: what it is for, how it classifies, its pricing and what it asks, and
 * — once the applicant has said what they earn — what it would lend them (`eligibility`,
 * src/config/eligibility.js). Only a product they qualify for can be started.
 */
export function LoanProductCard({ product, eligibility = { status: 'unknown' }, onApply }) {
  const eligible = eligibility.status === 'eligible'
  return (
    <Card className={cn('flex flex-col', eligible && 'border-primary/30 shadow-lift', eligibility.status === 'ineligible' && 'opacity-75')}>
      <CardHeader>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{purposeOf(product)?.label || 'General purpose'}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <CardTitle className="text-xl">{product.name}</CardTitle>
          {product.tagline ? <Badge variant={eligible ? 'default' : 'secondary'}>{product.tagline}</Badge> : null}
        </div>
        <CardDescription className="mt-2">{product.description}</CardDescription>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {productTags(product).map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        <p className="text-3xl font-bold tracking-tight text-foreground">
          {formatKwacha(product.minAmount)}
          <span className="mx-1.5 text-xl font-medium text-muted-foreground">–</span>
          {formatKwacha(product.maxAmount)}
        </p>

        <dl className="mt-5">
          <Fact label="Interest" value={describeInterest(product)} />
          <Fact label="Facility fee" value={describeFee(product)} />
          <Fact label="Tenure" value={`${product.minTenure} to ${product.maxTenure} months`} />
          <Fact label="Documents needed" value={`${product.documents.filter((document) => document.required).length}`} />
          {asksForCollateral(product) ? <Fact label="Collateral" value={describeRequirement(product)} /> : null}
        </dl>

        {eligible ? (
          <p className="mt-5 flex items-start gap-2 rounded-md bg-success/10 px-3 py-2.5 text-sm text-foreground">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>
              You qualify for up to <span className="font-semibold">{formatKwacha(eligibility.maxAmount)}</span>, repaying up to {formatKwacha(eligibility.budget)} a month.
            </span>
          </p>
        ) : eligibility.status === 'ineligible' ? (
          <p className="mt-5 flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{eligibility.reason}</span>
          </p>
        ) : null}
      </CardContent>

      <CardFooter>
        <Button className="w-full" variant={eligible ? 'default' : 'outline'} disabled={!eligible} onClick={() => onApply(product.id)}>
          {eligible ? `Start a ${product.name.toLowerCase()}` : eligibility.status === 'unknown' ? 'Enter your figures to apply' : 'Not available on these figures'}
          {eligible ? <ArrowRight /> : null}
        </Button>
      </CardFooter>
    </Card>
  )
}
