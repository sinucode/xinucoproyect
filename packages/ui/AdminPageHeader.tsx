import { ReactNode } from 'react'

interface AdminPageHeaderProps {
  title: string
  subtitle?: string
  actionButton?: ReactNode
  hasData?: boolean
}

export function AdminPageHeader({ title, subtitle, actionButton, hasData = true }: AdminPageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-60 flex-col">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-xinuco-text">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-xinuco-muted line-clamp-2 sm:line-clamp-none">
            {subtitle}
          </p>
        )}
      </div>

      {hasData && actionButton && (
        <div className="shrink-0">
          {actionButton}
        </div>
      )}
    </div>
  )
}
