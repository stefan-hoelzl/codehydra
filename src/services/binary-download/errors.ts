/**
 * Re-export binary download error types from central errors module.
 */

export type { BinaryDownloadErrorCode, ArchiveErrorCode } from "../errors.js";
export { BinaryDownloadError, ArchiveError, getErrorMessage } from "../errors.js";
