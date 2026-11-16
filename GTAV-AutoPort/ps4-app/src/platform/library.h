#pragma once
#include <string>
#include <vector>

namespace AutoPort {
struct LibraryItem {
    std::string path;
    std::string name;
    std::string extension;
    unsigned long long bytes;
    unsigned long long fingerprint;
    bool directory;
};

// Read-only inventory of staged imports. Symlinks are ignored and traversal is bounded.
bool scanLibrary(const std::string& root, std::vector<LibraryItem>& out, std::string& error,
                 unsigned int maxItems = 2000, unsigned int maxDepth = 8);
std::string formatFingerprint(unsigned long long value);
}
