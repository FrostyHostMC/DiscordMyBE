#pragma once
#include <string>

namespace AutoPort {
// GoldHEN config operations are explicit caller actions; nothing is deployed at startup.
bool validateGoldHENPluginEntry(const std::string& titleId, const std::string& pluginPath,
                               std::string& error);
bool previewGoldHENPluginEntry(const std::string& configPath, const std::string& titleId,
                               const std::string& pluginPath, std::string& preview,
                               std::string& error);
bool backupGoldHENConfig(const std::string& configPath, std::string& backupPath,
                         std::string& error);
bool addGoldHENPluginEntry(const std::string& configPath, const std::string& titleId,
                           const std::string& pluginPath, std::string& error);
bool restoreGoldHENConfig(const std::string& configPath, const std::string& backupPath,
                          std::string& error);
}
