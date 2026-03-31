export interface ApiResponse<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
  error?: {
    detail?: string;
  };
}
