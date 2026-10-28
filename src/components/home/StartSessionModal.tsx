'use client'

import React from 'react'

export interface StartSessionModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  sessionType: string
  setSessionType: (val: string) => void
  sessionDate: string
  setSessionDate: (val: string) => void
  sessionTime: string
  setSessionTime: (val: string) => void
  startingSession: boolean
  sessionSuccess: string | null
  sessionError: string | null
}

export default function StartSessionModal({
  isOpen,
  onClose,
  onSubmit,
  sessionType,
  setSessionType,
  sessionDate,
  setSessionDate,
  sessionTime,
  setSessionTime,
  startingSession,
  sessionSuccess,
  sessionError,
}: StartSessionModalProps) {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      id="start-service-session-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1F2A24]/40 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-[460px] bg-[#FDFBF7] border border-[#6B4226]/20 rounded-[16px] p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#6B4226]/10">
          <h3 className="font-fraunces text-[20px] font-bold text-[#1F2A24]">
            Start New Service Session
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#1F2A24]/40 hover:text-[#1F2A24] p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <p className="text-[13px] text-[#1F2A24]/70">
          Starting a new service session automatically closes any previous active session. Ushers’
          attendance sheets will immediately bind to this session.
        </p>

        {sessionSuccess && (
          <div className="p-3 bg-[#4C6B52]/10 border border-[#4C6B52]/30 text-[#4C6B52] text-[13px] rounded-[8px]">
            {sessionSuccess}
          </div>
        )}

        {sessionError && (
          <div className="p-3 bg-[#C94F3D]/10 border border-[#C94F3D]/30 text-[#C94F3D] text-[13px] rounded-[8px]">
            {sessionError}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-[12.5px] font-semibold text-[#1F2A24]/80 mb-1">
              Service Title / Label
            </label>
            <input
              type="text"
              required
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value)}
              placeholder="e.g. Sunday Service, Midweek Service"
              className="w-full px-3 py-2 bg-[#F7F3EC] border border-[#6B4226]/25 rounded-[8px] text-[14px] text-[#1F2A24] outline-none focus:border-[#A8763E]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12.5px] font-semibold text-[#1F2A24]/80 mb-1">
                Service Date
              </label>
              <input
                type="date"
                required
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className="w-full px-3 py-2 bg-[#F7F3EC] border border-[#6B4226]/25 rounded-[8px] text-[14px] text-[#1F2A24] outline-none focus:border-[#A8763E]"
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-[#1F2A24]/80 mb-1">
                Start Time
              </label>
              <input
                type="time"
                required
                value={sessionTime}
                onChange={(e) => setSessionTime(e.target.value)}
                className="w-full px-3 py-2 bg-[#F7F3EC] border border-[#6B4226]/25 rounded-[8px] text-[14px] text-[#1F2A24] outline-none focus:border-[#A8763E]"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-[8px] text-[13px] text-[#1F2A24]/70 hover:bg-[#6B4226]/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="confirm-start-session-btn"
              disabled={startingSession}
              className="px-5 py-2 rounded-[8px] bg-[#A8763E] hover:bg-[#976835] text-[#FDFBF7] text-[13px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {startingSession ? 'Activating Session…' : 'Activate Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
