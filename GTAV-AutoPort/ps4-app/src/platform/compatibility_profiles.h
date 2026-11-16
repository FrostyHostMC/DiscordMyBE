#pragma once

namespace ProjectV {
enum class GameVersion { V156, V157 };
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
// 1.57 is the primary development target. 1.56 is a separate community profile.
unsigned int profileCount();
const CompatibilityProfile& profileAt(unsigned int index);
int findProfile(const char* titleId, GameVersion version);
bool hooksMayBeEnabled(const CompatibilityProfile& profile);
}
