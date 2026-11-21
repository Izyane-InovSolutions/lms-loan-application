import React from 'react'
import { Camera, FileText, IdCard, Smartphone } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionHeading } from '@/components/landing/SectionHeading'
import { useProductCatalog } from '@/hooks/useProducts'

// What every application asks for, whichever loan it is.
const BASICS = [
  { icon: IdCard, label: 'Your NRC or passport' },
  { icon: Smartphone, label: 'An email address or mobile number you can receive a code on' },
  { icon: Camera, label: 'A phone or laptop with a camera, for your photo' },
]

/**
 * "What you need": the basics, then the documents of each loan of the type chosen in the
 * loan finder (`loanType`), so the list stays short as the catalogue grows.
 */
export function Requirements({ loanType }) {
  const { products: all, loanTypes } = useProductCatalog()
  const chosen = all.filter((product) => product.loanType === loanType)
  const products = chosen.length ? chosen : all
  const typeLabel = chosen.length ? loanTypes.find((type) => type.key === loanType)?.label : null

  return (
    <section id="requirements" className="scroll-mt-16 border-b border-border py-20 lg:py-24">
      <div className="container">
        <SectionHeading
          eyebrow="What you need"
          title="Have these ready before you start"
          description="You can upload a clear photo or a scan — whatever is easiest. Documents attach to your draft, so you only ever upload them once."
        />

        <ul className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
          {BASICS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-start gap-3 rounded-lg border bg-card p-4 text-sm text-foreground shadow-soft">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <span>{label}</span>
            </li>
          ))}
        </ul>

        {typeLabel ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Documents for <span className="font-semibold text-foreground">{typeLabel.toLowerCase()}</span> — change the type in{' '}
            <a href="#loans" className="font-medium text-primary underline-offset-4 hover:underline">
              Our loans
            </a>{' '}
            to see others.
          </p>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {products.map((product) => (
            <Card key={product.id}>
              <CardHeader>
                <CardTitle>{product.name}</CardTitle>
                <CardDescription>
                  {product.documents.length
                    ? `${product.documents.length} supporting ${product.documents.length === 1 ? 'document' : 'documents'}, plus your application details.`
                    : 'Just your application details.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2.5 sm:grid-cols-2">
                  {product.documents.map((document) => (
                    <li
                      key={document.slot}
                      className="flex items-center gap-2.5 rounded-md bg-secondary/60 px-3 py-2.5 text-sm text-foreground"
                    >
                      <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>
                        {document.label}
                        {document.required ? null : <span className="text-muted-foreground"> (optional)</span>}
                      </span>
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
