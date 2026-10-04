import { createContext, useContext } from 'react'

export const JoinContext = createContext(null)

export function useRecruitment() {
  const context = useContext(JoinContext)
  if (!context) throw new Error('useRecruitment must be used inside RecruitmentProvider')
  return context
}
