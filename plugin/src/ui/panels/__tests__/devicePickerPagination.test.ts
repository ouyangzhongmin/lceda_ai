import assert from "node:assert/strict";
import test from "node:test";

import { paginateDevicePickerCandidates } from "../devicePickerPagination";

test("paginateDevicePickerCandidates returns the requested page and original start index", () => {
  const page = paginateDevicePickerCandidates(["a", "b", "c", "d", "e", "f"], 2, 2);

  assert.equal(page.page, 2);
  assert.equal(page.pageCount, 3);
  assert.equal(page.total, 6);
  assert.equal(page.startIndex, 2);
  assert.deepEqual(page.items, ["c", "d"]);
});

test("paginateDevicePickerCandidates clamps invalid page input", () => {
  const highPage = paginateDevicePickerCandidates(["a", "b", "c"], 10, 2);
  const lowPage = paginateDevicePickerCandidates(["a", "b", "c"], 0, 2);

  assert.equal(highPage.page, 2);
  assert.equal(highPage.startIndex, 2);
  assert.deepEqual(highPage.items, ["c"]);
  assert.equal(lowPage.page, 1);
  assert.equal(lowPage.startIndex, 0);
  assert.deepEqual(lowPage.items, ["a", "b"]);
});

test("paginateDevicePickerCandidates keeps empty results on a stable first page", () => {
  const page = paginateDevicePickerCandidates([], 3, 5);

  assert.equal(page.page, 1);
  assert.equal(page.pageCount, 1);
  assert.equal(page.total, 0);
  assert.equal(page.startIndex, 0);
  assert.deepEqual(page.items, []);
});
