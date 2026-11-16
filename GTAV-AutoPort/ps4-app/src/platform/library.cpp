#include "library.h"
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#include <cstdio>
#include <cstring>
#include <algorithm>
#include <cctype>

namespace AutoPort {
static unsigned long long fingerprintFile(const std::string& path, unsigned long long& bytes) {
    // FNV-1a is an inventory fingerprint, not a cryptographic integrity hash.
    unsigned long long hash = 14695981039346656037ull;
    bytes = 0;
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return 0;
    unsigned char buffer[65536];
    size_t n;
    while ((n = fread(buffer, 1, sizeof(buffer), f)) != 0) {
        for (size_t i = 0; i < n; ++i) { hash ^= buffer[i]; hash *= 1099511628211ull; }
        bytes += n;
    }
    bool failed = ferror(f) != 0;
    fclose(f);
    return failed ? 0 : hash;
}
static std::string extensionOf(const std::string& name) {
    size_t p = name.find_last_of('.');
    if (p == std::string::npos) return "";
    std::string e = name.substr(p);
    std::transform(e.begin(), e.end(), e.begin(), [](unsigned char c){ return (char)tolower(c); });
    return e;
}
static bool walk(const std::string& root, const std::string& current, unsigned int depth,
                 unsigned int maxDepth, unsigned int maxItems, std::vector<LibraryItem>& out) {
    if (depth > maxDepth || out.size() >= maxItems) return true;
    DIR* d = opendir(current.c_str());
    if (!d) return false;
    dirent* ent;
    while ((ent = readdir(d)) != nullptr && out.size() < maxItems) {
        if (!strcmp(ent->d_name, ".") || !strcmp(ent->d_name, "..")) continue;
        if (ent->d_name[0] == '.') continue;
        std::string full = current + "/" + ent->d_name;
        struct stat st{};
        if (lstat(full.c_str(), &st) != 0 || S_ISLNK(st.st_mode)) continue;
        LibraryItem item{};
        item.path = full;
        item.name = ent->d_name;
        item.directory = S_ISDIR(st.st_mode);
        item.extension = item.directory ? "" : extensionOf(item.name);
        if (S_ISREG(st.st_mode)) {
            item.fingerprint = fingerprintFile(full, item.bytes);
            if (!item.fingerprint && item.bytes == 0) continue;
        } else if (!item.directory) continue;
        out.push_back(item);
        if (item.directory && depth < maxDepth)
            if (!walk(root, full, depth + 1, maxDepth, maxItems, out)) { closedir(d); return false; }
    }
    closedir(d);
    return true;
}
bool scanLibrary(const std::string& root, std::vector<LibraryItem>& out, std::string& error,
                 unsigned int maxItems, unsigned int maxDepth) {
    out.clear(); error.clear();
    struct stat st{};
    if (lstat(root.c_str(), &st) != 0 || !S_ISDIR(st.st_mode) || S_ISLNK(st.st_mode)) {
        error = "Library root is missing or is not a real directory"; return false;
    }
    if (!walk(root, root, 0, maxDepth, maxItems, out)) {
        out.clear(); error = "Could not read the complete library inventory"; return false;
    }
    std::sort(out.begin(), out.end(), [](const LibraryItem& a, const LibraryItem& b) {
        return a.path < b.path;
    });
    return true;
}
std::string formatFingerprint(unsigned long long value) {
    static const char digits[] = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) { out[(size_t)i] = digits[value & 15]; value >>= 4; }
    return out;
}
}
