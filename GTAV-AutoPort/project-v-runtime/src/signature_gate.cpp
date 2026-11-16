#include "../include/projectv/signature_gate.h"
#include <cstring>
#include <limits>

namespace ProjectV {
ScanResult findUniquePattern(const std::uint8_t* image, std::size_t imageSize,
                             const std::uint8_t* pattern, const char* mask,
                             std::size_t patternSize, std::ptrdiff_t resultOffset,
                             std::size_t& resultOffsetInImage) {
    resultOffsetInImage = 0;
    if (!image || !pattern || !mask || patternSize == 0 || patternSize > imageSize ||
        std::strlen(mask) != patternSize)
        return ScanResult::InvalidInput;

    for (std::size_t j = 0; j < patternSize; ++j)
        if (mask[j] != 'x' && mask[j] != '?') return ScanResult::InvalidInput;

    std::size_t match = 0;
    unsigned int matches = 0;
    for (std::size_t i = 0; i <= imageSize - patternSize; ++i) {
        bool equal = true;
        for (std::size_t j = 0; j < patternSize; ++j) {
            if (mask[j] == 'x' && image[i + j] != pattern[j]) {
                equal = false;
                break;
            }
        }
        if (equal) {
            match = i;
            if (++matches > 1) return ScanResult::Ambiguous;
        }
    }
    if (matches == 0) return ScanResult::NotFound;

    if (resultOffset < 0) {
        const std::size_t magnitude = static_cast<std::size_t>(-(resultOffset + 1)) + 1;
        if (magnitude > match) return ScanResult::OffsetOutOfRange;
        resultOffsetInImage = match - magnitude;
    } else {
        const std::size_t delta = static_cast<std::size_t>(resultOffset);
        if (delta > imageSize - match) return ScanResult::OffsetOutOfRange;
        resultOffsetInImage = match + delta;
    }
    if (resultOffsetInImage >= imageSize) return ScanResult::OffsetOutOfRange;
    return ScanResult::Found;
}

bool validatePatchWindow(const std::uint8_t* image, std::size_t imageSize,
                         std::size_t patchOffset, const std::uint8_t* expected,
                         std::size_t expectedSize, std::size_t patchSize) {
    if (!image || !expected || expectedSize == 0 || patchSize < expectedSize ||
        patchOffset > imageSize || patchSize > imageSize - patchOffset ||
        expectedSize > imageSize - patchOffset)
        return false;
    return std::memcmp(image + patchOffset, expected, expectedSize) == 0;
}

bool validateRequiredHookSet(const std::uint8_t* image, std::size_t imageSize,
                             const RequiredHookCheck* hooks, std::size_t hookCount) {
    if (!image || !hooks || hookCount == 0) return false;

    for (std::size_t i = 0; i < hookCount; ++i) {
        const RequiredHookCheck& hook = hooks[i];
        if (hook.scan != ScanResult::Found ||
            !validatePatchWindow(image, imageSize, hook.patchOffset, hook.expected,
                                 hook.expectedSize, hook.patchSize))
            return false;

        const std::size_t end = hook.patchOffset + hook.patchSize;
        for (std::size_t j = 0; j < i; ++j) {
            const std::size_t previousEnd = hooks[j].patchOffset + hooks[j].patchSize;
            if (hook.patchOffset < previousEnd && hooks[j].patchOffset < end)
                return false;
        }
    }
    return true;
}
}
