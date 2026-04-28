import { UseFormReturn } from "react-hook-form";

export type ValidGroup = "security" | "email" | "general" | "storage";

export type GroupFormData = {
  configs: Record<string, string>;
};

// biome-ignore lint/suspicious/noExplicitAny: react-hook-form uses `any` as default context generic
// biome-ignore lint/suspicious/noExplicitAny: third generic left as FieldValues to match useForm inference
type GroupForm = UseFormReturn<GroupFormData, any, any>;

export interface SettingsFormProps {
  groupedConfigs: Record<string, Config[]>;
  collapsedGroups: Record<string, boolean>;
  groupForms: Record<ValidGroup, GroupForm>;
  onGroupSubmit: (group: ValidGroup, data: GroupFormData) => Promise<void>;
  onToggleCollapse: (group: ValidGroup) => void;
}

export interface SettingsGroupProps {
  group: string;
  configs: Config[];
  form: GroupForm;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSubmit: (data: GroupFormData) => Promise<void>;
}

export interface ConfigInputProps {
  config: Config;
  register: GroupForm["register"];
  setValue: GroupForm["setValue"];
  error?: string;
  smtpEnabled?: string;
}

export type ConfigType = "text" | "number" | "boolean" | "bigint";

export type Config = {
  key: string;
  value: string;
  group: string;
  description?: string;
  type: ConfigType;
};
