import type { AxiosResponse } from "axios";

export interface BackgroundImage {
  id: string;
  name: string | null;
  s3Key: string;
  thumbnailS3Key: string;
  thumbnailUrl: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListBackgroundImages200 {
  images: BackgroundImage[];
}

export interface UploadBackgroundImage200 {
  image: BackgroundImage;
}

export interface UpdateBackgroundImage200 {
  image: BackgroundImage;
}

export type ListBackgroundImagesResult = AxiosResponse<ListBackgroundImages200>;
export type UploadBackgroundImageResult = AxiosResponse<UploadBackgroundImage200>;
export type UpdateBackgroundImageResult = AxiosResponse<UpdateBackgroundImage200>;
export type DeleteBackgroundImageResult = AxiosResponse<{ success: boolean }>;
export type ReorderBackgroundImagesResult = AxiosResponse<{ success: boolean }>;
