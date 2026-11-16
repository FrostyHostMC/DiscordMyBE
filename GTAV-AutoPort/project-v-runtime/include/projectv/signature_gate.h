#pragma once
#include <cstddef>
#include <cstdint>

namespace ProjectV {
enum class ScanResult { Found, NotFound, Ambiguous, InvalidInput, OffsetOutOfRange };

// mask uses 'x' for an exact byte and '?' for a wildcard.
ScanResult findUniquePattern(const std::uint8_t* image, std::size_t imageSize,
                             const std::uint8_t* pattern, const char* mask,
                             std::size_t patternSize, std::ptrdiff_t resultOffset,
                             std::size_t& resultOffsetInImage);

// Confirms the original bytes at a candidate patch site before any caller writes to it.
bool validatePatchWindow(const std::uint8_t* image, std::size_t imageSize,
                         std::size_t patchOffset, const std::uint8_t* expected,
                         std::size_t expectedSize, std::size_t patchSize);

// One entry for every required hook. A complete set must pass before installation begins.
struct RequiredHookCheck {
    ScanResult scan;
    std::size_t patchOffset;
    const std::uint8_t* expected;
    std::size_t expectedSize;
    std::size_t patchSize;
};

// Fails closed for empty sets, missing/ambiguous scans, mismatched bytes, invalid windows,
// and overlapping patch ranges. This validates only; it never writes or installs a hook.
bool validateRequiredHookSet(const std::uint8_t* image, std::size_t imageSize,
                             const RequiredHookCheck* hooks, std::size_t hookCount);
}
