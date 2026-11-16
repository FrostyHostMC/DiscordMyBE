#pragma once

namespace ProjectV {
enum class GameVersion { V157, V173 };
enum class Region { US, EU };

struct CompatibilityProfile {
    const char* label;
    const char* titleId;
    GameVersion version;
    Region region;
    bool executableFingerprintVerified;
    bool hookSignaturesVerified;
    bool runtimeValidated;
};

// Profiles are deliberately metadata-only until exact retail executable evidence exists.
unsigned int profileCount();
const CompatibilityProfile& profileAt(unsigned int index);
int findProfile(const char* titleId, GameVersion version);
bool hooksMayBeEnabled(const CompatibilityProfile& profile);
}
