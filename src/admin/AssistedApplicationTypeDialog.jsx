import React from 'react'

import { Button } from '@/components/ui/button'
import { useProducts } from '@/hooks/useProducts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Picks the loan product a customer is applying for; `onChoose` gets its id (the wizard reads its form from it). */
export function AssistedApplicationTypeDialog({ open, onOpenChange, onChoose }) {
  const products = useProducts()
  const choose = (productId) => {
    onOpenChange?.(false)
    onChoose(productId)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose an application type</DialogTitle>
          <DialogDescription>Select the loan product the customer wants to apply for.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {products.map((product) => (
            <Button key={product.id} variant="outline" onClick={() => choose(product.id)}>
              {product.name}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}