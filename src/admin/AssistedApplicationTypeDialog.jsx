import React from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function AssistedApplicationTypeDialog({ open, onOpenChange, onChoose }) {
  const choose = (loanType) => {
    onOpenChange?.(false)
    onChoose(loanType)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose an application type</DialogTitle>
          <DialogDescription>Select the loan product the customer wants to apply for.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={() => choose('personal')}>
            Personal loan
          </Button>
          <Button variant="outline" onClick={() => choose('business')}>
            Business loan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}