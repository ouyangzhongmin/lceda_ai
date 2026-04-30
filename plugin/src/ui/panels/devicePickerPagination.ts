export interface CandidatePage<T> {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  startIndex: number;
  items: T[];
}

export function paginateDevicePickerCandidates<T>(
  candidates: T[],
  page: number,
  pageSize: number
): CandidatePage<T> {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(safeCandidates.length / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const startIndex = (safePage - 1) * safePageSize;
  return {
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    total: safeCandidates.length,
    startIndex,
    items: safeCandidates.slice(startIndex, startIndex + safePageSize),
  };
}
