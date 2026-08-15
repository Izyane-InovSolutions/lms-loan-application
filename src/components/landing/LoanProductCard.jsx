import React from 'react'
import { ArrowRight, Check } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { FACILITY_FEE, INTEREST_RATE, formatKwacha } from '@/config/loanProducts'

function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

export function LoanProductCard({ product, onApply, featured = false }) {
  return (
    <Card className={cn('flex flex-col', featured && 'border-primary/30 shadow-lift')}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xl">{product.name}</CardTitle>
          <Badge variant={featured ? 'default' : 'secondary'}>{product.tagline}</Badge>
        </div>
        <CardDescription className="mt-2">{product.description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        <p className="text-3xl font-bold tracking-tight text-foreground">
          {formatKwacha(product.minAmount)}
          <span className="mx-1.5 text-xl font-medium text-muted-foreground">–</span>
          {formatKwacha(product.maxAmount)}
        </p>

        <dl className="mt-5">
          <Fact label="Interest" value={`${INTEREST_RATE * 100}% flat`} />
          <Fact label="Facility fee" value={formatKwacha(FACILITY_FEE)} />
          <Fact label="Tenure" value="You choose, in months" />
          <Fact label="Documents needed" value={`${product.documents.length}`} />
        </dl>

        <ul className="mt-5 space-y-2">
          {product.steps.slice(0, 3).map((step) => (
            <li key={step} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>{step}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter>
        <Button
          className="w-full"
          variant={featured ? 'default' : 'outline'}
          onClick={() => onApply(product.id)}
        >
          Start a {product.name.toLowerCase()}
          <ArrowRight />
        </Button>
      </CardFooter>
    </Card>
  )
}
