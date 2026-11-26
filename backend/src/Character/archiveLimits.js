export const ARCHIVE_PAGE_BYTES = 256 * 1024;
export const ARCHIVE_BULK_BYTES = 1024 * 1024;
export const archiveResultLimit = query => query?.bulk === true && query?.holdId ? ARCHIVE_BULK_BYTES : ARCHIVE_PAGE_BYTES;
