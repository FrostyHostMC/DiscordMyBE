#include "goldhen_config.h"
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <cctype>

namespace AutoPort {
static bool readLines(const std::string& path, std::vector<std::string>& lines, std::string& error) {
    lines.clear();
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) {
        if (access(path.c_str(), F_OK) != 0) return true;
        error = "Could not open GoldHEN configuration"; return false;
    }
    char buffer[4096];
    while (fgets(buffer, sizeof(buffer), f)) {
        size_t n = strlen(buffer);
        while (n && (buffer[n-1] == '\n' || buffer[n-1] == '\r')) buffer[--n] = 0;
        lines.emplace_back(buffer);
    }
    bool ok = !ferror(f);
    fclose(f);
    if (!ok) { error = "Could not read GoldHEN configuration"; return false; }
    return true;
}
static std::string trim(const std::string& s) {
    size_t a=s.find_first_not_of(" \t"), b=s.find_last_not_of(" \t");
    return a==std::string::npos ? "" : s.substr(a,b-a+1);
}
static bool writeAtomic(const std::string& path, const std::vector<std::string>& lines, std::string& error) {
    std::string tmp=path+".autport.tmp";
    FILE* f=fopen(tmp.c_str(),"wb");
    if(!f){error="Could not create temporary config";return false;}
    bool ok=true;
    for(const auto& line:lines) {
        if(fwrite(line.data(),1,line.size(),f)!=line.size() || fwrite("\n",1,1,f)!=1){ok=false;break;}
    }
    if(fflush(f)!=0)ok=false;
    if(fsync(fileno(f))!=0)ok=false;
    if(fclose(f)!=0)ok=false;
    if(!ok){unlink(tmp.c_str());error="Could not flush temporary config";return false;}
    if(rename(tmp.c_str(),path.c_str())!=0){unlink(tmp.c_str());error="Could not atomically replace config";return false;}
    return true;
}
bool validateGoldHENPluginEntry(const std::string& titleId,const std::string& pluginPath,std::string& error) {
    error.clear();
    if(titleId.size()!=9 || titleId.compare(0,4,"CUSA")!=0){error="Title ID must be a CUSA identifier";return false;}
    for(size_t i=4;i<titleId.size();++i)if(titleId[i]<'0'||titleId[i]>'9'){error="Title ID contains invalid characters";return false;}
    const std::string prefix="/data/GoldHEN/plugins/";
    if(pluginPath.compare(0,prefix.size(),prefix)!=0 || pluginPath.size()<=prefix.size()){
        error="Plugin must be inside /data/GoldHEN/plugins";return false;
    }
    if(pluginPath.find("..")!=std::string::npos || pluginPath.find('\\')!=std::string::npos ||
       pluginPath.find(':')!=std::string::npos || pluginPath.find("//")!=std::string::npos){
        error="Plugin path contains traversal or invalid separators";return false;
    }
    std::string lower=pluginPath;
    std::transform(lower.begin(),lower.end(),lower.begin(),[](unsigned char c){return (char)tolower(c);});
    if(lower.size()<5 || (lower.substr(lower.size()-4)!=".prx" && lower.substr(lower.size()-5)!=".sprx")){
        error="Only .prx and .sprx plugin paths are accepted";return false;
    }
    return true;
}
bool previewGoldHENPluginEntry(const std::string& configPath,const std::string& titleId,
                               const std::string& pluginPath,std::string& preview,std::string& error) {
    if(!validateGoldHENPluginEntry(titleId,pluginPath,error))return false;
    std::vector<std::string> lines;
    if(!readLines(configPath,lines,error))return false;
    bool section=false, found=false;
    for(const auto& raw:lines) {
        std::string line=trim(raw);
        if(line.size()>2 && line.front()=='[' && line.back()==']')
            section=(line.substr(1,line.size()-2)==titleId);
        else if(section && line==pluginPath)found=true;
    }
    if(found){preview="Plugin entry already exists for "+titleId;return true;}
    preview="["+titleId+"]\n"+pluginPath;
    return true;
}
bool backupGoldHENConfig(const std::string& configPath,std::string& backupPath,std::string& error) {
    error.clear();
    struct stat st{};
    if(lstat(configPath.c_str(),&st)!=0 || !S_ISREG(st.st_mode) || S_ISLNK(st.st_mode)){
        error="GoldHEN config is missing or is not a regular file";return false;
    }
    backupPath=configPath+".autport.bak";
    if(access(backupPath.c_str(),F_OK)==0){error="A backup already exists; restore or archive it before replacing";return false;}
    FILE* in=fopen(configPath.c_str(),"rb"); FILE* out=fopen(backupPath.c_str(),"wb");
    if(!in||!out){if(in)fclose(in);if(out)fclose(out);error="Could not open config backup files";return false;}
    char b[65536];size_t n;bool ok=true;
    while((n=fread(b,1,sizeof(b),in))!=0)if(fwrite(b,1,n,out)!=n){ok=false;break;}
    if(ferror(in)||fflush(out)!=0||fsync(fileno(out))!=0)ok=false;
    fclose(in);if(fclose(out)!=0)ok=false;
    if(!ok){unlink(backupPath.c_str());error="Config backup copy failed";return false;}
    return true;
}
bool addGoldHENPluginEntry(const std::string& configPath,const std::string& titleId,
                           const std::string& pluginPath,std::string& error) {
    std::string preview;
    if(!previewGoldHENPluginEntry(configPath,titleId,pluginPath,preview,error))return false;
    if(preview.find("already exists")!=std::string::npos)return true;
    struct stat pluginInfo{};
    if(lstat(pluginPath.c_str(),&pluginInfo)!=0 || !S_ISREG(pluginInfo.st_mode) || S_ISLNK(pluginInfo.st_mode)){
        error="Plugin binary is missing or is not a regular file";return false;
    }
    std::vector<std::string> lines;
    if(!readLines(configPath,lines,error))return false;
    bool section=false, sectionFound=false;
    for(const auto& raw:lines){std::string line=trim(raw);if(line.size()>2&&line.front()=='['&&line.back()==']'&&line.substr(1,line.size()-2)==titleId)sectionFound=true;}
    if(sectionFound){
        for(size_t i=0;i<lines.size();++i){std::string line=trim(lines[i]);if(line.size()>2&&line.front()=='['&&line.back()==']')section=(line.substr(1,line.size()-2)==titleId);else if(section&&line.size()&&line[0]!='#'&&line[0]!=';'){
            error="Title section contains an existing entry; refusing ambiguous modification";return false;
        }}
        error="Title section exists but has no safe insertion point";return false;
    }
    if(!lines.empty()&&!lines.back().empty())lines.emplace_back("");
    lines.emplace_back("["+titleId+"]");lines.emplace_back(pluginPath);
    std::string backupPath;
    if(access(configPath.c_str(),F_OK)==0 && !backupGoldHENConfig(configPath,backupPath,error))return false;
    return writeAtomic(configPath,lines,error);
}
bool restoreGoldHENConfig(const std::string& configPath,const std::string& backupPath,std::string& error) {
    struct stat st{};
    if(lstat(backupPath.c_str(),&st)!=0||!S_ISREG(st.st_mode)||S_ISLNK(st.st_mode)){
        error="Backup is missing or is not a regular file";return false;
    }
    std::string tmp=configPath+".restore.tmp";
    FILE* in=fopen(backupPath.c_str(),"rb");FILE* out=fopen(tmp.c_str(),"wb");
    if(!in||!out){if(in)fclose(in);if(out)fclose(out);error="Could not open restore files";return false;}
    char b[65536];size_t n;bool ok=true;
    while((n=fread(b,1,sizeof(b),in))!=0)if(fwrite(b,1,n,out)!=n){ok=false;break;}
    if(ferror(in)||fflush(out)!=0||fsync(fileno(out))!=0)ok=false;
    fclose(in);if(fclose(out)!=0)ok=false;
    if(!ok||rename(tmp.c_str(),configPath.c_str())!=0){unlink(tmp.c_str());error="Restore failed; original config was not intentionally removed";return false;}
    return true;
}
}
