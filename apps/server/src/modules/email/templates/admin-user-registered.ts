import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface AdminUserRegisteredData {
  userName: string;
  userEmail: string;
  registrationMethod: string;
}

export function renderAdminUserRegistered(
  data: AdminUserRegisteredData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("adminUserRegistered.subtitle"),
    body: t("adminUserRegistered.body", {
      userName: data.userName,
      userEmail: data.userEmail,
      registrationMethod: data.registrationMethod,
    }),
  };
}
