import React from 'react'
import { FileText } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionHeading } from '@/components/landing/SectionHeading'
import { LOAN_PRODUCTS } from '@/config/loanProducts'

export function Requirements() {
  return (
    <section id="requirements" className="border-b border-border py-20 lg:py-24">
      <div className="container">
        <SectionHeading
          eyebrow="What you need"
          title="Have these ready before you start"
          description="You can upload a clear photo or a scan — whatever is easiest. Documents attach to your draft, so you only ever upload them once."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {LOAN_PRODUCTS.map((product) => (
            <Card key={product.id}>
              <CardHeader>
                <CardTitle>{product.name}</CardTitle>
                <CardDescription>
                  {product.documents.length} supporting documents, plus your application details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2.5 sm:grid-cols-2">
                  {product.documents.map((document) => (
                    <li
                      key={document}
                      className="flex items-center gap-2.5 rounded-md bg-secondary/60 px-3 py-2.5 text-sm text-foreground"
                    >
                      <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>{document}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
