#include "graphics.h"
Scene2D::Scene2D(int w,int h,int d):width(w),height(h),video(0),frameSize(w*h*d),active(0),directOff(0),directSize(0),memSP(0),mem(nullptr),buffers(nullptr){}
bool Scene2D::Init(size_t n,int count){video=sceVideoOutOpen(ORBIS_VIDEO_USER_MAIN,ORBIS_VIDEO_OUT_BUS_MAIN,0,0);if(video<0)return false;if(!initQueue()||!allocVideo(n,0x200000)||!allocBuffers(count))return false;sceVideoOutSetFlipRate(video,0);return true;}
bool Scene2D::initQueue(){if(sceKernelCreateEqueue(&queue,"AutoPort flip queue")<0)return false;return sceVideoOutAddFlipEvent(queue,video,0)==0;}
bool Scene2D::allocVideo(size_t n,int a){directSize=(n+a-1)/a*a;if(sceKernelAllocateDirectMemory(0,sceKernelGetDirectMemorySize(),directSize,a,3,&directOff)<0)return false;if(sceKernelMapDirectMemory(&mem,directSize,0x33,0,directOff,a)<0){sceKernelReleaseDirectMemory(directOff,directSize);return false;}memSP=(uintptr_t)mem;return true;}
char*Scene2D::allocDisplay(size_t n){char*p=(char*)memSP;memSP+=n;return p;}
bool Scene2D::allocBuffers(int n){if(n!=2)return false;buffers=new char*[n];for(int i=0;i<n;i++)buffers[i]=allocDisplay(frameSize);sceVideoOutSetBufferAttribute(&attr,0x80000000,1,0,width,height,width);return sceVideoOutRegisterBuffers(video,0,(void**)buffers,n,&attr)==0;}
void Scene2D::SubmitFlip(int id){sceVideoOutSubmitFlip(video,active,ORBIS_VIDEO_OUT_FLIP_VSYNC,id);}
void Scene2D::FrameWait(int id){OrbisKernelEvent e;int count=0;for(int i=0;i<4;i++){OrbisVideoOutFlipStatus s{};if(sceVideoOutGetFlipStatus(video,&s)==0&&s.flipArg==id)return;if(sceKernelWaitEqueue(queue,&e,1,&count,0)!=0)break;}}
void Scene2D::FrameBufferSwap(){active=(active+1)%2;}void Scene2D::SetActiveFrameBuffer(int i){active=i%2;}
void Scene2D::DrawPixel(int x,int y,Color c){if(x<0||y<0||x>=width||y>=height||!buffers)return;uint32_t v=0x80000000u|((uint32_t)c.r<<16)|((uint32_t)c.g<<8)|c.b;((uint32_t*)buffers[active])[y*width+x]=v;}
void Scene2D::DrawRectangle(int x,int y,int w,int h,Color c){int x0=x<0?0:x,y0=y<0?0:y,x1=x+w>width?width:x+w,y1=y+h>height?height:y+h;for(int yy=y0;yy<y1;yy++)for(int xx=x0;xx<x1;xx++)DrawPixel(xx,yy,c);}
void Scene2D::FrameBufferFill(Color c){DrawRectangle(0,0,width,height,c);}
