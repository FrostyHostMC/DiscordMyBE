#include "../src/platform/library.h"
#include "../src/platform/goldhen_config.h"
#include "../src/platform/compatibility_profiles.h"

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>

static std::string join(const std::string& a, const std::string& b) {
    return a + "/" + b;
}

static void writeFile(const std::string& path, const std::string& value) {
    std::ofstream out(path.c_str(), std::ios::binary);
    assert(out.good());
    out << value;
    out.close();
    assert(out.good());
}

static std::string readFile(const std::string& path) {
    std::ifstream in(path.c_str(), std::ios::binary);
    assert(in.good());
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

int main() {
    assert(ProjectV::profileCount() == 4);
    assert(ProjectV::findProfile("CUSA00419", ProjectV::GameVersion::V157) == 0);
    assert(ProjectV::findProfile("CUSA00411", ProjectV::GameVersion::V157) == 1);
    assert(ProjectV::findProfile("CUSA00419", ProjectV::GameVersion::V173) == 2);
    assert(ProjectV::findProfile("CUSA00411", ProjectV::GameVersion::V173) == 3);
    assert(ProjectV::findProfile("CUSA00419", ProjectV::GameVersion::V173) !=
           ProjectV::findProfile("CUSA00419", ProjectV::GameVersion::V157));
    for (unsigned int i = 0; i < ProjectV::profileCount(); ++i) {
        assert(!ProjectV::hooksMayBeEnabled(ProjectV::profileAt(i)));
    }
    assert(ProjectV::findProfile("CUSA99999", ProjectV::GameVersion::V173) == -1);

    char templatePath[] = "/tmp/autoport-ps4-host-tests-XXXXXX";
    char* made = mkdtemp(templatePath);
    assert(made != nullptr);
    const std::string root(made);
    const std::string library = join(root, "library");
    assert(mkdir(library.c_str(), 0700) == 0);

    writeFile(join(library, "readme.txt"), "fixture");
    writeFile(join(library, ".private"), "hidden");
    writeFile(join(library, "empty.bin"), "");
    assert(mkdir(join(library, "folder").c_str(), 0700) == 0);
    writeFile(join(join(library, "folder"), "nested.dat"), "nested");
    assert(symlink(join(library, "readme.txt").c_str(), join(library, "linked.txt").c_str()) == 0);

    std::vector<AutoPort::LibraryItem> items;
    std::string error;
    assert(AutoPort::scanLibrary(library, items, error, 100, 4));
    assert(error.empty());
    bool sawReadme = false, sawEmpty = false, sawFolder = false, sawNested = false;
    bool sawHidden = false, sawLink = false;
    for (const auto& item : items) {
        if (item.name == "readme.txt") sawReadme = !item.directory && item.bytes == 7;
        if (item.name == "empty.bin") sawEmpty = !item.directory && item.bytes == 0;
        if (item.name == "folder") sawFolder = item.directory;
        if (item.name == "nested.dat") sawNested = !item.directory;
        if (item.name == ".private") sawHidden = true;
        if (item.name == "linked.txt") sawLink = true;
    }
    assert(sawReadme && sawEmpty && sawFolder && sawNested);
    assert(!sawHidden && !sawLink);

    std::vector<AutoPort::LibraryItem> limited;
    assert(AutoPort::scanLibrary(library, limited, error, 1, 4));
    assert(limited.size() <= 1);

    assert(!AutoPort::scanLibrary(join(root, "missing"), limited, error));
    assert(!error.empty());

    assert(AutoPort::validateGoldHENPluginEntry(
        "CUSA00419", "/data/GoldHEN/plugins/example.sprx", error));
    assert(!AutoPort::validateGoldHENPluginEntry(
        "CUSA00419", "/data/GoldHEN/plugins/../outside.prx", error));
    assert(!AutoPort::validateGoldHENPluginEntry(
        "CUSA00419", "/data/GoldHEN/plugins/example.dll", error));
    assert(!AutoPort::validateGoldHENPluginEntry(
        "CUSA00A19", "/data/GoldHEN/plugins/example.prx", error));

    const std::string config = join(root, "plugins.ini");
    writeFile(config, "# preserved fixture\n[OTHER00001]\n/example/other.sprx\n");
    std::string preview;
    assert(AutoPort::previewGoldHENPluginEntry(
        config, "CUSA00419", "/data/GoldHEN/plugins/example.sprx", preview, error));
    assert(preview == "[CUSA00419]\n/data/GoldHEN/plugins/example.sprx");

    std::string backup;
    assert(AutoPort::backupGoldHENConfig(config, backup, error));
    assert(readFile(backup) == readFile(config));
    assert(!AutoPort::backupGoldHENConfig(config, backup, error));

    writeFile(config, "deliberately changed\n");
    assert(AutoPort::restoreGoldHENConfig(config, backup, error));
    assert(readFile(config) == "# preserved fixture\n[OTHER00001]\n/example/other.sprx\n");

    unlink(join(library, "linked.txt").c_str());
    unlink(join(join(library, "folder"), "nested.dat").c_str());
    rmdir(join(library, "folder").c_str());
    unlink(join(library, "readme.txt").c_str());
    unlink(join(library, "empty.bin").c_str());
    unlink(join(library, ".private").c_str());
    rmdir(library.c_str());
    unlink(config.c_str());
    unlink(backup.c_str());
    rmdir(root.c_str());
    std::puts("Project V profile and PS4 platform host regression tests passed");
    return 0;
}
