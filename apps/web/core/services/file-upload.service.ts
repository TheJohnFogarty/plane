/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import axios, { isCancel } from "axios";
import type { AxiosRequestConfig, CancelTokenSource } from "axios";
// services
import { APIService } from "@/services/api.service";

export class FileUploadService extends APIService {
  private cancelSource: CancelTokenSource | undefined;

  constructor() {
    super("");
  }

  async uploadFile(
    url: string,
    data: FormData,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<void> {
    // Axios exposes the typed cancellation constructor on its default export.
    // oxlint-disable-next-line import/no-named-as-default-member
    const cancelSource = axios.CancelToken.source();
    this.cancelSource = cancelSource;
    return this.post(url, data, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      cancelToken: cancelSource.token,
      withCredentials: false,
      onUploadProgress: uploadProgressHandler,
    })
      .then((response) => response?.data)
      .catch((error) => {
        if (isCancel(error)) {
          console.log(error.message);
        } else {
          throw error?.response?.data;
        }
      });
  }

  cancelUpload() {
    this.cancelSource?.cancel("Upload canceled");
  }
}
