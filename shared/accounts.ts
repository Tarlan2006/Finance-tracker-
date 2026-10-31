export interface AccountView { id: string; login: string; displayName: string; mustChangePassword: boolean; hasSheet: boolean }
export interface AccountSession { token: string; account: AccountView; queueKey?: string }
export interface SessionView { id: string; device: string; createdAt: number; lastUsedAt: number; current: boolean }
