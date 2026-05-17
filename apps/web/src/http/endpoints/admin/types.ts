import type { AxiosResponse } from "axios";

export interface AdminStats200 {
  users: { total: number; active: number };
  files: { total: number };
  shares: { active: number; expired: number };
  reverseShares: { active: number };
}

export type AdminStatsResult = AxiosResponse<AdminStats200>;
