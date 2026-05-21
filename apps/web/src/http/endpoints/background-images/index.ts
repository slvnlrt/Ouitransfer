import type { AxiosRequestConfig } from "axios";

import apiInstance from "@/config/api";
import type {
  DeleteBackgroundImageResult,
  ListBackgroundImagesResult,
  ReorderBackgroundImagesResult,
  UpdateBackgroundImageResult,
  UploadBackgroundImageResult,
} from "./types";

export const listBackgroundImages = (
  options?: AxiosRequestConfig,
): Promise<ListBackgroundImagesResult> => {
  return apiInstance.get("/api/background-images", options);
};

export const uploadBackgroundImage = (
  file: File,
  name?: string,
  options?: AxiosRequestConfig,
): Promise<UploadBackgroundImageResult> => {
  const formData = new FormData();
  if (name) {
    formData.append("name", name);
  }
  formData.append("file", file);

  return apiInstance.post("/api/background-images/upload", formData, {
    ...options,
    headers: {
      ...options?.headers,
      "Content-Type": "multipart/form-data",
    },
  });
};

export const updateBackgroundImage = (
  id: string,
  data: { name?: string },
  options?: AxiosRequestConfig,
): Promise<UpdateBackgroundImageResult> => {
  return apiInstance.patch(`/api/background-images/${id}`, data, options);
};

export const reorderBackgroundImages = (
  ids: string[],
  options?: AxiosRequestConfig,
): Promise<ReorderBackgroundImagesResult> => {
  return apiInstance.patch("/api/background-images/order", { ids }, options);
};

export const deleteBackgroundImage = (
  id: string,
  options?: AxiosRequestConfig,
): Promise<DeleteBackgroundImageResult> => {
  return apiInstance.delete(`/api/background-images/${id}`, options);
};
