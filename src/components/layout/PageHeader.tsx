import React from 'react'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  badge?: React.ReactNode
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 sm:mb-8 pb-4 border-b border-[#6B4226]/12 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
      <div>
        <h1 className="font-fraunces text-[26px] sm:text-[30px] font-bold text-[#1F2A24] tracking-tight leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13.5px] sm:text-[14.5px] text-[#1F2A24]/65 font-work-sans mt-1">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
    </header>
  )
}
