import type { UseFormReturn } from "react-hook-form";

export type ValidGroup = "security" | "email" | "general" | "storage" | "cleanup";

export type GroupFormData = {
  configs: Record<string, string>;
};

type GroupForm = UseFormReturn<GroupFormData, undefined, GroupFormData>;

export interface SettingsFormProps {
  groupedConfigs: Record<string, Config[]>;
  groupForms: Record<ValidGroup, GroupForm>;
  onGroupSubmit: (group: ValidGroup, data: GroupFormData) => Promise<void>;
}

export interface SettingsGroupProps {
  group: string;
  configs: Config[];
  form: GroupForm;
  onSubmit: (data: GroupFormData) => Promise<void>;
}

export type ConfigType = "text" | "number" | "boolean" | "bigint";

export type Config = {
  key: string;
  value: string;
  group: string;
  description?: string;
  type: ConfigType;
};
