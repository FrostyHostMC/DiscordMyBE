#include <orbis/Pad.h>
#include <orbis/libkernel.h>
#include "graphics.h"
#include "platform/compatibility_profiles.h"
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>
static const int W=1920,H=1080;
static const Color BG={10,13,22}, PANEL={19,25,39}, WHITE={235,241,250}, MUTED={139,154,176}, CYAN={45,205,220}, GREEN={74,205,137}, RED={238,103,103};
struct Entry{std::string name;bool dir;unsigned long long size;};
static std::vector<Entry> items;
static std::string path="/mnt/usb0",status="CONNECT USB DRIVE THEN PRESS TRIANGLE TO SCAN";
static const char* roots[]={"/mnt/usb0","/mnt/usb1","/data","/data/ProjectV/imports","/data/AutoPort/imports"};
static int root=0,selected=0,pad=-1,frame=0;
static unsigned int profileIndex=0;
static bool receiptOk=true;
static const char* glyph(char c){
#define G(ch,p) case ch:return p
switch(c){
G('A',"01110100011000111111100011000110001");G('B',"11110100011000111110100011000111110");G('C',"01111100001000010000100001000001111");G('D',"11110100011000110001100011000111110");G('E',"11111100001000011110100001000011111");G('F',"11111100001000011110100001000010000");G('G',"01111100001000010111100011000101111");G('H',"10001100011000111111100011000110001");G('I',"11111001000010000100001000010011111");G('J',"00111000100001000010100101001001100");G('K',"10001100101010011000101001001010001");G('L',"10000100001000010000100001000011111");G('M',"10001110111010110101100011000110001");G('N',"10001110011010110011100011000110001");G('O',"01110100011000110001100011000101110");G('P',"11110100011000111110100001000010000");G('Q',"01110100011000110001101011001001101");G('R',"11110100011000111110101001001010001");G('S',"01111100001000001110000010000111110");G('T',"11111001000010000100001000010000100");G('U',"10001100011000110001100011000101110");G('V',"10001100011000110001100010101000100");G('W',"10001100011000110101101011010101010");G('X',"10001100010101000100010101000110001");G('Y',"10001100010101000100001000010000100");G('Z',"11111000010001000100010001000011111");
G('0',"01110100011001110101110011000101110");G('1',"00100011000010000100001000010001110");G('2',"01110100010000100010001000100011111");G('3',"11110000010000101110000010000111110");G('4',"00010001100101010010111110001000010");G('5',"11111100001000011110000010000111110");G('6',"01110100001000011110100011000101110");G('7',"11111000010001000100010000100001000");G('8',"01110100011000101110100011000101110");G('9',"01110100011000101111000010000101110");
G('.',"00000000000000000000000000000000110");G('-',"00000000000000011111000000000000000");G('_',"00000000000000000000000000000011111");G('/',"00001000100010001000100010001000000");G(':',"00000001100011000000001100011000000");G('!',"00100001000010000100001000000000100");G(' ',"00000000000000000000000000000000000");
default:return "00000000000000000000000000000000000";
}
#undef G
}
static void drawText(Scene2D&s,int x,int y,const std::string&t,Color c,int z=3){
for(char a:t){char ch=a>='a'&&a<='z'?a-32:a;const char*p=glyph(ch);for(int yy=0;yy<7;yy++)for(int xx=0;xx<5;xx++)if(p[yy*5+xx]=='1')s.DrawRectangle(x+xx*z,y+yy*z,z,z,c);x+=6*z;}
}
static bool supported(const char*n){std::string s=n;std::transform(s.begin(),s.end(),s.begin(),[](unsigned char c){return (char)tolower(c);});const char*e[]={".rpf",".zip",".7z",".oiv",".yft",".ytd",".ydd",".ydr",".ybn",".ymap",".ytyp",".ymf",".ymt",".ycd",".ypt",".ynv",".ynd",".awc",".rel",".gxt2",".ysc",".meta",".xml",".ini",".json",".cfg",".dat",".txt",".lua",".cs",".js",".asi",".dll",".prx",".png",".dds",".fbx",".obj",".gltf",".glb",".wav",".mp3"};for(auto x:e)if(s.size()>=strlen(x)&&s.compare(s.size()-strlen(x),strlen(x),x)==0)return true;return false;}
static void scan(){items.clear();selected=0;DIR*d=opendir(path.c_str());if(!d){status="CANNOT OPEN "+path+" - CHECK USB MOUNT";return;}if(path!=roots[root])items.push_back({"..",true,0});dirent*e;while((e=readdir(d))&&items.size()<48){if(e->d_name[0]=='.')continue;std::string f=path+"/"+e->d_name;struct stat st{};if(lstat(f.c_str(),&st)||S_ISLNK(st.st_mode))continue;if(S_ISDIR(st.st_mode))items.push_back({e->d_name,true,0});else if(S_ISREG(st.st_mode)&&supported(e->d_name))items.push_back({e->d_name,false,(unsigned long long)st.st_size});}closedir(d);std::sort(items.begin()+(path==roots[root]?0:1),items.end(),[](const Entry&a,const Entry&b){if(a.dir!=b.dir)return a.dir>b.dir;return a.name<b.name;});status="FOUND "+std::to_string(items.size())+" ITEMS - CROSS TO OPEN OR IMPORT";}
static std::string jsonEscape(const std::string& value){std::string out;for(unsigned char c:value){if(c=='"'||c=='\\'){out.push_back('\\');out.push_back((char)c);}else if(c=='\n')out+="\\n";else if(c=='\r')out+="\\r";else if(c=='\t')out+="\\t";else if(c>=32)out.push_back((char)c);}return out;}
static std::string uniqueImportPath(const std::string& name){std::string base="/data/ProjectV/imports/"+name;if(access(base.c_str(),F_OK)!=0)return base;size_t dot=name.find_last_of('.');std::string stem=dot==std::string::npos?name:name.substr(0,dot);std::string ext=dot==std::string::npos?"":name.substr(dot);for(int n=1;n<10000;n++){std::string candidate="/data/ProjectV/imports/"+stem+"_"+std::to_string(n)+ext;if(access(candidate.c_str(),F_OK)!=0)return candidate;}return "";}
static bool appendImportReceipt(const std::string& source,const std::string& destination,unsigned long long bytes){FILE*f=fopen("/data/ProjectV/imports/imports.jsonl","a");if(!f)return false;std::string line="{\"source\":\""+jsonEscape(source)+"\",\"destination\":\""+jsonEscape(destination)+"\",\"bytes\":"+std::to_string(bytes)+"}\n";bool ok=fwrite(line.data(),1,line.size(),f)==line.size()&&fflush(f)==0;fclose(f);return ok;}
static bool importFile(const Entry&e){
if(e.size>1024ull*1024ull*1024ull){status="FILE EXCEEDS 1 GB IMPORT LIMIT";return false;}
mkdir("/data/ProjectV",0777);mkdir("/data/ProjectV/imports",0777);
std::string src=path+"/"+e.name;struct stat sourceInfo{};if(lstat(src.c_str(),&sourceInfo)||S_ISLNK(sourceInfo.st_mode)||!S_ISREG(sourceInfo.st_mode)){status="SOURCE IS NOT A REGULAR FILE";return false;}
std::string dst=uniqueImportPath(e.name);if(dst.empty()){status="TOO MANY FILES WITH THE SAME NAME";return false;}
std::string tmp=dst+".part";unlink(tmp.c_str());
FILE*i=fopen(src.c_str(),"rb");if(!i){status="CANNOT OPEN SOURCE FILE";return false;}
FILE*o=fopen(tmp.c_str(),"wb");if(!o){fclose(i);status="CANNOT CREATE STAGING FILE";return false;}
char b[262144];size_t n;unsigned long long total=0;bool ok=true;
while((n=fread(b,1,sizeof(b),i))){if(fwrite(b,1,n,o)!=n){ok=false;break;}total+=n;}
if(ferror(i)||total!=e.size)ok=false;
fclose(i);
if(fflush(o)!=0)ok=false;
if(fsync(fileno(o))!=0)ok=false;
if(fclose(o)!=0)ok=false;
if(!ok){unlink(tmp.c_str());status="COPY FAILED OR SOURCE SIZE CHANGED";return false;}
if(rename(tmp.c_str(),dst.c_str())!=0){unlink(tmp.c_str());status="COULD NOT FINALIZE IMPORT";return false;}
receiptOk=appendImportReceipt(src,dst,total);
return true;
}
static void activate(){if(items.empty())return;Entry e=items[selected];if(e.dir){if(e.name==".."){auto p=path.find_last_of('/');if(p!=std::string::npos&&p>0)path=path.substr(0,p);}else path+="/"+e.name;scan();return;}if(root==3){status="THIS FILE IS ALREADY IN THE IMPORT LIBRARY";return;}if(importFile(e))status=receiptOk?"IMPORTED SAFELY - ORIGINAL LEFT UNCHANGED":"IMPORTED - RECEIPT COULD NOT BE SAVED";else if(status.empty())status="IMPORT FAILED - CHECK STORAGE";}
static void draw(Scene2D&s){s.FrameBufferFill(BG);s.DrawRectangle(0,0,W,112,PANEL);s.DrawRectangle(48,40,12,46,CYAN);drawText(s,82,38,"PROJECT V",WHITE,6);drawText(s,470,55,"PS4 MOD MANAGER  /  LIBRARY",MUTED,3);s.DrawRectangle(48,142,1824,126,PANEL);drawText(s,82,166,"IMPORT / STAGING",CYAN,4);drawText(s,82,218,path,WHITE,3);s.DrawRectangle(48,294,1180,610,PANEL);s.DrawRectangle(1260,294,612,610,PANEL);drawText(s,82,324,"SUPPORTED FILES  /  FOLDERS",MUTED,3);int first=(selected/10)*10;for(int i=first;i<(int)items.size()&&i<first+10;i++){int y=374+(i-first)*48;if(i==selected)s.DrawRectangle(68,y-9,1138,40,{27,42,61});drawText(s,90,y,(items[i].dir?"> ":"")+items[i].name,i==selected?CYAN:WHITE,3);if(!items[i].dir)drawText(s,1000,y,std::to_string(items[i].size/1024)+" KB",MUTED,2);}drawText(s,1294,328,"CONTROLS",CYAN,4);drawText(s,1294,396,"UP DOWN  SELECT",WHITE,2);drawText(s,1294,440,"CROSS  OPEN / STAGE FILE",WHITE,2);drawText(s,1294,484,"CIRCLE  PARENT FOLDER",WHITE,2);drawText(s,1294,528,"SQUARE  NEXT STORAGE / LIBRARY",WHITE,2);drawText(s,1294,572,"TRIANGLE  RESCAN",WHITE,2);drawText(s,1294,616,"LEFT RIGHT  CHANGE GTA V PROFILE",WHITE,2);drawText(s,1294,674,"ACTIVE PROFILE",MUTED,2);drawText(s,1294,710,ProjectV::profileAt(profileIndex).label,CYAN,3);drawText(s,1294,750,"HOOKS LOCKED - BUILD UNVERIFIED",RED,2);drawText(s,1294,782,"PS4 SYSTEM SOFTWARE TARGET 14.00",WHITE,2);drawText(s,1294,822,"IMPORT DESTINATION",MUTED,2);drawText(s,1294,854,"/DATA/PROJECTV/IMPORTS",GREEN,2);drawText(s,1294,886,"GAME FILES ARE NEVER OVERWRITTEN",MUTED,2);s.DrawRectangle(48,930,1824,92,PANEL);drawText(s,82,962,status.substr(0,90),status.find("FAILED")!=std::string::npos?RED:WHITE,2);s.DrawRectangle(48,1044,1824,3,CYAN);}
static void startupLog(const char* message){
mkdir("/data/ProjectV",0777);
FILE* f=fopen("/data/ProjectV/manager-startup.log","a");
if(!f)return;
fprintf(f,"%s\\n",message);
fflush(f);
fsync(fileno(f));
fclose(f);
}
int main(){
startupLog("BOOT: main entered");
Scene2D scene(W,H,4);
if(!scene.Init((size_t)W*H*4*2,2)){
startupLog("BOOT ERROR: graphics initialization failed");
return 1;
}
startupLog("BOOT: graphics initialized");
int padInitResult=scePadInit();
startupLog(padInitResult==0?"BOOT: pad subsystem initialized":"BOOT WARNING: pad subsystem initialization failed");
pad=scePadOpen(0x10000000,ORBIS_PAD_PORT_TYPE_STANDARD,0,nullptr);
startupLog(pad>=0?"BOOT: controller opened":"BOOT WARNING: controller open failed");
scan();
uint32_t old=0;
for(;;){
OrbisPadData d{};
if(pad>=0)scePadReadState(pad,&d);
uint32_t press=d.buttons&~old;
old=d.buttons;
if(press&ORBIS_PAD_BUTTON_UP&&selected>0)selected--;
if(press&ORBIS_PAD_BUTTON_DOWN&&selected+1<(int)items.size())selected++;
if(press&ORBIS_PAD_BUTTON_LEFT){profileIndex=(profileIndex+ProjectV::profileCount()-1)%ProjectV::profileCount();status="PROFILE CHANGED - RUNTIME HOOKS REMAIN LOCKED";}
if(press&ORBIS_PAD_BUTTON_RIGHT){profileIndex=(profileIndex+1)%ProjectV::profileCount();status="PROFILE CHANGED - RUNTIME HOOKS REMAIN LOCKED";}
if(press&ORBIS_PAD_BUTTON_CROSS)activate();
if(press&ORBIS_PAD_BUTTON_CIRCLE){if(path!=roots[root]){auto p=path.find_last_of('/');if(p!=std::string::npos&&p>0)path=path.substr(0,p);scan();}}
if(press&ORBIS_PAD_BUTTON_TRIANGLE)scan();
if(press&ORBIS_PAD_BUTTON_SQUARE){root=(root+1)%5;path=roots[root];scan();}
scene.SetActiveFrameBuffer(frame%2);
draw(scene);
scene.SubmitFlip(frame);
scene.FrameWait(frame);
scene.FrameBufferSwap();
frame++;
sceKernelUsleep(16000);
}
return 0;
}
