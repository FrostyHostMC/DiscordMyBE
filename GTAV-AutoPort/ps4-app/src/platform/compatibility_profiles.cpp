#include "compatibility_profiles.h"
#include <cstring>

namespace ProjectV {
static const CompatibilityProfile kProfiles[] = {
    {"GTA V 1.57 US", "CUSA00419", GameVersion::V157, Region::US, false, false, false},
    {"GTA V 1.57 EU", "CUSA00411", GameVersion::V157, Region::EU, false, false, false},
    {"GTA V 1.73 US", "CUSA00419", GameVersion::V173, Region::US, false, false, false},
    {"GTA V 1.73 EU", "CUSA00411", GameVersion::V173, Region::EU, false, false, false}
};

unsigned int profileCount() {
    return static_cast<unsigned int>(sizeof(kProfiles) / sizeof(kProfiles[0]));
}

const CompatibilityProfile& profileAt(unsigned int index) {
    return kProfiles[index < profileCount() ? index : 0];
}

int findProfile(const char* titleId, GameVersion version) {
    if (!titleId) return -1;
    for (unsigned int i = 0; i < profileCount(); ++i) {
        if (kProfiles[i].version == version &&
            std::strcmp(kProfiles[i].titleId, titleId) == 0)
            return static_cast<int>(i);
    }
    return -1;
}

bool hooksMayBeEnabled(const CompatibilityProfile& profile) {
    return profile.executableFingerprintVerified &&
           profile.hookSignaturesVerified &&
           profile.runtimeValidated;
}
}
