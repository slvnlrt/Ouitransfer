import type { AxiosResponse } from "axios";

export interface ConfigItem {
  key: string;
  value: string;
  type: string;
  group: string;
  updatedAt: string;
}

export interface ConfigUpdateItem {
  key: string;
  value: string;
}

export interface GetAllConfigs200 {
  configs: ConfigItem[];
}

export interface BulkUpdateConfigs200 {
  configs: ConfigItem[];
}

export type BulkUpdateConfigsBody = ConfigUpdateItem[];

export type GetAllConfigsResult = AxiosResponse<GetAllConfigs200>;
export type BulkUpdateConfigsResult = AxiosResponse<BulkUpdateConfigs200>;
